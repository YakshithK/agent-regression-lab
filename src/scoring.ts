import type { EvaluatorResult, RunStatus } from "./types.js";

const PASS_THRESHOLD = 80;

export function computeScore(results: EvaluatorResult[]): { score: number; status: RunStatus } {
  const hardGateFailure = results.some((result) => result.mode === "hard_gate" && result.status === "fail");
  const weighted = results.filter((result) => result.mode === "weighted");

  let score = 100;
  if (weighted.length > 0) {
    const totalWeight = weighted.reduce((sum, result) => sum + (result.weight ?? 0), 0);
    const earnedWeight = weighted.reduce((sum, result) => {
      const weight = result.weight ?? 0;
      return sum + (result.status === "pass" ? weight : 0);
    }, 0);
    score = totalWeight === 0 ? 100 : Math.round((earnedWeight / totalWeight) * 100);
  }

  if (hardGateFailure) {
    return { score, status: "fail" };
  }

  return { score, status: score >= PASS_THRESHOLD ? "pass" : "fail" };
}
