import type { RunBundle } from "./types.js";

export function getRunErrorDetail(bundle: RunBundle): string | undefined {
  for (const event of [...bundle.traceEvents].reverse()) {
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
