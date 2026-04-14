export async function findDuplicateCharge(input) {
  const customerId = String(input?.customer_id ?? "");
  if (!customerId) {
    throw new Error("customer_id is required");
  }

  return { order_id: `dup_${customerId}` };
}
