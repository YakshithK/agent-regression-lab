import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { loadAgentLabConfig } from "./config.js";
import type { RuntimeProfileDefinition, ToolRegistration, ToolSpec } from "./types.js";
import { TraceRecorder } from "./trace.js";

export type ToolContext = {
  scenarioId: string;
};

export type ToolHandler = (input: unknown, context: ToolContext) => Promise<unknown>;

export type LoadedTool = {
  spec: ToolSpec;
  handler: ToolHandler;
};

export function applyRuntimeProfileToTools(
  tools: Record<string, ToolHandler>,
  profile: RuntimeProfileDefinition | undefined,
  trace: TraceRecorder,
): Record<string, ToolHandler> {
  if (!profile?.tool_faults?.length) {
    return tools;
  }

  const wrapped = { ...tools };
  for (const fault of profile.tool_faults) {
    const original = wrapped[fault.tool];
    if (!original) {
      continue;
    }

    wrapped[fault.tool] = async (input, context) => {
      trace.record(
        "system",
        "tool_fault_injected",
        {
          tool: fault.tool,
          mode: fault.mode,
        },
        { countStep: false },
      );

      if (fault.mode === "timeout") {
        await waitUnref(fault.timeout_ms ?? 5000);
        const timeoutError = new Error(`Injected timeout for ${fault.tool}`);
        (timeoutError as { code?: string }).code = "timeout_exceeded";
        throw timeoutError;
      }

      if (fault.mode === "error") {
        throw new Error(fault.error_message ?? `Injected failure for ${fault.tool}`);
      }

      if (fault.mode === "malformed_output") {
        return "MALFORMED_OUTPUT";
      }

      return fault.partial_output ?? {};
    };
  }

  return wrapped;
}

type Customer = {
  id: string;
  email: string;
  name: string;
};

type Order = {
  id: string;
  customer_id: string;
  amount: number;
  currency: string;
  status: string;
  duplicate_group?: string;
};

type Account = {
  customer_id: string;
  newsletter_subscribed: boolean;
  tier: string;
};

type Subscription = {
  customer_id: string;
  subscription_id: string;
  plan: string;
  status: string;
};

type RepoFile = {
  path: string;
  content: string;
};

type DocumentRecord = {
  id: string;
  title: string;
  content: string;
};

type AlertRecord = {
  id: string;
  service: string;
  severity: string;
  summary: string;
};

type LogRecord = {
  service: string;
  lines: string[];
};

type ServiceStatus = {
  service: string;
  status: string;
  owner: string;
};

function loadFixture<T>(path: string): T {
  const raw = readFileSync(resolve(path), "utf8");
  return JSON.parse(raw) as T;
}

