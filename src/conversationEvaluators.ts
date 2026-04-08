import type { ConversationEvaluatorSpec, EvaluatorResult } from "./types.js";

export function evaluateStep(
  reply: string,
  latencyMs: number,
  evaluators: ConversationEvaluatorSpec[],
  stepIndex: number,
): EvaluatorResult[] {
  return evaluators.map((evaluator, i) => {
    const evaluatorId = `step_${stepIndex}_${evaluator.type}_${i}`;
    return evaluateStepOne(evaluator, evaluatorId, reply, latencyMs);
  });
}

export function evaluateConversationEnd(
  finalReply: string,
  totalTurns: number,
  evaluators: ConversationEvaluatorSpec[],
): EvaluatorResult[] {
  return evaluators.map((evaluator, i) => {
    const evaluatorId = `run_${evaluator.type}_${i}`;
    return evaluateEndOne(evaluator, evaluatorId, finalReply, totalTurns);
  });
}

function evaluateStepOne(
  evaluator: ConversationEvaluatorSpec,
  evaluatorId: string,
  reply: string,
  latencyMs: number,
): EvaluatorResult {
  const normalizedReply = reply.toLowerCase();

  switch (evaluator.type) {
    case "response_contains": {
      const keywords = toStringArray(evaluator.config.keywords);
      const missing = keywords.filter((kw) => !normalizedReply.includes(kw.toLowerCase()));
      const passed = missing.length === 0;
      return {
        evaluatorId,
        evaluatorType: evaluator.type,
        mode: evaluator.mode,
        weight: evaluator.weight,
        status: passed ? "pass" : "fail",
        rawScore: passed ? 1 : 0,
        message: passed
          ? "All required keywords found in reply."
          : `Missing keywords: ${missing.join(", ")}.`,
      };
    }

    case "response_not_contains": {
      const keywords = toStringArray(evaluator.config.keywords);
      const found = keywords.find((kw) => normalizedReply.includes(kw.toLowerCase()));
      const passed = found === undefined;
      return {
        evaluatorId,
        evaluatorType: evaluator.type,
        mode: evaluator.mode,
        weight: evaluator.weight,
        status: passed ? "pass" : "fail",
        rawScore: passed ? 1 : 0,
        message: passed
          ? "No forbidden keywords found in reply."
          : `Forbidden keyword found: "${found}".`,
      };
    }

    case "response_matches_regex": {
      const pattern = String(evaluator.config.pattern ?? "");
      let passed = false;
      try {
        passed = new RegExp(pattern, "i").test(reply);
      } catch {
        // invalid regex — treat as fail
      }
      return {
        evaluatorId,
        evaluatorType: evaluator.type,
        mode: evaluator.mode,
        weight: evaluator.weight,
        status: passed ? "pass" : "fail",
        rawScore: passed ? 1 : 0,
        message: passed
          ? `Reply matches pattern /${pattern}/.`
          : `Reply does not match pattern /${pattern}/.`,
      };
    }

    case "response_latency_max": {
      const maxMs = Number(evaluator.config.ms ?? 0);
      const passed = latencyMs <= maxMs;
      return {
        evaluatorId,
        evaluatorType: evaluator.type,
        mode: evaluator.mode,
        weight: evaluator.weight,
        status: passed ? "pass" : "fail",
        rawScore: passed ? 1 : 0,
        message: passed
          ? `Response latency ${latencyMs}ms is within limit ${maxMs}ms.`
          : `Response latency ${latencyMs}ms exceeds limit ${maxMs}ms.`,
      };
    }

    default:
      return {
        evaluatorId,
        evaluatorType: evaluator.type,
        mode: evaluator.mode,
        weight: evaluator.weight,
        status: "fail",
        message: `Unsupported step evaluator type '${evaluator.type}'.`,
      };
  }
}

function evaluateEndOne(
  evaluator: ConversationEvaluatorSpec,
  evaluatorId: string,
  finalReply: string,
  totalTurns: number,
): EvaluatorResult {
  const normalizedReply = finalReply.toLowerCase();

  switch (evaluator.type) {
    case "step_count_max": {
      const max = Number(evaluator.config.max ?? 0);
      const passed = totalTurns <= max;
      return {
        evaluatorId,
        evaluatorType: evaluator.type,
        mode: evaluator.mode,
        weight: evaluator.weight,
        status: passed ? "pass" : "fail",
        rawScore: passed ? 1 : 0,
        message: passed
          ? `Turn count ${totalTurns} is within max ${max}.`
          : `Turn count ${totalTurns} exceeds max ${max}.`,
      };
    }

    case "exact_final_answer": {
      const expected = String(evaluator.config.expected ?? "");
      const passed = finalReply.trim() === expected.trim();
      return {
        evaluatorId,
        evaluatorType: evaluator.type,
        mode: evaluator.mode,
        weight: evaluator.weight,
        status: passed ? "pass" : "fail",
        rawScore: passed ? 1 : 0,
        message: passed ? "Final reply matched exactly." : "Final reply did not match expected output.",
      };
    }

    case "final_answer_contains": {
      const keywords = toStringArray(evaluator.config.keywords);
      const missing = keywords.filter((kw) => !normalizedReply.includes(kw.toLowerCase()));
      const passed = missing.length === 0;
      return {
        evaluatorId,
        evaluatorType: evaluator.type,
        mode: evaluator.mode,
        weight: evaluator.weight,
        status: passed ? "pass" : "fail",
        rawScore: passed ? 1 : 0,
        message: passed
          ? "Final reply contains all required keywords."
          : `Missing keywords in final reply: ${missing.join(", ")}.`,
      };
    }

    case "response_contains":
    case "response_not_contains":
    case "response_matches_regex":
    case "response_latency_max":
      return {
        evaluatorId,
        evaluatorType: evaluator.type,
        mode: evaluator.mode,
        weight: evaluator.weight,
        status: "fail",
        message: `Evaluator type '${evaluator.type}' is only valid as a per-step evaluator, not end-of-run.`,
      };

    default:
      return {
        evaluatorId,
        evaluatorType: evaluator.type,
        mode: evaluator.mode,
        weight: evaluator.weight,
        status: "fail",
        message: `Unsupported end-of-run evaluator type '${evaluator.type}'.`,
      };
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}
