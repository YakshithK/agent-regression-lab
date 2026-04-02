import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { loadAgentLabConfig } from "./config.js";
import type { ToolRegistration, ToolSpec } from "./types.js";

export type ToolContext = {
  scenarioId: string;
};

export type ToolHandler = (input: unknown, context: ToolContext) => Promise<unknown>;

export type LoadedTool = {
  spec: ToolSpec;
  handler: ToolHandler;
};

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
  const moduleUrl = pathToFileURL(resolve(tool.modulePath!)).href;
  const module = await import(moduleUrl);
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

function assertObject(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Tool input must be an object.");
  }
}
