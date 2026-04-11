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

test("tool_call_count_max fails when total tool calls exceed max", () => {
  const bundle = makeBundle({ totalToolCalls: 4 });
  bundle.toolCalls = [
    { id: "1", stepIndex: 1, toolName: "orders.list", input: {}, status: "pass" },
    { id: "2", stepIndex: 2, toolName: "orders.list", input: {}, status: "pass" },
    { id: "3", stepIndex: 3, toolName: "orders.refund", input: {}, status: "pass" },
    { id: "4", stepIndex: 4, toolName: "orders.refund", input: {}, status: "pass" },
  ];
  const results = evaluateScenario(bundle, [
    { id: "budget", type: "tool_call_count_max", mode: "hard_gate", config: { max: 3 } },
  ]);
  assert.strictEqual(results[0].status, "fail");
  assert.match(results[0].message, /exceeds max 3/);
});

test("tool_repeat_max fails when one tool is overused", () => {
  const bundle = makeBundle({ totalToolCalls: 3 });
  bundle.toolCalls = [
    { id: "1", stepIndex: 1, toolName: "orders.list", input: {}, status: "pass" },
    { id: "2", stepIndex: 2, toolName: "orders.list", input: {}, status: "pass" },
    { id: "3", stepIndex: 3, toolName: "orders.list", input: {}, status: "pass" },
  ];
  const results = evaluateScenario(bundle, [
    { id: "repeat", type: "tool_repeat_max", mode: "hard_gate", config: { tool: "orders.list", max: 2 } },
  ]);
  assert.strictEqual(results[0].status, "fail");
  assert.match(results[0].message, /orders\.list.*exceeds max 2/);
});

test("cost_max fails when total cost exceeds max", () => {
  const bundle = makeBundle({ totalCostUsd: 0.35 });
  const results = evaluateScenario(bundle, [
    { id: "cost", type: "cost_max", mode: "hard_gate", config: { max_usd: 0.25 } },
  ]);
  assert.strictEqual(results[0].status, "fail");
  assert.match(results[0].message, /exceeds max 0\.25/);
});

test("tool_call_count_max passes when total tool calls are within max", () => {
  const bundle = makeBundle({ totalToolCalls: 2 });
  const results = evaluateScenario(bundle, [
    { id: "budget-pass", type: "tool_call_count_max", mode: "hard_gate", config: { max: 3 } },
  ]);
  assert.strictEqual(results[0].status, "pass");
});

test("step_count_max uses config.max (task scenarios)", () => {
  const bundle = makeBundle({ totalSteps: 2 });
  const results = evaluateScenario(bundle, [
    { id: "steps", type: "step_count_max", mode: "hard_gate", config: { max: 3 } },
  ]);
  assert.strictEqual(results[0].status, "pass");
});

test("step_count_max still accepts config.max_steps for backwards compatibility", () => {
  const bundle = makeBundle({ totalSteps: 4 });
  const results = evaluateScenario(bundle, [
    { id: "steps", type: "step_count_max", mode: "hard_gate", config: { max_steps: 3 } },
  ]);
  assert.strictEqual(results[0].status, "fail");
});
