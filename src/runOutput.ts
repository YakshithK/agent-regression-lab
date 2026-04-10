import type { RunBundle } from "./types.js";

export function getRunErrorDetail(bundle: RunBundle): string | undefined {
  for (const event of [...bundle.traceEvents].reverse()) {
    if (event.type === "conversation_finished") {
      const errorMessage = event.payload.errorMessage;
      if (typeof errorMessage === "string") {
        return errorMessage;
      }
    }
    if (event.type === "agent_error") {
      const message = event.payload.message;
      return typeof message === "string" ? message : undefined;
    }
    if (event.type === "tool_call_failed") {
      const error = event.payload.error;
      return typeof error === "string" ? error : undefined;
    }
  }

  return undefined;
}

export function formatCliErrorMessage(message: string): string {
  if (message.includes("database is locked")) {
    return "SQLite database is locked. Retry the run sequentially or wait for the current run to finish.";
  }

  return message;
}

export function getFailedEvaluatorSummaries(bundle: RunBundle): string[] {
  return bundle.evaluatorResults
    .filter((result) => result.status === "fail")
    .map((result) => `${result.evaluatorId}: ${result.message}`);
}

export function formatRunIdentityLines(bundle: RunBundle): string[] {
  const lines: string[] = [];
  const run = bundle.run;

  if (run.variantSetName) {
    lines.push(`Variant set: ${run.variantSetName}`);
  }
  if (run.variantLabel) {
    lines.push(`Variant: ${run.variantLabel}`);
  }
  if (run.promptVersion) {
    lines.push(`Prompt version: ${run.promptVersion}`);
  }
  if (run.modelVersion) {
    lines.push(`Model version: ${run.modelVersion}`);
  }
  if (run.toolSchemaVersion) {
    lines.push(`Tool schema version: ${run.toolSchemaVersion}`);
  }
  if (run.configLabel) {
    lines.push(`Config label: ${run.configLabel}`);
  }
  if (run.runtimeProfileName) {
    lines.push(`Runtime profile: ${run.runtimeProfileName}`);
  }
  if (run.suiteDefinitionName) {
    lines.push(`Suite definition: ${run.suiteDefinitionName}`);
  }

  return lines;
}
