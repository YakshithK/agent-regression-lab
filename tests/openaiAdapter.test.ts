import assert from "node:assert";
import test from "node:test";

import { OpenAIResponsesAgentAdapter } from "../src/agent/openaiResponsesAdapter.js";
import type { AgentRunInput } from "../src/types.js";

const runInput: AgentRunInput = {
  instructions: "Refund the duplicate order",
  availableTools: [
    {
      name: "orders.refund",
      description: "Refund an order",
      inputSchema: {
        type: "object",
        properties: {
          order_id: { type: "string" },
        },
        required: ["order_id"],
      },
    },
  ],
  context: { customer_email: "alice@example.com" },
  metadata: { model: "gpt-4o-mini" },
};

test("openai adapter maps provider tool calls back to internal tool names", async () => {
  let callCount = 0;
  const adapter = new OpenAIResponsesAgentAdapter({
    client: {
      responses: {
        create: async () => {
          callCount += 1;
          if (callCount === 1) {
            return {
              id: "resp_1",
              output: [
                {
                  type: "function_call",
                  name: "orders_refund",
                  call_id: "call_1",
                  arguments: JSON.stringify({ order_id: "ord_1024" }),
                },
              ],
            };
          }
          return {
            id: "resp_2",
            output: [],
            output_text: "Refunded duplicated charge on order ord_1024.",
          };
        },
      },
    } as any,
  });

  const session = await adapter.startRun(runInput);
  const toolCall = await session.next({ type: "run_started" });
  assert.equal(toolCall.type, "tool_call");
  assert.equal(toolCall.toolName, "orders.refund");

  const final = await session.next({ type: "tool_result", toolName: "orders.refund", result: { refunded: true } });
  assert.equal(final.type, "final");
  assert.match(final.output, /ord_1024/);
});
