import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

let state = "start";

rl.on("line", (line) => {
  if (!line.trim()) return;

  let event;
  try {
    event = JSON.parse(line);
  } catch {
    respond({ type: "error", message: `Invalid JSON: ${line}` });
    return;
  }

  try {
    respond(handleEvent(event));
  } catch (error) {
    respond({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
});

function handleEvent(event) {
  if (event.type === "run_started") {
    state = "need_customer";
    const email = String(event.input?.context?.customer_email ?? "");
    return { type: "tool_call", toolName: "crm.search_customer", input: { email } };
  }

  if (event.type === "tool_result" && state === "need_customer") {
    state = "need_duplicate";
    const customerId = String(event.result?.id ?? "");
    return { type: "tool_call", toolName: "support.find_duplicate_charge", input: { customer_id: customerId } };
  }

  if (event.type === "tool_result" && state === "need_duplicate") {
    state = "need_refund";
    const orderId = String(event.result?.order_id ?? "");
    return { type: "tool_call", toolName: "orders.refund", input: { order_id: orderId } };
  }

  if (event.type === "tool_result" && state === "need_refund") {
    state = "done";
    const orderId = String(event.result?.order_id ?? "");
    const amount = String(event.result?.amount ?? "");
    const currency = String(event.result?.currency ?? "");
    return { type: "final", output: `Refunded duplicated charge on order ${orderId} for ${amount} ${currency}.` };
  }

  return { type: "error", message: `Unexpected event ${event.type} in state ${state}.` };
}

function respond(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
