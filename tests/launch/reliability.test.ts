import test from "node:test";
import assert from "node:assert";

import { formatCliErrorMessage, getRunErrorDetail } from "../../src/runOutput.js";
import type { RunBundle } from "../../src/types.js";

function makeBundleWithTrace(type: string, payload: Record<string, unknown>): RunBundle {
  return {
    run: {
      id: "run_test",
      scenarioId: "internal-teams.memory-cross-session-leak",
      scenarioFileHash: "hash",
      agentVersionId: "agent",
      status: "error",
      terminationReason: "http_connection_failed",
      finalOutput: "",
      totalSteps: 0,
      totalToolCalls: 0,
      durationMs: 1,
      score: 0,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    },
    traceEvents: [
      {
        eventId: "e1",
        runId: "run_test",
        scenarioId: "internal-teams.memory-cross-session-leak",
        stepIndex: 1,
        timestamp: new Date().toISOString(),
        source: "runner",
        type: type as any,
        payload,
      },
    ],
    toolCalls: [],
    evaluatorResults: [],
  };
}

test("getRunErrorDetail returns conversation HTTP error detail", () => {
  const bundle = makeBundleWithTrace("conversation_finished", {
    errorMessage: "Connection to http://localhost:3000/api/chat failed",
  });
  assert.equal(getRunErrorDetail(bundle), "Connection to http://localhost:3000/api/chat failed");
});

test("formatCliErrorMessage rewrites database lock errors with sequential guidance", () => {
  assert.equal(
    formatCliErrorMessage("database is locked"),
    "SQLite database is locked. Retry the run sequentially or wait for the current run to finish.",
  );
});
