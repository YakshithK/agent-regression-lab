import test from "node:test";
import assert from "node:assert";

import { evaluateScenario } from "../src/evaluators.js";
import type { RunRecord, RunBundle, ScenarioEvaluator } from "../src/types.js";

const baseRun: RunRecord = {
  id: "run_test",
  scenarioId: "support.refund",
  scenarioFileHash: "abc",
  agentVersionId: "agent_v1",
  status: "pass",
  terminationReason: "completed",
  finalOutput: "It was refunded on ord_1024.",
  totalSteps: 1,
  totalToolCalls: 1,
  durationMs: 100,
  totalTokens: 0,
  totalCostUsd: 0,
  score: 100,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
};

const makeBundle = (overrides: Partial<RunRecord> = {}): RunBundle => ({
  run: { ...baseRun, ...overrides },
  traceEvents: [],
  toolCalls: [],
  evaluatorResults: [],
});

const createEvaluator = (output: string): ScenarioEvaluator => ({
  id: "final-answer",
  type: "final_answer_contains",
  mode: "weighted",
  weight: 10,
  config: { required_substrings: ["refunded", "ord_1024"] },
});

test("final_answer_contains evaluates with normalized text", () => {
  const bundle = makeBundle({ finalOutput: "The order was REFUNDED for ord_1024" });
  const results = evaluateScenario(bundle, [createEvaluator(bundle.run.finalOutput)]);
  assert.strictEqual(results[0].status, "pass");
});

test("final_answer_contains fails when keywords missing regardless of casing", () => {
  const bundle = makeBundle({ finalOutput: "The order was processed for ord_1024" });
  const results = evaluateScenario(bundle, [createEvaluator(bundle.run.finalOutput)]);
  assert.strictEqual(results[0].status, "fail");
});
