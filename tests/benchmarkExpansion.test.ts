import assert from "node:assert";
import test from "node:test";

import { MockAgentAdapter } from "../src/agent/mockAdapter.js";
import { createAgentVersionId } from "../src/lib/id.js";
import { runScenario } from "../src/runner.js";
import { loadScenarioById } from "../src/scenarios.js";
import { loadToolRegistry, loadToolSpecs } from "../src/tools.js";
import type { AgentVersion } from "../src/types.js";

const mockVersion: AgentVersion = {
  id: createAgentVersionId("mock-benchmark-test", { provider: "mock" }),
  label: "mock-benchmark-test",
  modelId: "mock-model",
  provider: "mock",
  config: { provider: "mock" },
};

async function runMockScenario(scenarioId: string) {
  const scenario = loadScenarioById(scenarioId);
  const toolSpecs = await loadToolSpecs();
  const tools = await loadToolRegistry();
  return await runScenario({
    agentAdapter: new MockAgentAdapter(),
    agentVersion: mockVersion,
    scenario: scenario.definition,
    scenarioFileHash: scenario.fileHash,
    toolSpecs,
    tools,
  });
}

test("mock agent completes one scenario per new domain", async () => {
  const scenarioIds = [
    "support.disable-newsletter",
    "coding.fix-add-function",
    "research.remote-work-policy",
    "ops.payments-api-alert",
  ];

  for (const scenarioId of scenarioIds) {
    const bundle = await runMockScenario(scenarioId);
    assert.equal(bundle.run.status, "pass", `expected ${scenarioId} to pass`);
  }
});

test("bob refund scenario exercises Bob-specific duplicate order path", async () => {
  const bundle = await runMockScenario("support.refund-bob-order");
  assert.equal(bundle.run.status, "pass");
  assert.ok(bundle.toolCalls.some((call) => call.toolName === "orders.refund" && (call.input as { order_id?: string }).order_id === "ord_2001"));
  assert.match(bundle.run.finalOutput, /ord_2001/);
});
