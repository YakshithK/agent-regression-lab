import test from "node:test";
import assert from "node:assert";

import { ExternalProcessAgentAdapter } from "../src/agent/externalProcessAdapter.js";
import type { AgentRunInput } from "../src/types.js";

const runInput: AgentRunInput = {
  instructions: "test",
  availableTools: [{ name: "support.test_tool" }],
  context: { foo: "bar" },
};

test("external adapter completes tool flow", async () => {
  const adapter = new ExternalProcessAgentAdapter({
    command: "node",
    args: ["tests/fixtures/external-agent.mjs"],
    envAllowlist: [],
    responseTimeoutMs: 2000,
  });
  const session = await adapter.startRun(runInput);
  const toolCall = await session.next({ type: "run_started" });
  assert.equal(toolCall.type, "tool_call");
  assert.equal(toolCall.toolName, "support.test_tool");

  const final = await session.next({ type: "tool_result", toolName: "support.test_tool", result: { foo: "bar" } });
  assert.equal(final.type, "final");
  assert.match(final.output, /Done after/);
});
