import assert from "node:assert";
import test from "node:test";

import { printRunComparison } from "../src/index.js";
import type { RunBundle, RunComparison } from "../src/types.js";

test("printRunComparison celebrates score improvements", () => {
  const lines = captureConsole(() => {
    printRunComparison(makeComparison(60, 100, "improved"));
  });

  assert.match(lines.join("\n"), /Score improved 60 .+ 100/);
});

function captureConsole(fn: () => void): string[] {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    fn();
    return lines;
  } finally {
    console.log = original;
  }
}

function makeComparison(baselineScore: number, candidateScore: number, classification: RunComparison["classification"]): RunComparison {
  const baseline = makeBundle("run_base", baselineScore, "fail");
  const candidate = makeBundle("run_candidate", candidateScore, "pass");
  return {
    baseline,
    candidate,
    classification,
    verdictDelta: `${baseline.run.status} -> ${candidate.run.status}`,
    outputChanged: false,
    notes: [],
    deltas: {
      score: candidateScore - baselineScore,
      runtimeMs: 0,
      steps: 0,
      runtimePct: 0,
    },
    evaluatorDiffs: [],
    toolDiffs: [],
  };
}

function makeBundle(id: string, score: number, status: RunBundle["run"]["status"]): RunBundle {
  return {
    run: {
      id,
      scenarioId: "support.demo",
      scenarioFileHash: "hash",
      agentVersionId: "agent",
      status,
      terminationReason: status === "pass" ? "completed" : "evaluator_failed",
      finalOutput: "done",
      totalSteps: 1,
      totalToolCalls: 0,
      durationMs: 1,
      score,
      startedAt: "2026-05-10T00:00:00.000Z",
      finishedAt: "2026-05-10T00:00:01.000Z",
    },
    traceEvents: [],
    toolCalls: [],
    evaluatorResults: [],
  };
}
