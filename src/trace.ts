import { createEventId } from "./lib/id.js";
import type { TraceEvent } from "./types.js";

export class TraceRecorder {
  private readonly events: TraceEvent[] = [];
  private stepIndex = 0;

  constructor(private readonly runId: string, private readonly scenarioId: string) {}

  record(
    source: TraceEvent["source"],
    type: TraceEvent["type"],
    payload: Record<string, unknown>,
  ): void {
    this.stepIndex += 1;
    this.events.push({
      eventId: createEventId(),
      runId: this.runId,
      scenarioId: this.scenarioId,
      stepIndex: this.stepIndex,
      timestamp: new Date().toISOString(),
      source,
      type,
      payload,
    });
  }

  getEvents(): TraceEvent[] {
    return [...this.events];
  }

  getStepCount(): number {
    return this.stepIndex;
  }
}
