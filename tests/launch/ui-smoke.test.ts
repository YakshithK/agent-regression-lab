import assert from "node:assert";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getFailedEvaluatorSummaries } from "../../src/runOutput.js";
import { ComparisonHero, FailureSummaryPanel, RunIdentitySummary, SuiteComparisonHero, summarizeRuns } from "../../src/ui/App.js";
import type { RunBundle } from "../../src/types.js";

test("CLI failure summaries list failing evaluators explicitly", () => {
  const bundle: RunBundle = {
    run: {
      id: "run_1",
      scenarioId: "support.refund-correct-order",
      scenarioFileHash: "hash",
      agentVersionId: "agent_1",
      status: "fail",
      terminationReason: "evaluator_failed",
      finalOutput: "I refunded the wrong order.",
      totalSteps: 3,
      totalToolCalls: 1,
      durationMs: 12,
      score: 0,
      startedAt: "2026-04-09T00:00:00.000Z",
      finishedAt: "2026-04-09T00:00:00.012Z",
    },
    traceEvents: [],
    toolCalls: [],
    evaluatorResults: [
      {
        evaluatorId: "refund-created",
        evaluatorType: "tool_call_assertion",
        mode: "hard_gate",
        status: "fail",
        message: "Expected orders.refund for ord_1024.",
      },
      {
        evaluatorId: "tone",
        evaluatorType: "final_answer_contains",
        mode: "weighted",
        status: "pass",
        message: "Answer acknowledged the refund.",
      },
    ],
  };

  assert.deepEqual(getFailedEvaluatorSummaries(bundle), ["refund-created: Expected orders.refund for ord_1024."]);
});

test("run detail UI surfaces failure summary before trace-heavy sections", () => {
  const markup = renderToStaticMarkup(
    React.createElement(FailureSummaryPanel, {
      detail: {
        run: {
          id: "run_1",
          scenarioId: "support.refund-correct-order",
          status: "fail",
          score: 0,
          durationMs: 12,
          totalSteps: 3,
          terminationReason: "evaluator_failed",
          finalOutput: "I refunded the wrong order.",
          startedAt: "2026-04-09T00:00:00.000Z",
        },
        evaluatorResults: [
          {
            evaluatorId: "refund-created",
            status: "fail",
            message: "Expected orders.refund for ord_1024.",
          },
        ],
        toolCalls: [],
        traceEvents: [],
        errorDetail: "Refund API rejected the request.",
      },
    }),
  );

  assert.match(markup, /Failures First/);
  assert.match(markup, /Termination:/);
  assert.match(markup, /Error: Refund API rejected the request\./);
  assert.match(markup, /Evaluator refund-created: Expected orders\.refund for ord_1024\./);
});

test("run detail UI shows variant and runtime identity metadata", () => {
  const markup = renderToStaticMarkup(
    React.createElement(RunIdentitySummary, {
      detail: {
        run: {
          id: "run_2",
          scenarioId: "support.refund-correct-order",
          status: "pass",
          score: 100,
          durationMs: 10,
          totalSteps: 3,
          terminationReason: "completed",
          finalOutput: "Refunded ord_1024.",
          startedAt: "2026-04-09T00:00:00.000Z",
          variantSetName: "refund-agent-model-comparison",
          variantLabel: "baseline",
          promptVersion: "prompt-v3",
          modelVersion: "mock-model-a",
          toolSchemaVersion: "refunds-v2",
          configLabel: "baseline-config",
          runtimeProfileName: "timeout-orders-tool",
          suiteDefinitionName: "pre_merge",
        },
        evaluatorResults: [],
        toolCalls: [],
        traceEvents: [],
      },
    }),
  );

  assert.match(markup, /Variant set:/);
  assert.match(markup, /refund-agent-model-comparison/);
  assert.match(markup, /Variant:/);
  assert.match(markup, /baseline/);
  assert.match(markup, /Runtime profile:/);
  assert.match(markup, /timeout-orders-tool/);
  assert.match(markup, /Suite definition:/);
  assert.match(markup, /pre_merge/);
});

test("runs dashboard summary counts pass fail and error states", () => {
  const summary = summarizeRuns([
    {
      id: "run_1",
      scenarioId: "support.refund-correct-order",
      suite: "support",
      agentVersionId: "agent_1",
      provider: "mock",
      status: "pass",
      score: 100,
      durationMs: 10,
      totalSteps: 3,
      startedAt: "2026-04-09T00:00:00.000Z",
    },
    {
      id: "run_2",
      scenarioId: "support.refund-correct-order",
      suite: "support",
      agentVersionId: "agent_1",
      provider: "http",
      status: "fail",
      score: 0,
      durationMs: 20,
      totalSteps: 2,
      startedAt: "2026-04-09T00:01:00.000Z",
    },
    {
      id: "run_3",
      scenarioId: "ops.payments-api-alert",
      suite: "ops",
      agentVersionId: "agent_2",
      provider: "external_process",
      status: "error",
      score: 0,
      durationMs: 30,
      totalSteps: 1,
      startedAt: "2026-04-09T00:02:00.000Z",
    },
  ]);

  assert.deepEqual(summary, {
    total: 3,
    pass: 1,
    fail: 1,
    error: 1,
    latestSuite: "support",
    latestProvider: "mock",
  });
});

test("compare hero surfaces classification and verdict delta", () => {
  const markup = renderToStaticMarkup(
    React.createElement(ComparisonHero, {
      comparison: {
        classification: "regressed",
        verdictDelta: "pass -> fail",
        outputChanged: true,
        deltas: { score: -100, runtimeMs: 25, steps: 2, runtimePct: 50 },
        notes: [],
        evaluatorDiffs: [],
        toolDiffs: [],
        baseline: {
          run: {
            id: "run_a",
            scenarioId: "support.refund-correct-order",
            status: "pass",
            score: 100,
            durationMs: 10,
            totalSteps: 3,
            terminationReason: "completed",
            finalOutput: "ok",
            startedAt: "2026-04-09T00:00:00.000Z",
          },
          evaluatorResults: [],
          toolCalls: [],
          traceEvents: [],
        },
        candidate: {
          run: {
            id: "run_b",
            scenarioId: "support.refund-correct-order",
            status: "fail",
            score: 0,
            durationMs: 35,
            totalSteps: 5,
            terminationReason: "evaluator_failed",
            finalOutput: "bad",
            startedAt: "2026-04-09T00:01:00.000Z",
          },
          evaluatorResults: [],
          toolCalls: [],
          traceEvents: [],
        },
      },
    }),
  );

  assert.match(markup, /regressed/);
  assert.match(markup, /pass -&gt; fail/);
  assert.match(markup, /Output changed: yes/);
});

test("suite comparison hero highlights regression and improvement counts", () => {
  const markup = renderToStaticMarkup(
    React.createElement(SuiteComparisonHero, {
      data: {
        suite: "support",
        baselineBatchId: "suite_a",
        candidateBatchId: "suite_b",
        classification: "regressed",
        notes: [],
        deltas: {
          pass: -1,
          fail: 1,
          error: 0,
          averageScore: -20,
          averageRuntimeMs: 15,
          averageSteps: 1,
        },
        regressions: [{ scenarioId: "support.refund-correct-order", comparison: {} as any }],
        improvements: [{ scenarioId: "support.cancel-subscription", comparison: {} as any }],
        unchanged: [],
        missingFromCandidate: [],
        missingFromBaseline: [],
      },
    }),
  );

  assert.match(markup, /Suite movement/);
  assert.match(markup, /Regressions/);
  assert.match(markup, />1</);
  assert.match(markup, /Improvements/);
});
