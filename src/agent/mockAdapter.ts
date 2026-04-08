import type { AgentAdapter, AgentEvent, AgentRunInput, AgentSession, AgentTurnResult } from "../types.js";

type SessionState =
  | { domain: "support"; step: "start" | "listed_customer" | "listed_orders" | "found_duplicate" | "newsletter_lookup" | "cancel_done" | "done" }
  | { domain: "coding"; step: "start" | "listed_files" | "read_file" | "patched" }
  | { domain: "research"; step: "start" | "searched" | "read_doc" }
  | { domain: "ops"; step: "start" | "alerts_loaded" | "logs_loaded" | "status_loaded" };

class MockAgentSession implements AgentSession {
  private readonly state: SessionState;

  constructor(private readonly input: AgentRunInput) {
    this.state = { domain: detectDomain(input), step: "start" } as SessionState;
  }

  private hasTool(toolName: string): boolean {
    return this.input.availableTools.some((tool) => tool.name === toolName);
  }

  async next(event: AgentEvent): Promise<AgentTurnResult> {
    if (event.type === "runner_error") {
      return { type: "error", message: event.message };
    }

    switch (this.state.domain) {
      case "support":
        return this.nextSupport(event);
      case "coding":
        return this.nextCoding(event);
      case "research":
        return this.nextResearch(event);
      case "ops":
        return this.nextOps(event);
      default:
        return { type: "error", message: "Unsupported mock domain." };
    }
  }

  private async nextSupport(event: AgentEvent): Promise<AgentTurnResult> {
    if (this.state.step === "start") {
      const email = String(this.input.context.customer_email ?? "");
      this.state.step = "listed_customer";
      return {
        type: "tool_call",
        toolName: "crm.search_customer",
        input: { email },
        metadata: { message: "Looking up customer." },
      };
    }

    if (this.state.step === "listed_customer") {
      if (event.type !== "tool_result" || typeof event.result !== "object" || event.result === null) {
        return { type: "error", message: "Expected customer lookup result." };
      }
      const customerId = String((event.result as Record<string, unknown>).id ?? "");

      if (this.hasTool("accounts.get_profile") && this.hasTool("accounts.update_newsletter")) {
        this.state.step = "newsletter_lookup";
        return {
          type: "tool_call",
          toolName: "accounts.get_profile",
          input: { customer_id: customerId },
          metadata: { message: "Checking newsletter settings." },
        };
      }

      if (this.hasTool("subscriptions.cancel")) {
        this.state.step = "cancel_done";
        return {
          type: "tool_call",
          toolName: "subscriptions.cancel",
          input: { customer_id: customerId },
          metadata: { message: "Cancelling active subscription." },
        };
      }

      if (this.hasTool("support.find_duplicate_charge")) {
        this.state.step = "found_duplicate";
        return {
          type: "tool_call",
          toolName: "support.find_duplicate_charge",
          input: { customer_id: customerId },
          metadata: { message: "Looking up the duplicated order directly." },
        };
      }

      this.state.step = "listed_orders";
      return {
        type: "tool_call",
        toolName: "orders.list",
        input: { customer_id: customerId },
        metadata: { message: "Listing customer orders." },
      };
    }

    if (this.state.step === "newsletter_lookup") {
      if (event.type !== "tool_result" || typeof event.result !== "object" || event.result === null) {
        return { type: "error", message: "Expected account lookup result." };
      }
      this.state.step = "done";
      return {
        type: "tool_call",
        toolName: "accounts.update_newsletter",
        input: {
          customer_id: String(this.input.context.customer_id ?? (event.result as Record<string, unknown>).customer_id ?? ""),
          subscribed: false,
        },
        metadata: { message: "Turning off newsletter subscription." },
      };
    }

    if (this.state.step === "listed_orders") {
      if (event.type !== "tool_result" || !Array.isArray(event.result)) {
        return { type: "error", message: "Expected order list result." };
      }

      const targetOrderId = String(this.input.context.target_order_id ?? "ord_1024");
      const duplicate = event.result.find(
        (order) => typeof order === "object" && order !== null && (order as Record<string, unknown>).id === targetOrderId,
      ) as { id?: string } | undefined;

      if (!duplicate?.id) {
        return { type: "error", message: "Could not identify duplicate order." };
      }

      this.state.step = "done";
      return {
        type: "tool_call",
        toolName: "orders.refund",
        input: { order_id: duplicate.id },
        metadata: { message: "Refunding the duplicated charge." },
      };
    }

    if (this.state.step === "found_duplicate") {
      if (event.type !== "tool_result" || typeof event.result !== "object" || event.result === null) {
        return { type: "error", message: "Expected duplicate lookup result." };
      }

      const result = event.result as { order_id?: string };
      if (!result.order_id) {
        return { type: "error", message: "Duplicate lookup did not return an order id." };
      }

      this.state.step = "done";
      return {
        type: "tool_call",
        toolName: "orders.refund",
        input: { order_id: result.order_id },
        metadata: { message: "Refunding the duplicated charge." },
      };
    }

    if (this.state.step === "cancel_done") {
      if (event.type !== "tool_result" || typeof event.result !== "object" || event.result === null) {
        return { type: "error", message: "Expected cancellation result." };
      }
      return {
        type: "final",
        output: `Cancelled subscription ${String((event.result as Record<string, unknown>).subscription_id ?? "unknown")}.`,
        metadata: { completed: true },
      };
    }

    if (this.state.step === "done") {
      if (event.type !== "tool_result" || typeof event.result !== "object" || event.result === null) {
        return { type: "error", message: "Expected final support tool result." };
      }
      if ("newsletter_subscribed" in (event.result as Record<string, unknown>)) {
        return {
          type: "final",
          output: "Disabled the newsletter subscription for the customer.",
          metadata: { completed: true },
        };
      }

      const refund = event.result as { order_id?: string; amount?: number; currency?: string };
      return {
        type: "final",
        output: `Refunded duplicated charge on order ${refund.order_id} for ${refund.amount} ${refund.currency}.`,
        metadata: { completed: true },
      };
    }

    return { type: "error", message: "Unexpected support session state." };
  }