const BUILTIN_TOOLS: LoadedTool[] = [
  {
    spec: {
      name: "crm.search_customer",
      description: "Find a customer by email.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          email: { type: "string", description: "Customer email address." },
        },
        required: ["email"],
      },
    },
    handler: async (input) => {
      assertObject(input);
      const email = String(input.email ?? "");
      const customers = loadFixture<Customer[]>("fixtures/support/customers.json");
      const customer = customers.find((candidate) => candidate.email === email);
      if (!customer) {
        throw new Error(`Customer with email '${email}' not found.`);
      }

      return customer;
    },
  },
  {
    spec: {
      name: "orders.list",
      description: "List orders for a given customer id.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          customer_id: { type: "string", description: "Customer id returned from CRM." },
        },
        required: ["customer_id"],
      },
    },
    handler: async (input) => {
      assertObject(input);
      const customerId = String(input.customer_id ?? "");
      const orders = loadFixture<Order[]>("fixtures/support/orders.json");
      return orders.filter((order) => order.customer_id === customerId);
    },
  },
  {
    spec: {
      name: "orders.refund",
      description: "Refund a single order by id.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          order_id: { type: "string", description: "Order id to refund." },
        },
        required: ["order_id"],
      },
    },
    handler: async (input) => {
      assertObject(input);
      const orderId = String(input.order_id ?? "");
      const orders = loadFixture<Order[]>("fixtures/support/orders.json");
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order) {
        throw new Error(`Order '${orderId}' not found.`);
      }

      return {
        refunded: true,
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
      };
    },
  },
  {
    spec: {
      name: "accounts.get_profile",
      description: "Fetch account profile details for a customer id.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          customer_id: { type: "string" },
        },
        required: ["customer_id"],
      },
    },
    handler: async (input) => {
      assertObject(input);
      const customerId = String(input.customer_id ?? "");
      const accounts = loadFixture<Account[]>("fixtures/support/accounts.json");
      const account = accounts.find((candidate) => candidate.customer_id === customerId);
      if (!account) {
        throw new Error(`Account for customer '${customerId}' not found.`);
      }
      return account;
    },
  },
  {
    spec: {
      name: "accounts.update_newsletter",
      description: "Update newsletter subscription for a customer id.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          customer_id: { type: "string" },
          subscribed: { type: "boolean" },
        },
        required: ["customer_id", "subscribed"],
      },
    },
    handler: async (input) => {
      assertObject(input);
      return {
        customer_id: String(input.customer_id ?? ""),
        newsletter_subscribed: Boolean(input.subscribed),
        updated: true,
      };
    },
  },
  {
    spec: {
      name: "subscriptions.cancel",
      description: "Cancel an active subscription by customer id.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          customer_id: { type: "string" },
        },
        required: ["customer_id"],
      },
    },
    handler: async (input) => {
      assertObject(input);
      const customerId = String(input.customer_id ?? "");
      const subscriptions = loadFixture<Subscription[]>("fixtures/support/subscriptions.json");
      const subscription = subscriptions.find((candidate) => candidate.customer_id === customerId && candidate.status === "active");
      if (!subscription) {
        throw new Error(`Active subscription for customer '${customerId}' not found.`);
      }
      return {
        subscription_id: subscription.subscription_id,
        status: "cancelled",
      };
    },
  },
  {
    spec: {
      name: "repo.list_files",
      description: "List files in a toy repository fixture.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    handler: async () => {
      const files = loadFixture<RepoFile[]>("fixtures/coding/repo-files.json");
      return files.map((file) => ({ path: file.path }));
    },
  },
  {
    spec: {
      name: "repo.read_file",
      description: "Read a file from the toy repository fixture.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
    handler: async (input) => {
      assertObject(input);
      const path = String(input.path ?? "");
      const files = loadFixture<RepoFile[]>("fixtures/coding/repo-files.json");
      const file = files.find((candidate) => candidate.path === path);
      if (!file) {
        throw new Error(`Repo file '${path}' not found.`);
      }
      return file;
    },
  },
  {
    spec: {
      name: "repo.apply_patch",
      description: "Apply a deterministic patch to a toy repository file.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          replacement: { type: "string" },
        },
        required: ["path", "replacement"],
      },
    },
    handler: async (input) => {
      assertObject(input);
      const path = String(input.path ?? "");
      const replacement = String(input.replacement ?? "");
      return {
        path,
        replacement,
        applied: true,
      };
    },
  },
  {
    spec: {
      name: "docs.search",
      description: "Search fixture-backed documents.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
    handler: async (input) => {
      assertObject(input);
      const query = String(input.query ?? "").toLowerCase();
      const docs = loadFixture<DocumentRecord[]>("fixtures/research/documents.json");
      return docs
        .filter((doc) => `${doc.title} ${doc.content}`.toLowerCase().includes(query))
        .map((doc) => ({ id: doc.id, title: doc.title }));
    },
  },
  {
    spec: {
      name: "docs.read",
      description: "Read one fixture-backed document by id.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          doc_id: { type: "string" },
        },
        required: ["doc_id"],
      },
    },
    handler: async (input) => {
      assertObject(input);
      const docId = String(input.doc_id ?? "");
      const docs = loadFixture<DocumentRecord[]>("fixtures/research/documents.json");
      const doc = docs.find((candidate) => candidate.id === docId);
      if (!doc) {
        throw new Error(`Document '${docId}' not found.`);
      }
      return doc;
    },
  },
  {
    spec: {
      name: "alerts.list_active",
      description: "List active synthetic alerts.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    handler: async () => {
      return loadFixture<AlertRecord[]>("fixtures/ops/alerts.json");
    },
  },
  {
    spec: {
      name: "logs.query_service",
      description: "Query synthetic logs for one service.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          service: { type: "string" },
        },
        required: ["service"],
      },
    },
    handler: async (input) => {
      assertObject(input);
      const service = String(input.service ?? "");
      const logs = loadFixture<LogRecord[]>("fixtures/ops/logs.json");
      const entry = logs.find((candidate) => candidate.service === service);
      if (!entry) {
        throw new Error(`Logs for service '${service}' not found.`);
      }
      return entry;
    },
  },
  {
    spec: {
      name: "status.get_service",
      description: "Read synthetic service ownership and status metadata.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          service: { type: "string" },
        },
        required: ["service"],
      },
    },
    handler: async (input) => {
      assertObject(input);
      const service = String(input.service ?? "");
      const statuses = loadFixture<ServiceStatus[]>("fixtures/ops/status.json");
      const status = statuses.find((candidate) => candidate.service === service);
      if (!status) {
        throw new Error(`Service status for '${service}' not found.`);
      }
      return status;
    },
  },
];

