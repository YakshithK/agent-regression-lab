import type {
  EvaluatorResult,
  RunBundle,
  ScenarioEvaluator,
  ToolCallRecord,
} from "./types.js";

export function evaluateScenario(bundle: RunBundle, evaluators: ScenarioEvaluator[]): EvaluatorResult[] {
  return evaluators.map((evaluator) => evaluateOne(evaluator, bundle));
}

function evaluateOne(evaluator: ScenarioEvaluator, bundle: RunBundle): EvaluatorResult {
  switch (evaluator.type) {
    case "forbidden_tool":
      return evaluateForbiddenTool(evaluator, bundle.toolCalls);
    case "tool_call_assertion":
      return evaluateToolCallAssertion(evaluator, bundle.toolCalls);
    case "final_answer_contains":
      return evaluateFinalAnswerContains(evaluator, bundle.run.finalOutput);
    case "exact_final_answer":
      return evaluateExactFinalAnswer(evaluator, bundle.run.finalOutput);
    case "step_count_max":
      return evaluateStepCountMax(evaluator, bundle.run.totalSteps);
    default:
      return {
        evaluatorId: evaluator.id,
        evaluatorType: evaluator.type,
        mode: evaluator.mode,
        status: "fail",
        weight: evaluator.weight,
        message: `Unsupported evaluator type '${evaluator.type}'.`,
      };
  }
}

function evaluateForbiddenTool(evaluator: ScenarioEvaluator, toolCalls: ToolCallRecord[]): EvaluatorResult {
  const forbidden = Array.isArray(evaluator.config.tools) ? evaluator.config.tools.map(String) : [];
  const used = toolCalls.find((call) => forbidden.includes(call.toolName));

  return {
    evaluatorId: evaluator.id,
    evaluatorType: evaluator.type,
    mode: evaluator.mode,
    status: used ? "fail" : "pass",
    weight: evaluator.weight,
    rawScore: used ? 0 : 1,
    message: used ? `Forbidden tool '${used.toolName}' was used.` : "No forbidden tools were used.",
  };
}

function evaluateToolCallAssertion(evaluator: ScenarioEvaluator, toolCalls: ToolCallRecord[]): EvaluatorResult {
  const tool = String(evaluator.config.tool ?? "");
  const match = isObject(evaluator.config.match) ? evaluator.config.match : {};
  const call = toolCalls.find((candidate) => candidate.toolName === tool && matches(candidate.input, match));

  return {
    evaluatorId: evaluator.id,
    evaluatorType: evaluator.type,
    mode: evaluator.mode,
    status: call ? "pass" : "fail",
    weight: evaluator.weight,
    rawScore: call ? 1 : 0,
    message: call ? `Observed expected tool call for '${tool}'.` : `Expected tool call for '${tool}' was not found.`,
    details: { expected: match },
  };
}

function evaluateFinalAnswerContains(evaluator: ScenarioEvaluator, finalOutput: string): EvaluatorResult {
  const required = Array.isArray(evaluator.config.required_substrings)
    ? evaluator.config.required_substrings.map(String)
    : [];
  const normalizedOutput = normalizeText(finalOutput);
  const missing = required.filter((candidate) => !normalizedOutput.includes(normalizeText(candidate)));
  const passed = missing.length === 0;

  return {
    evaluatorId: evaluator.id,
    evaluatorType: evaluator.type,
    mode: evaluator.mode,
    status: passed ? "pass" : "fail",
    weight: evaluator.weight,
    rawScore: passed ? required.length : required.length - missing.length,
    message: passed ? "Final answer contains all required substrings." : `Missing required substrings: ${missing.join(", ")}.`,
  };
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function evaluateExactFinalAnswer(evaluator: ScenarioEvaluator, finalOutput: string): EvaluatorResult {
  const expected = String(evaluator.config.expected ?? "");
  const passed = finalOutput.trim() === expected.trim();
  return {
    evaluatorId: evaluator.id,
    evaluatorType: evaluator.type,
    mode: evaluator.mode,
    status: passed ? "pass" : "fail",
    weight: evaluator.weight,
    rawScore: passed ? 1 : 0,
    message: passed ? "Final answer matched exactly." : "Final answer did not match expected output.",
  };
}

function evaluateStepCountMax(evaluator: ScenarioEvaluator, stepCount: number): EvaluatorResult {
  const max = Number(evaluator.config.max_steps ?? 0);
  const passed = stepCount <= max;
  return {
    evaluatorId: evaluator.id,
    evaluatorType: evaluator.type,
    mode: evaluator.mode,
    status: passed ? "pass" : "fail",
    weight: evaluator.weight,
    rawScore: passed ? 1 : 0,
    message: passed ? `Step count ${stepCount} is within max ${max}.` : `Step count ${stepCount} exceeds max ${max}.`,
  };
}

function matches(input: unknown, match: Record<string, unknown>): boolean {
  if (!isObject(input)) {
    return false;
  }

  return Object.entries(match).every(([key, value]) => input[key] === value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
