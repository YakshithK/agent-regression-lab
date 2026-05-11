import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getRuntimeProfile } from "./config.js";
import { createToolCallId, createRunId } from "./lib/id.js";
import { evaluateScenario } from "./evaluators.js";
import { computeScore } from "./scoring.js";
import { applyRuntimeProfileToTools } from "./tools.js";
import { TraceRecorder } from "./trace.js";
import type {
  AgentAdapter,
  AgentTurnResult,
  AgentVersion,
  RunBundle,
  RunRecord,
  ScenarioDefinition,
  TerminationReason,
  ToolCallRecord,
} from "./types.js";

type RunnerDeps = {
  agentAdapter: AgentAdapter;
  agentVersion: AgentVersion;
  scenario: ScenarioDefinition;
  scenarioFileHash: string;
  toolSpecs: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  tools: Record<string, (input: unknown, context: { scenarioId: string }) => Promise<unknown>>;
};

const SETUP_SCRIPT_TIMEOUT_MS = 30_000;
const TSX_BIN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", ".bin", "tsx");

export async function runScenario(deps: RunnerDeps): Promise<RunBundle> {
  if (deps.scenario.setup_script) {
    await runSetupScript(deps.scenario.setup_script);
  }

  const runId = createRunId();
  const startedAt = new Date().toISOString();
  const runStart = performance.now();
  const trace = new TraceRecorder(runId, deps.scenario.id);
  const toolCalls: ToolCallRecord[] = [];
  const runtimeProfile = deps.scenario.runtime_profile ? getRuntimeProfile(deps.scenario.runtime_profile) : undefined;
  const tools = applyRuntimeProfileToTools(deps.tools, runtimeProfile, trace);

  const maxSteps = deps.scenario.runtime?.max_steps ?? 8;
  const timeoutSeconds = deps.scenario.runtime?.timeout_seconds;
  const deadline = timeoutSeconds ? Date.now() + timeoutSeconds * 1000 : undefined;
  trace.record("runner", "run_started", {
    agentVersionId: deps.agentVersion.id,
    provider: deps.agentVersion.provider ?? "unknown",
    modelId: deps.agentVersion.modelId ?? "unknown",
    command: deps.agentVersion.command,
    args: deps.agentVersion.args,
    scenarioVersionHash: deps.scenarioFileHash,
    maxSteps,
    timeoutSeconds,
  });
  trace.record(
    "system",
    "runtime_profile_applied",
    {
      name: runtimeProfile?.name ?? null,
    },
    { countStep: false },
  );

  const availableTools = deps.toolSpecs.filter((tool) => deps.scenario.tools.allowed.includes(tool.name));

  const session = await deps.agentAdapter.startRun({
    instructions: deps.scenario.task.instructions,
    availableTools,
    context: deps.scenario.context?.variables ?? {},
    maxSteps,
    metadata: {
      scenarioId: deps.scenario.id,
      provider: deps.agentVersion.provider,
      model: deps.agentVersion.modelId,
    },
  });

  let finalOutput = "";
  let terminationReason: TerminationReason = "completed";
  let status: RunRecord["status"] = "pass";
  let loopCount = 0;
  let event: { type: "run_started" } | { type: "tool_result"; toolName: string; result: unknown } = {
    type: "run_started",
  };

  while (loopCount < maxSteps) {
    if (hasTimedOut(deadline)) {
      status = "error";
      terminationReason = "timeout_exceeded";
      trace.record("runner", "timeout_exceeded", { timeoutSeconds });
      break;
    }

    loopCount += 1;
    trace.record("agent", "agent_turn_started", { loopCount });
    const turn: AgentTurnResult = await raceWithTimeout(session.next(event), deadline, "Agent turn timed out.");

    if (turn.type === "error") {
      status = "error";
      terminationReason = "agent_error";
      trace.record("agent", "agent_error", { message: turn.message });
      break;
    }

    if (turn.type === "final") {
      finalOutput = turn.output;
      trace.record("agent", "agent_final_output", { output: turn.output, metadata: turn.metadata ?? {} });
      break;
    }

    const toolName: string = turn.toolName;
    const toolCallId = createToolCallId();
    trace.record("agent", "agent_message", { content: String(turn.metadata?.message ?? `Requesting ${toolName}`) });
    trace.record("agent", "tool_call_requested", { toolCallId, toolName, input: turn.input });

    if (!deps.scenario.tools.allowed.includes(toolName) || deps.scenario.tools.forbidden?.includes(toolName)) {
      status = "fail";
      terminationReason = "forbidden_tool_used";
      trace.record("runner", "forbidden_tool_attempted", { toolName });
      break;
    }

    const handler: ((input: unknown, context: { scenarioId: string }) => Promise<unknown>) | undefined = tools[toolName];
    if (!handler) {
      status = "error";
      terminationReason = "tool_error";
      trace.record("tool", "tool_call_failed", { toolCallId, toolName, error: "Tool handler missing" });
      break;
    }

    const started = performance.now();
    trace.record("tool", "tool_call_started", { toolCallId, toolName, input: turn.input });
    try {
      const result: unknown = await raceWithTimeout(
        handler(turn.input, { scenarioId: deps.scenario.id }),
        deadline,
        `Tool '${toolName}' timed out.`,
      );
      const durationMs = Math.round(performance.now() - started);
      toolCalls.push({
        id: toolCallId,
        stepIndex: trace.getStepCount() + 1,
        toolName,
        input: turn.input,
        output: result,
        status: "pass",
        durationMs,
      });
      trace.record("tool", "tool_call_completed", { toolCallId, toolName, input: turn.input, output: result, durationMs });
      event = { type: "tool_result", toolName, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isInjectedTimeout = error instanceof Error && (error as { code?: string }).code === "timeout_exceeded";
      if (isInjectedTimeout || (deadline && Date.now() >= deadline)) {
        status = "error";
        terminationReason = "timeout_exceeded";
        trace.record("runner", "timeout_exceeded", { timeoutSeconds, message });
      } else {
        status = "error";
        terminationReason = "tool_error";
      }
      toolCalls.push({
        id: toolCallId,
        stepIndex: trace.getStepCount() + 1,
        toolName,
        input: turn.input,
        status: "fail",
        errorMessage: message,
      });
      trace.record("tool", "tool_call_failed", { toolCallId, toolName, error: message });
      break;
    }
  }

  if (!finalOutput && status !== "error" && loopCount >= maxSteps) {
    status = "fail";
    terminationReason = "step_limit_exceeded";
    trace.record("runner", "step_budget_exceeded", { maxSteps });
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Math.round(performance.now() - runStart);
  const run: RunRecord = {
    id: runId,
    scenarioId: deps.scenario.id,
    scenarioFileHash: deps.scenarioFileHash,
    agentVersionId: deps.agentVersion.id,
    status,
    terminationReason,
    finalOutput,
    totalSteps: trace.getStepCount(),
    totalToolCalls: toolCalls.length,
    durationMs,
    score: 0,
    normalizeConfig: deps.scenario.normalize,
    startedAt,
    finishedAt,
  };

  let bundle: RunBundle = {
    run,
    traceEvents: trace.getEvents(),
    toolCalls,
    evaluatorResults: [],
  };

  trace.record("evaluator", "evaluation_started", {});
  const evaluatorResults = evaluateScenario(bundle, deps.scenario.evaluators);
  for (const result of evaluatorResults) {
    trace.record("evaluator", "evaluation_result", {
      evaluatorId: result.evaluatorId,
      status: result.status,
      message: result.message,
    });
  }
  trace.record("evaluator", "evaluation_finished", {});

  const finalScoring = computeScore(evaluatorResults);
  run.score = finalScoring.score;
  if (run.status !== "error") {
    run.status = finalScoring.status;
    if (run.status === "fail" && terminationReason === "completed") {
      run.terminationReason = "evaluator_failed";
    }
  }

  trace.record("runner", "run_finished", {
    status: run.status,
    terminationReason: run.terminationReason,
    totalSteps: run.totalSteps,
    durationMs: run.durationMs,
  });

  bundle = {
    run,
    traceEvents: trace.getEvents(),
    toolCalls,
    evaluatorResults,
  };

  return bundle;
}

async function runSetupScript(scriptPath: string): Promise<void> {
  if (isAbsolute(scriptPath)) {
    throw new Error("setup_script must be a relative path.");
  }

  const pathParts = scriptPath.split(/[\\/]+/);
  if (pathParts.includes("..")) {
    throw new Error("setup_script cannot contain parent directory traversal.");
  }

  if (extname(scriptPath) !== ".ts") {
    throw new Error("setup_script must point to a .ts file.");
  }

  const absolutePath = resolve(scriptPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`setup_script file not found: ${scriptPath}`);
  }

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(TSX_BIN, [absolutePath], {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`setup_script timed out after ${SETUP_SCRIPT_TIMEOUT_MS / 1000}s: ${scriptPath}`));
    }, SETUP_SCRIPT_TIMEOUT_MS);
    timeout.unref?.();

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`setup_script failed to start: ${error.message}`));
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise();
        return;
      }
      const detail = stderr.trim() || `exit code ${code ?? "unknown"}`;
      reject(new Error(`setup_script failed: ${scriptPath}\n${detail}`));
    });
  });
}

function hasTimedOut(deadline?: number): boolean {
  return deadline !== undefined && Date.now() >= deadline;
}

function toolRaceTimeoutError(message: string): Error {
  const error = new Error(message);
  (error as { code?: string }).code = "timeout_exceeded";
  return error;
}

async function raceWithTimeout<T>(promise: Promise<T>, deadline: number | undefined, message: string): Promise<T> {
  if (deadline === undefined) {
    return promise;
  }

  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw toolRaceTimeoutError(message);
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(toolRaceTimeoutError(message)), remainingMs);
        timeoutHandle.unref?.();
      }),
    ]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}
