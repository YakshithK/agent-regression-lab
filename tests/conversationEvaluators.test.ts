import test from "node:test";
import assert from "node:assert";

import { evaluateStep, evaluateConversationEnd } from "../src/conversationEvaluators.js";
import type { ConversationEvaluatorSpec } from "../src/types.js";

// --- response_contains ---

test("response_contains passes when all keywords present (case-insensitive)", () => {
  const evaluators: ConversationEvaluatorSpec[] = [
    { type: "response_contains", mode: "hard_gate", config: { keywords: ["shipped", "tracking"] } },
  ];
  const results = evaluateStep("Your order has been SHIPPED, tracking number TRK123", 100, evaluators, 0);
  assert.strictEqual(results[0].status, "pass");
});

test("response_contains fails when a keyword is missing", () => {
  const evaluators: ConversationEvaluatorSpec[] = [
    { type: "response_contains", mode: "hard_gate", config: { keywords: ["shipped", "tracking"] } },
  ];
  const results = evaluateStep("Your order has been shipped.", 100, evaluators, 0);
  assert.strictEqual(results[0].status, "fail");
});

// --- response_not_contains ---

test("response_not_contains passes when none of the keywords appear", () => {
  const evaluators: ConversationEvaluatorSpec[] = [
    { type: "response_not_contains", mode: "weighted", weight: 1, config: { keywords: ["error", "don't know"] } },
  ];
  const results = evaluateStep("Your order is on the way.", 100, evaluators, 1);
  assert.strictEqual(results[0].status, "pass");
});

test("response_not_contains fails when a forbidden keyword appears", () => {
  const evaluators: ConversationEvaluatorSpec[] = [
    { type: "response_not_contains", mode: "weighted", weight: 1, config: { keywords: ["error", "don't know"] } },
  ];
  const results = evaluateStep("I don't know where your order is.", 100, evaluators, 1);
  assert.strictEqual(results[0].status, "fail");
});

// --- response_matches_regex ---

test("response_matches_regex passes when pattern matches", () => {
  const evaluators: ConversationEvaluatorSpec[] = [
    { type: "response_matches_regex", mode: "hard_gate", config: { pattern: "TRK\\d+" } },
  ];
  const results = evaluateStep("Your tracking number is TRK98765.", 100, evaluators, 0);
  assert.strictEqual(results[0].status, "pass");
});

test("response_matches_regex fails when pattern does not match", () => {
  const evaluators: ConversationEvaluatorSpec[] = [
    { type: "response_matches_regex", mode: "hard_gate", config: { pattern: "TRK\\d+" } },
  ];
  const results = evaluateStep("No tracking info available.", 100, evaluators, 0);
  assert.strictEqual(results[0].status, "fail");
});

// --- response_latency_max ---

test("response_latency_max passes when under limit", () => {
  const evaluators: ConversationEvaluatorSpec[] = [
    { type: "response_latency_max", mode: "hard_gate", config: { ms: 3000 } },
  ];
  const results = evaluateStep("reply", 240, evaluators, 0);
  assert.strictEqual(results[0].status, "pass");
});

test("response_latency_max fails when over limit", () => {
  const evaluators: ConversationEvaluatorSpec[] = [
    { type: "response_latency_max", mode: "hard_gate", config: { ms: 3000 } },
  ];
  const results = evaluateStep("reply", 3500, evaluators, 0);
  assert.strictEqual(results[0].status, "fail");
});

// --- evaluateConversationEnd ---

test("step_count_max passes when total turns within limit", () => {
  const evaluators: ConversationEvaluatorSpec[] = [
    { type: "step_count_max", mode: "hard_gate", config: { max: 10 } },
  ];
  const results = evaluateConversationEnd("final reply", 3, evaluators);
  assert.strictEqual(results[0].status, "pass");
});

test("step_count_max fails when total turns exceed limit", () => {
  const evaluators: ConversationEvaluatorSpec[] = [
    { type: "step_count_max", mode: "hard_gate", config: { max: 2 } },
  ];
  const results = evaluateConversationEnd("final reply", 5, evaluators);
  assert.strictEqual(results[0].status, "fail");
});

test("final_answer_contains passes when keyword present in final reply", () => {
  const evaluators: ConversationEvaluatorSpec[] = [
    { type: "final_answer_contains", mode: "weighted", weight: 1, config: { keywords: ["tracking"] } },
  ];
  const results = evaluateConversationEnd("Your tracking number is TRK123.", 2, evaluators);
  assert.strictEqual(results[0].status, "pass");
});

test("exact_final_answer passes on exact match", () => {
  const evaluators: ConversationEvaluatorSpec[] = [
    { type: "exact_final_answer", mode: "hard_gate", config: { expected: "goodbye" } },
  ];
  const results = evaluateConversationEnd("goodbye", 1, evaluators);
  assert.strictEqual(results[0].status, "pass");
});

test("exact_final_answer fails on mismatch", () => {
  const evaluators: ConversationEvaluatorSpec[] = [
    { type: "exact_final_answer", mode: "hard_gate", config: { expected: "goodbye" } },
  ];
  const results = evaluateConversationEnd("farewell", 1, evaluators);
  assert.strictEqual(results[0].status, "fail");
});

test("conversation evaluators keep operational checks scoped to step/turn semantics", () => {
  const stepResults = evaluateStep(
    "reply",
    250,
    [{ type: "response_latency_max", mode: "hard_gate", config: { ms: 300 } }],
    0,
  );
  const endResults = evaluateConversationEnd(
    "reply",
    2,
    [{ type: "step_count_max", mode: "hard_gate", config: { max: 3 } }],
  );
  assert.strictEqual(stepResults[0].status, "pass");
  assert.strictEqual(endResults[0].status, "pass");
});

// --- evaluator ID generation ---

test("evaluateStep generates deterministic evaluator IDs", () => {
  const evaluators: ConversationEvaluatorSpec[] = [
    { type: "response_contains", mode: "hard_gate", config: { keywords: ["hello"] } },
    { type: "response_latency_max", mode: "hard_gate", config: { ms: 1000 } },
  ];
  const results = evaluateStep("hello world", 50, evaluators, 2);
  assert.strictEqual(results[0].evaluatorId, "step_2_response_contains_0");
  assert.strictEqual(results[1].evaluatorId, "step_2_response_latency_max_1");
});
