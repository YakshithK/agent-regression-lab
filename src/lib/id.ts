import { createHash, randomUUID } from "node:crypto";

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function createRunId(): string {
  return `run_${Date.now()}`;
}

export function createEventId(): string {
  return `evt_${randomUUID()}`;
}

export function createToolCallId(): string {
  return `tool_${randomUUID()}`;
}

export function createAgentVersionId(label: string, config: Record<string, unknown>): string {
  return `agent_${hashText(`${label}:${JSON.stringify(config)}`).slice(0, 12)}`;
}
