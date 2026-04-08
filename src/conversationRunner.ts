import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

import { callHttpAgent } from "./agent/httpAdapter.js";
import { evaluateStep, evaluateConversationEnd } from "./conversationEvaluators.js";
import { computeScore } from "./scoring.js";
import { TraceRecorder } from "./trace.js";
import { createRunId } from "./lib/id.js";
import type {
  AgentVersion,
  ConversationScenarioDefinition,
  EvaluatorResult,
  HttpAgentRegistration,
  RunBundle,
  RunRecord,
  TerminationReason,
} from "./types.js";

type ConversationRunnerDeps = {
  httpConfig: HttpAgentRegistration;
  agentVersion: AgentVersion;
  scenario: ConversationScenarioDefinition;
  scenarioFileHash: string;
};

export async function runConversation(deps: ConversationRunnerDeps): Promise<RunBundle> {
  const { httpConfig, agentVersion, scenario, scenarioFileHash } = deps;
  const runId = createRunId();
  const startedAt = new Date().toISOString();
  const runStart = performance.now();
  const trace = new TraceRecorder(runId, scenario.id);
  const conversationId = randomUUID();
  const allEvaluatorResults: EvaluatorResult[] = [];

  trace.record("runner", "conversation_started", {
    conversationId,
    stepCount: scenario.steps.length,
    agentUrl: httpConfig.url,
    agentVersionId: agentVersion.id,
    scenarioVersionHash: scenarioFileHash,
  });

  let finalOutput = "";
  let terminationReason: TerminationReason = "completed";
  let status: RunRecord["status"] = "pass";
  let completedSteps = 0;

  for (let stepIndex = 0; stepIndex < scenario.steps.length; stepIndex += 1) {
    const step = scenario.steps[stepIndex];

    trace.record("runner", "turn_started", {
      stepIndex,
      message: step.message,
      conversationId,
    });

    let reply: string;
    let latencyMs: number;

    try {
      const result = await callHttpAgent({
        url: httpConfig.url,
        message: step.message,
        conversationId,
        request_template: httpConfig.request_template,
        response_field: httpConfig.response_field,
        headers: httpConfig.headers ?? {},
        timeout_ms: httpConfig.timeout_ms ?? 30000,
      });
      reply = result.reply;
      latencyMs = result.latencyMs;
    } catch (error) {
      const code = (error as { code?: string }).code;
      const message = error instanceof Error ? error.message : String(error);
      status = "error";
      terminationReason =
        code === "http_connection_failed"
          ? "http_connection_failed"
          : code === "http_error"
            ? "http_error"
            : code === "timeout_exceeded"
              ? "timeout_exceeded"
              : code === "invalid_response_format"
                ? "invalid_response_format"
                : "http_connection_failed";

      trace.record("runner", "conversation_finished", {
        status,
        terminationReason,
        totalTurns: completedSteps,
        durationMs: Math.round(performance.now() - runStart),
        errorMessage: message,
      });

      return buildBundle({
        runId,
        scenario,
        scenarioFileHash,
        agentVersion,
        startedAt,
        runStart,
        status,
        terminationReason,
        finalOutput: "",
        completedSteps,
        allEvaluatorResults,
        trace,
      });
    }

    completedSteps += 1;
    finalOutput = reply;

    trace.record("runner", "turn_completed", {
      stepIndex,
      reply,
      latencyMs,
    });

    if (step.evaluators && step.evaluators.length > 0) {
      const stepResults = evaluateStep(reply, latencyMs, step.evaluators, stepIndex);

      for (const result of stepResults) {
        trace.record("evaluator", "step_evaluation_result", {
          stepIndex,
          evaluatorId: result.evaluatorId,
          status: result.status,
          message: result.message,
        });
        allEvaluatorResults.push(result);
      }

      const hardGateFailed = stepResults.some((r) => r.mode === "hard_gate" && r.status === "fail");
      if (hardGateFailed) {
        status = "fail";
        terminationReason = "evaluator_failed";

        trace.record("runner", "conversation_finished", {
          status,
          terminationReason,
          totalTurns: completedSteps,
          durationMs: Math.round(performance.now() - runStart),
        });

        return buildBundle({
          runId,
          scenario,
          scenarioFileHash,
          agentVersion,
          startedAt,
          runStart,
          status,
          terminationReason,
          finalOutput,
          completedSteps,
          allEvaluatorResults,
          trace,
        });
      }
    }
  }

  // End-of-run evaluators
  if (scenario.evaluators && scenario.evaluators.length > 0) {
    trace.record("evaluator", "evaluation_started", {});
    const endResults = evaluateConversationEnd(finalOutput, completedSteps, scenario.evaluators);
    for (const result of endResults) {
      trace.record("evaluator", "evaluation_result", {
        evaluatorId: result.evaluatorId,
        status: result.status,
        message: result.message,
      });
      allEvaluatorResults.push(result);
    }
    trace.record("evaluator", "evaluation_finished", {});
  }

  const scoring = computeScore(allEvaluatorResults);
  if (status !== "error") {
    status = scoring.status;
    if (status === "fail" && terminationReason === "completed") {
      terminationReason = "evaluator_failed";
    }
  }

  trace.record("runner", "conversation_finished", {
    status,
    terminationReason,
    totalTurns: completedSteps,
    durationMs: Math.round(performance.now() - runStart),
  });

  return buildBundle({
    runId,
    scenario,
    scenarioFileHash,
    agentVersion,
    startedAt,
    runStart,
    status,
    terminationReason,
    finalOutput,
    completedSteps,
    allEvaluatorResults,
    trace,
    score: scoring.score,
  });
}

function buildBundle(input: {
  runId: string;
  scenario: ConversationScenarioDefinition;
  scenarioFileHash: string;
  agentVersion: AgentVersion;
  startedAt: string;
  runStart: number;
  status: RunRecord["status"];
  terminationReason: TerminationReason;
  finalOutput: string;
  completedSteps: number;
  allEvaluatorResults: EvaluatorResult[];
  trace: TraceRecorder;
  score?: number;
}): RunBundle {
  const {
    runId,
    scenario,
    scenarioFileHash,
    agentVersion,
    startedAt,
    runStart,
    status,
    terminationReason,
    finalOutput,
    completedSteps,
    allEvaluatorResults,
    trace,
  } = input;

  const durationMs = Math.round(performance.now() - runStart);
  const finishedAt = new Date().toISOString();
  const score = input.score ?? computeScore(allEvaluatorResults).score;

  const run: RunRecord = {
    id: runId,
    scenarioId: scenario.id,
    scenarioFileHash,
    agentVersionId: agentVersion.id,
    status,
    terminationReason,
    finalOutput,
    totalSteps: completedSteps,
    totalToolCalls: 0,
    durationMs,
    score,
    startedAt,
    finishedAt,
  };

  return {
    run,
    traceEvents: trace.getEvents(),
    toolCalls: [],
    evaluatorResults: allEvaluatorResults,
    agentVersion,
  };
}
