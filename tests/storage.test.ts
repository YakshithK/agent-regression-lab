import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
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

test("saveRun stores normalize config and compareRuns applies baseline normalization rules to both runs", () => {
  const storage = new Storage();
  try {
    storage.upsertAgentVersion(agentVersion);

    const baseline = makeBundle(`run_normalize_base_${Date.now()}`, {
      finalOutput: "Refunded on May 10 2026",
      normalizeConfig: ["ignore_dates"],
    });
    const candidate = makeBundle(`run_normalize_candidate_${Date.now()}`, {
      finalOutput: "Refunded on 2026-05-11",
      normalizeConfig: [],
    });

    storage.saveRun(baseline);
    storage.saveRun(candidate);

    const loaded = storage.getRun(baseline.run.id);
    assert.deepEqual(loaded?.run.normalizeConfig, ["ignore_dates"]);

    const comparison = storage.compareRuns(baseline.run.id, candidate.run.id);
    assert.equal(comparison.outputChanged, false);
    assert.ok(!comparison.notes.includes("Final output changed."));
  } finally {
    storage.close();
  }
});

test("approveRun marks one baseline per scenario and agent version", () => {
  const storage = new Storage();
  try {
    storage.upsertAgentVersion(agentVersion);

    const first = makeBundle(`run_approve_first_${Date.now()}`);
    const second = makeBundle(`run_approve_second_${Date.now()}`);
    storage.saveRun(first);
    storage.saveRun(second);

    assert.equal(storage.approveRun(first.run.id).status, "approved");
    assert.equal(storage.approveRun(first.run.id).status, "already_baseline");
    assert.equal(storage.getBaselineRun(first.run.scenarioId, first.run.agentVersionId)?.run.id, first.run.id);

    assert.equal(storage.approveRun(second.run.id).status, "approved");
    assert.equal(storage.getBaselineRun(second.run.scenarioId, second.run.agentVersionId)?.run.id, second.run.id);
  } finally {
    storage.close();
  }
});

test("approveRun returns not_found for unknown run id", () => {
  const storage = new Storage();
  try {
    assert.equal(storage.approveRun(`run_missing_${Date.now()}`).status, "not_found");
  } finally {
    storage.close();
  }
});

test("Storage migrates v2 databases to v3 without losing existing runs", () => {
  const previousCwd = cwd();
  const root = join(tmpdir(), `arl_storage_migration_${Date.now()}`);
  mkdirSync(join(root, "artifacts"), { recursive: true });
  chdir(root);

  const db = new DatabaseSync(join(root, "artifacts", "agentlab.db"));
  try {
    db.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO metadata (key, value) VALUES ('schema_version', '2');

      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL,
        scenario_file_hash TEXT NOT NULL,
        agent_version_id TEXT NOT NULL,
        suite_batch_id TEXT,
        variant_set_name TEXT,
        variant_label TEXT,
        prompt_version TEXT,
        model_version TEXT,
        tool_schema_version TEXT,
        config_label TEXT,
        config_hash TEXT,
        runtime_profile_name TEXT,
        suite_definition_name TEXT,
        status TEXT NOT NULL,
        termination_reason TEXT NOT NULL,
        final_output TEXT NOT NULL,
        total_steps INTEGER NOT NULL,
        total_tool_calls INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        total_tokens INTEGER,
        total_cost_usd REAL,
        score INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL
      );
      INSERT INTO runs (
        id, scenario_id, scenario_file_hash, agent_version_id, status, termination_reason, final_output,
        total_steps, total_tool_calls, duration_ms, score, started_at, finished_at
      ) VALUES (
        'run_v2_existing', 'support.refund-correct-order', 'hash_same', 'agent_v2',
        'pass', 'completed', 'Refunded ord_1024', 1, 0, 10, 100, '2026-05-10T00:00:00.000Z', '2026-05-10T00:00:01.000Z'
      );
    `);
  } finally {
    db.close();
  }

  try {
    const storage = new Storage();
    try {
      const metadata = (storage as any).db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as { value: string };
      const columns = (storage as any).db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
      const columnNames = new Set(columns.map((column) => column.name));

      assert.equal(metadata.value, "3");
      assert.equal(columnNames.has("is_baseline"), true);
      assert.equal(columnNames.has("normalize_config_json"), true);
      assert.equal(storage.getRun("run_v2_existing")?.run.finalOutput, "Refunded ord_1024");
    } finally {
      storage.close();
    }
  } finally {
    chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
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
