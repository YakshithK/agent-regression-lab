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
  try {
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
  assert.equal(comparison.classification, "regressed");
  assert.equal(comparison.verdictDelta, "pass -> fail");
  assert.ok(comparison.notes.some((note) => note.includes("Termination changed")));
  assert.ok(comparison.evaluatorDiffs.some((diff) => diff.evaluatorId === "refund-created"));
  assert.ok(comparison.toolDiffs.some((diff) => diff.toolName === "orders.refund"));
  } finally {
    storage.close();
  }
});

test("storage configures sqlite busy timeout to reduce lock errors", () => {
  const storage = new Storage();
  try {
    const row = (storage as any).db.prepare("PRAGMA busy_timeout;").get() as { timeout?: number; busy_timeout?: number };
    const timeout = row.timeout ?? row.busy_timeout ?? 0;
    assert.ok(timeout > 0);
  } finally {
    storage.close();
  }
});

test("storage preserves variant and config identity fields", () => {
  const storage = new Storage();
  try {
    const richAgentVersion: AgentVersion = {
      ...agentVersion,
      id: `agent_storage_identity_${Date.now()}`,
      variantSetName: "refund-agent-model-comparison",
      variantLabel: "baseline",
      promptVersion: "prompt-v3",
      modelVersion: "mock-model-v1",
      toolSchemaVersion: "refunds-v2",
      configLabel: "baseline-config",
      configHash: "cfg_test_hash",
      runtimeProfileName: "timeout-orders-tool",
      suiteDefinitionName: "pre_merge",
    };
    storage.upsertAgentVersion(richAgentVersion);

    const bundle = makeBundle(`run_identity_${Date.now()}`, {
      agentVersionId: richAgentVersion.id,
      variantSetName: "refund-agent-model-comparison",
      variantLabel: "baseline",
      promptVersion: "prompt-v3",
      modelVersion: "mock-model-v1",
      toolSchemaVersion: "refunds-v2",
      configLabel: "baseline-config",
      configHash: "cfg_test_hash",
      runtimeProfileName: "timeout-orders-tool",
      suiteDefinitionName: "pre_merge",
    });
    bundle.agentVersion = richAgentVersion;

    storage.saveRun(bundle);

    const loaded = storage.getRun(bundle.run.id);
    assert.equal(loaded?.run.variantLabel, "baseline");
    assert.equal(loaded?.run.variantSetName, "refund-agent-model-comparison");
    assert.equal(loaded?.run.configHash, "cfg_test_hash");
    assert.equal(loaded?.run.runtimeProfileName, "timeout-orders-tool");
    assert.equal(loaded?.run.suiteDefinitionName, "pre_merge");
    assert.equal(loaded?.agentVersion?.promptVersion, "prompt-v3");
    assert.equal(loaded?.agentVersion?.toolSchemaVersion, "refunds-v2");
  } finally {
    storage.close();
  }
});

test("compareRuns rejects different scenario file hashes", () => {
  const storage = new Storage();
  try {
  storage.upsertAgentVersion(agentVersion);

  const baseline = makeBundle(`run_hash_base_${Date.now()}`, { scenarioFileHash: "hash_a" });
  const candidate = makeBundle(`run_hash_candidate_${Date.now()}`, { scenarioFileHash: "hash_b" });

  storage.saveRun(baseline);
  storage.saveRun(candidate);

  assert.throws(() => storage.compareRuns(baseline.run.id, candidate.run.id), /scenario file hash/);
  } finally {
    storage.close();
  }
});

test("compareSuites aggregates regressions and improvements by batch id", () => {
  const storage = new Storage();
  try {
  storage.upsertAgentVersion(agentVersion);

  const baselineBatchId = `suite_batch_base_${Date.now()}`;
  const candidateBatchId = `suite_batch_candidate_${Date.now()}`;

  const baselinePass = makeBundle(`run_suite_base_pass_${Date.now()}`, { suiteBatchId: baselineBatchId });
  const baselineFail = makeBundle(`run_suite_base_fail_${Date.now()}`, {
    scenarioId: "support.refund-via-config-tool",
    suiteBatchId: baselineBatchId,
    status: "fail",
    score: 20,
  });

  const candidateRegression = makeBundle(`run_suite_candidate_reg_${Date.now()}`, {
    suiteBatchId: candidateBatchId,
    status: "fail",
    terminationReason: "tool_error",
    score: 10,
  }, ["crm.search_customer", "orders.refund"]);
  const candidateImprovement = makeBundle(`run_suite_candidate_imp_${Date.now()}`, {
    scenarioId: "support.refund-via-config-tool",
    suiteBatchId: candidateBatchId,
    status: "pass",
    score: 100,
  });

  storage.saveRun(baselinePass);
  storage.saveRun(baselineFail);
  storage.saveRun(candidateRegression);
  storage.saveRun(candidateImprovement);

  const comparison = storage.compareSuites(baselineBatchId, candidateBatchId);
  assert.equal(comparison.classification, "regressed");
  assert.equal(comparison.regressions.length, 1);
  assert.equal(comparison.improvements.length, 1);
  assert.equal(comparison.regressions[0]?.scenarioId, "support.refund-correct-order");
  assert.equal(comparison.improvements[0]?.scenarioId, "support.refund-via-config-tool");
  } finally {
    storage.close();
  }
});

test("compareSuites rejects batches from different suites", () => {
  const storage = new Storage();
  try {
  storage.upsertAgentVersion(agentVersion);

  const baselineBatchId = `suite_batch_support_${Date.now()}`;
  const candidateBatchId = `suite_batch_ops_${Date.now()}`;

  const supportRun = makeBundle(`run_suite_support_${Date.now()}`, { suiteBatchId: baselineBatchId });
  const opsRun = makeBundle(`run_suite_ops_${Date.now()}`, {
    scenarioId: "ops.payments-api-alert",
    suiteBatchId: candidateBatchId,
  });

  storage.saveRun(supportRun);
  storage.saveRun(opsRun);

  assert.throws(() => storage.compareSuites(baselineBatchId, candidateBatchId), /share the same suite/);
  } finally {
    storage.close();
  }
});
