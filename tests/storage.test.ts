import assert from "node:assert";
import test from "node:test";

import { Storage } from "../src/storage.js";
import type { AgentVersion, RunBundle } from "../src/types.js";

const agentVersion: AgentVersion = {
  id: `agent_storage_test_${Date.now()}`,
  label: "storage-test-agent",
  provider: "external_process",
  command: "node",
  args: ["custom_agents/node_agent.mjs"],
  config: { provider: "external_process" },
};

function makeBundle(id: string, overrides: Partial<RunBundle["run"]> = {}, toolNames: string[] = []): RunBundle {
  return {
    run: {
      id,
      scenarioId: "support.refund-correct-order",
      scenarioFileHash: "hash_same",
      agentVersionId: agentVersion.id,
      status: "pass",
      terminationReason: "completed",
      finalOutput: "Refunded ord_1024",
      totalSteps: 3,
      totalToolCalls: toolNames.length,
      durationMs: 100,
      score: 100,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ...overrides,
    },
    traceEvents: [],
    toolCalls: toolNames.map((toolName, index) => ({
      id: `${id}_tool_${index}`,
      stepIndex: index + 1,
      toolName,
      input: {},
      output: {},
      status: "pass",
    })),
    evaluatorResults: [
      {
        evaluatorId: "refund-created",
        evaluatorType: "tool_call_assertion",
        mode: "hard_gate",
        status: overrides.status === "fail" ? "fail" : "pass",
        message: "refund evaluator",
      },
    ],
    agentVersion,
  };
}

test("compareRuns includes evaluator and tool diffs", () => {
  const storage = new Storage();
  storage.upsertAgentVersion(agentVersion);

  const baseline = makeBundle(`run_compare_base_${Date.now()}`, {}, ["crm.search_customer"]);
  const candidate = makeBundle(
    `run_compare_candidate_${Date.now()}`,
    { status: "fail", terminationReason: "tool_error", score: 0, totalSteps: 4 },
    ["crm.search_customer", "orders.refund"],
  );

  storage.saveRun(baseline);
  storage.saveRun(candidate);

  const comparison = storage.compareRuns(baseline.run.id, candidate.run.id);
  assert.ok(comparison.notes.some((note) => note.includes("Termination changed")));
  assert.ok(comparison.evaluatorDiffs.some((diff) => diff.evaluatorId === "refund-created"));
  assert.ok(comparison.toolDiffs.some((diff) => diff.toolName === "orders.refund"));
});

test("compareRuns rejects different scenario file hashes", () => {
  const storage = new Storage();
  storage.upsertAgentVersion(agentVersion);

  const baseline = makeBundle(`run_hash_base_${Date.now()}`, { scenarioFileHash: "hash_a" });
  const candidate = makeBundle(`run_hash_candidate_${Date.now()}`, { scenarioFileHash: "hash_b" });

  storage.saveRun(baseline);
  storage.saveRun(candidate);

  assert.throws(() => storage.compareRuns(baseline.run.id, candidate.run.id), /scenario file hash/);
});