export async function loadToolRegistry(): Promise<Record<string, ToolHandler>> {
  const tools = await loadTools();
  return Object.fromEntries(tools.map((tool) => [tool.spec.name, tool.handler]));
}

export async function loadToolSpecs(): Promise<ToolSpec[]> {
  const tools = await loadTools();
  return tools.map((tool) => tool.spec);
}

export function getBuiltinToolSpecs(): ToolSpec[] {
  return BUILTIN_TOOLS.map((tool) => tool.spec);
}

async function loadTools(): Promise<LoadedTool[]> {
  const config = loadAgentLabConfig();
  const configuredTools = await Promise.all((config.tools ?? []).map((tool) => loadConfiguredTool(tool)));
  const merged = [...BUILTIN_TOOLS, ...configuredTools];
  const seen = new Set<string>();
  for (const tool of merged) {
    if (seen.has(tool.spec.name)) {
      throw new Error(`Duplicate tool registration for '${tool.spec.name}'.`);
    }
    seen.add(tool.spec.name);
  }
  return merged;
}

async function loadConfiguredTool(tool: ToolRegistration): Promise<LoadedTool> {
  const module = tool.package ? await importConfiguredPackageTool(tool) : await importConfiguredFileTool(tool);
  const candidate = module[tool.exportName!];
  if (typeof candidate !== "function") {
    throw new Error(`Tool '${tool.name}' export '${tool.exportName}' is not a function.`);
  }

  return {
    spec: {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    handler: candidate as ToolHandler,
  };
}

async function importConfiguredFileTool(tool: ToolRegistration): Promise<Record<string, unknown>> {
  const moduleUrl = pathToFileURL(resolve(tool.modulePath!)).href;
  return (await import(moduleUrl)) as Record<string, unknown>;
}

async function importConfiguredPackageTool(tool: ToolRegistration): Promise<Record<string, unknown>> {
  try {
    const requireFromCwd = createRequire(resolve(process.cwd(), "package.json"));
    const resolved = requireFromCwd.resolve(tool.package!);
    const moduleUrl = pathToFileURL(resolved).href;
    return (await import(moduleUrl)) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tool '${tool.name}' failed to load package '${tool.package}': ${message}`);
  }
}

function assertObject(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Tool input must be an object.");
  }
}

function waitUnref(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });
}
