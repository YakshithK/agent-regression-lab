import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Order = {
  id: string;
  customer_id: string;
  duplicate_group?: string;
};

export async function findDuplicateCharge(input: unknown): Promise<{ order_id: string }> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Tool input must be an object.");
  }

  const customerId = String((input as Record<string, unknown>).customer_id ?? "");
  const raw = readFileSync(resolve("fixtures/support/orders.json"), "utf8");
  const orders = JSON.parse(raw) as Order[];
  const duplicate = orders.find((order) => order.customer_id === customerId && order.duplicate_group === "dup_1" && order.id === "ord_1024");
  if (!duplicate) {
    throw new Error(`No duplicate charge found for customer '${customerId}'.`);
  }

  return { order_id: duplicate.id };
}
