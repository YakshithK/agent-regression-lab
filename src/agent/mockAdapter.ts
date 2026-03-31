import type { AgentAdapter, AgentEvent, AgentRunInput, AgentSession, AgentTurnResult } from "../types.js";

type InternalState =
  | { step: "start" }
  | { step: "listed_customer" }
  | { step: "listed_orders" }
  | { step: "done" };

class MockAgentSession implements AgentSession {
  private state: InternalState = { step: "start" };

  constructor(private readonly input: AgentRunInput) {}

  async next(event: AgentEvent): Promise<AgentTurnResult> {
    if (event.type === "runner_error") {
      return { type: "error", message: event.message };
    }

    if (this.state.step === "start") {
      const email = String(this.input.context.customer_email ?? "");
      this.state = { step: "listed_customer" };
      return {
        type: "tool_call",
        toolName: "crm.search_customer",
        input: { email },
        metadata: { message: "Looking up customer." },
      };
    }

    if (this.state.step === "listed_customer") {
      if (event.type !== "tool_result") {
        return { type: "error", message: "Expected customer lookup result." };
      }

      const result = event.result as { id?: string };
      this.state = { step: "listed_orders" };
      return {
        type: "tool_call",
        toolName: "orders.list",
        input: { customer_id: String(result.id ?? "") },
        metadata: { message: "Listing customer orders." },
      };
    }

    if (this.state.step === "listed_orders") {
      if (event.type !== "tool_result" || !Array.isArray(event.result)) {
        return { type: "error", message: "Expected order list result." };
      }

      const duplicate = event.result.find(
        (order) => typeof order === "object" && order !== null && (order as Record<string, unknown>).id === "ord_1024",
      ) as { id?: string } | undefined;

      if (!duplicate?.id) {
        return { type: "error", message: "Could not identify duplicate order." };
      }

      this.state = { step: "done" };
      return {
        type: "tool_call",
        toolName: "orders.refund",
        input: { order_id: duplicate.id },
        metadata: { message: "Refunding the duplicated charge." },
      };
    }

    if (this.state.step === "done") {
      if (event.type !== "tool_result" || typeof event.result !== "object" || event.result === null) {
        return { type: "error", message: "Expected refund result." };
      }

      const refund = event.result as { order_id?: string; amount?: number; currency?: string };
      return {
        type: "final",
        output: `Refunded duplicated charge on order ${refund.order_id} for ${refund.amount} ${refund.currency}.`,
        metadata: { completed: true },
      };
    }

    return { type: "error", message: "Unexpected session state." };
  }
}

export class MockAgentAdapter implements AgentAdapter {
  async startRun(input: AgentRunInput): Promise<AgentSession> {
    return new MockAgentSession(input);
  }
}
