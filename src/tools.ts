import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ToolSpec } from "./types.js";

export type ToolContext = {
  scenarioId: string;
};

export type ToolHandler = (input: unknown, context: ToolContext) => Promise<unknown>;

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

export function getToolSpecs(): ToolSpec[] {
  return [
    {
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
    {
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
    {
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
  ];
}

export function createToolRegistry(): Record<string, ToolHandler> {
  return {
    "crm.search_customer": async (input) => {
      assertObject(input);
      const email = String(input.email ?? "");
      const customers = loadFixture<Customer[]>("fixtures/support/customers.json");
      const customer = customers.find((candidate) => candidate.email === email);
      if (!customer) {
        throw new Error(`Customer with email '${email}' not found.`);
      }

      return customer;
    },
    "orders.list": async (input) => {
      assertObject(input);
      const customerId = String(input.customer_id ?? "");
      const orders = loadFixture<Order[]>("fixtures/support/orders.json");
      return orders.filter((order) => order.customer_id === customerId);
    },
    "orders.refund": async (input) => {
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
  };
}

function assertObject(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Tool input must be an object.");
  }
}