  private async nextCoding(event: AgentEvent): Promise<AgentTurnResult> {
    const targetPath = String(this.input.context.target_path ?? "");
    const replacement = String(this.input.context.replacement ?? "");

    if (this.state.step === "start") {
      this.state.step = "listed_files";
      return {
        type: "tool_call",
        toolName: "repo.list_files",
        input: {},
        metadata: { message: "Listing repository files." },
      };
    }

    if (this.state.step === "listed_files") {
      this.state.step = "read_file";
      return {
        type: "tool_call",
        toolName: "repo.read_file",
        input: { path: targetPath },
        metadata: { message: "Reading target file." },
      };
    }

    if (this.state.step === "read_file") {
      this.state.step = "patched";
      return {
        type: "tool_call",
        toolName: "repo.apply_patch",
        input: { path: targetPath, replacement },
        metadata: { message: "Applying deterministic patch." },
      };
    }

    if (this.state.step === "patched") {
      return {
        type: "final",
        output: `Updated ${targetPath} with replacement '${replacement}'.`,
        metadata: { completed: true },
      };
    }

    return { type: "error", message: "Unexpected coding session state." };
  }

  private async nextResearch(event: AgentEvent): Promise<AgentTurnResult> {
    const query = String(this.input.context.query ?? "");

    if (this.state.step === "start") {
      this.state.step = "searched";
      return {
        type: "tool_call",
        toolName: "docs.search",
        input: { query },
        metadata: { message: "Searching documents." },
      };
    }

    if (this.state.step === "searched") {
      if (event.type !== "tool_result" || !Array.isArray(event.result) || event.result.length === 0) {
        return { type: "error", message: "Expected document search results." };
      }
      const first = event.result[0] as Record<string, unknown>;
      this.state.step = "read_doc";
      return {
        type: "tool_call",
        toolName: "docs.read",
        input: { doc_id: String(first.id ?? "") },
        metadata: { message: "Reading top matching document." },
      };
    }

    if (this.state.step === "read_doc") {
      if (event.type !== "tool_result" || typeof event.result !== "object" || event.result === null) {
        return { type: "error", message: "Expected document read result." };
      }
      const doc = event.result as Record<string, unknown>;
      return {
        type: "final",
        output: `${String(this.input.context.answer_prefix ?? "Answer")}: ${String(this.input.context.expected_answer ?? "")} (source: ${String(doc.id ?? "")})`,
        metadata: { completed: true },
      };
    }

    return { type: "error", message: "Unexpected research session state." };
  }

  private async nextOps(event: AgentEvent): Promise<AgentTurnResult> {
    const service = String(this.input.context.service ?? "");

    if (this.state.step === "start") {
      this.state.step = "alerts_loaded";
      return {
        type: "tool_call",
        toolName: "alerts.list_active",
        input: {},
        metadata: { message: "Loading active alerts." },
      };
    }

    if (this.state.step === "alerts_loaded") {
      this.state.step = "logs_loaded";
      return {
        type: "tool_call",
        toolName: "logs.query_service",
        input: { service },
        metadata: { message: "Querying service logs." },
      };
    }

    if (this.state.step === "logs_loaded") {
      this.state.step = "status_loaded";
      return {
        type: "tool_call",
        toolName: "status.get_service",
        input: { service },
        metadata: { message: "Loading service ownership metadata." },
      };
    }

    if (this.state.step === "status_loaded") {
      if (event.type !== "tool_result" || typeof event.result !== "object" || event.result === null) {
        return { type: "error", message: "Expected service status result." };
      }
      const owner = String((event.result as Record<string, unknown>).owner ?? "");
      return {
        type: "final",
        output: `${String(this.input.context.expected_summary ?? "")} Escalate to ${owner}.`,
        metadata: { completed: true },
      };
    }

    return { type: "error", message: "Unexpected ops session state." };
  }
}

function detectDomain(input: AgentRunInput): "support" | "coding" | "research" | "ops" {
  const toolNames = new Set(input.availableTools.map((tool) => tool.name));
  if (toolNames.has("repo.list_files")) {
    return "coding";
  }
  if (toolNames.has("docs.search")) {
    return "research";
  }
  if (toolNames.has("alerts.list_active")) {
    return "ops";
  }
  return "support";
}

export class MockAgentAdapter implements AgentAdapter {
  async startRun(input: AgentRunInput): Promise<AgentSession> {
    return new MockAgentSession(input);
  }
}
