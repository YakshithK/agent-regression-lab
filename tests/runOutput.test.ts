/**
 * Tests for runOutput.ts — formatCliErrorMessage ensureFixCommand paths
 * and getFailedEvaluatorSummaries.
 */
import test, { describe } from "node:test";
import assert from "node:assert";

import { formatCliErrorMessage, getFailedEvaluatorSummaries } from "../src/runOutput.js";
import type { RunBundle } from "../src/types.js";

function makeBundle(overrides: Partial<RunBundle> = {}): RunBundle {
  return {
    run: {
      id: "run_test",
      scenarioId: "support.demo",
      scenarioFileHash: "hash",
      agentVersionId: "agent",
      status: "fail",
      terminationReason: "evaluator_failed",
      finalOutput: "done",
      totalSteps: 1,
      totalToolCalls: 0,
      durationMs: 100,
      score: 50,
      startedAt: "2026-05-10T00:00:00.000Z",
      finishedAt: "2026-05-10T00:00:01.000Z",
    },
    traceEvents: [],
    toolCalls: [],
    evaluatorResults: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatCliErrorMessage — ensureFixCommand branch
// ---------------------------------------------------------------------------
describe("formatCliErrorMessage", () => {
  test("appends Run: agentlab help when message has no Run: hint", () => {
    const result = formatCliErrorMessage("Something broke");
    assert.match(result, /Something broke/);
    assert.match(result, /Run: agentlab help/);
  });

  test("does NOT double-append when message already contains Run:", () => {
    const result = formatCliErrorMessage("No scenario found.\n\nRun: agentlab list scenarios");
    // Should contain original Run: hint
    assert.match(result, /Run: agentlab list scenarios/);
    // Should NOT also contain agentlab help (which would be the fallback)
    assert.doesNotMatch(result, /Run: agentlab help/);
  });

  test("database lock message contains sequential guidance and Run: hint", () => {
    const result = formatCliErrorMessage("database is locked");
    assert.match(result, /SQLite database is locked/);
    assert.match(result, /Run: agentlab run <scenario-id>/);
  });

  test("always returns a non-empty string", () => {
    const result = formatCliErrorMessage("any error");
    assert.ok(result.length > 0);
  });
});

// ---------------------------------------------------------------------------
// getFailedEvaluatorSummaries
// ---------------------------------------------------------------------------
describe("getFailedEvaluatorSummaries", () => {
  test("returns empty array when all evaluators pass", () => {
    const bundle = makeBundle({
      evaluatorResults: [
        { evaluatorId: "e1", evaluatorType: "final_answer_contains", mode: "hard_gate", status: "pass", message: "ok" },
      ],
    });
    assert.deepStrictEqual(getFailedEvaluatorSummaries(bundle), []);
  });

  test("returns failed evaluator summaries", () => {
    const bundle = makeBundle({
      evaluatorResults: [
        { evaluatorId: "e1", evaluatorType: "final_answer_contains", mode: "hard_gate", status: "fail", message: "missing: hello" },
        { evaluatorId: "e2", evaluatorType: "tool_call_assertion", mode: "hard_gate", status: "pass", message: "ok" },
      ],
    });
    const summaries = getFailedEvaluatorSummaries(bundle);
    assert.equal(summaries.length, 1);
    assert.ok(summaries[0]!.includes("e1") || summaries[0]!.includes("missing: hello"));
  });

  test("returns multiple failed evaluators", () => {
    const bundle = makeBundle({
      evaluatorResults: [
        { evaluatorId: "e1", evaluatorType: "final_answer_contains", mode: "hard_gate", status: "fail", message: "bad1" },
        { evaluatorId: "e2", evaluatorType: "forbidden_tool", mode: "hard_gate", status: "fail", message: "bad2" },
      ],
    });
    assert.equal(getFailedEvaluatorSummaries(bundle).length, 2);
  });

  test("returns empty array when no evaluators present", () => {
    const bundle = makeBundle({ evaluatorResults: [] });
    assert.deepStrictEqual(getFailedEvaluatorSummaries(bundle), []);
  });
});
