import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ensureParentDir } from "./lib/fs.js";
import type { AgentVersion, RunBundle, RunRecord, ScenarioDefinition, ScenarioSummary } from "./types.js";

const DB_PATH = resolve("artifacts", "agentlab.db");

export class Storage {
  private readonly db: DatabaseSync;

  constructor() {
    ensureParentDir(DB_PATH);
    this.db = new DatabaseSync(DB_PATH);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scenarios (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        suite TEXT NOT NULL,
        description TEXT,
        tags_json TEXT,
        difficulty TEXT,
        file_path TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_versions (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        model_id TEXT,
        provider TEXT,
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL,
        scenario_file_hash TEXT NOT NULL,
        agent_version_id TEXT NOT NULL,
        status TEXT NOT NULL,
        termination_reason TEXT NOT NULL,
        final_output TEXT NOT NULL,
        total_steps INTEGER NOT NULL,
        total_tool_calls INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        total_tokens INTEGER,
        total_cost_usd REAL,
        score INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS run_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_calls (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        output_json TEXT,
        status TEXT NOT NULL,
        duration_ms INTEGER,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS evaluator_results (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        evaluator_id TEXT NOT NULL,
        evaluator_type TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        raw_score REAL,
        normalized_score REAL,
        weight REAL,
        message TEXT NOT NULL,
        details_json TEXT
      );
    `);
  }

  upsertScenario(summary: ScenarioSummary, definition: ScenarioDefinition, filePath: string, fileHash: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO scenarios (id, name, suite, description, tags_json, difficulty, file_path, file_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           suite = excluded.suite,
           description = excluded.description,
           tags_json = excluded.tags_json,
           difficulty = excluded.difficulty,
           file_path = excluded.file_path,
           file_hash = excluded.file_hash,
           updated_at = excluded.updated_at`,
      )
      .run(
        summary.id,
        summary.name,
        summary.suite,
        summary.description ?? null,
        JSON.stringify(definition.tags ?? []),
        summary.difficulty ?? null,
        filePath,
        fileHash,
        now,
        now,
      );
  }

  upsertAgentVersion(agentVersion: AgentVersion): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO agent_versions (id, label, model_id, provider, config_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           model_id = excluded.model_id,
           provider = excluded.provider,
           config_json = excluded.config_json`,
      )
      .run(
        agentVersion.id,
        agentVersion.label,
        agentVersion.modelId ?? null,
        agentVersion.provider ?? null,
        JSON.stringify(agentVersion.config),
        now,
      );
  }

  saveRun(bundle: RunBundle): void {
    const run = bundle.run;
    this.db
      .prepare(
        `INSERT INTO runs (
          id, scenario_id, scenario_file_hash, agent_version_id, status, termination_reason, final_output,
          total_steps, total_tool_calls, duration_ms, total_tokens, total_cost_usd, score, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.scenarioId,
        run.scenarioFileHash,
        run.agentVersionId,
        run.status,
        run.terminationReason,
        run.finalOutput,
        run.totalSteps,
        run.totalToolCalls,
        run.durationMs,
        run.totalTokens ?? null,
        run.totalCostUsd ?? null,
        run.score,
        run.startedAt,
        run.finishedAt,
      );

    const insertStep = this.db.prepare(
      `INSERT INTO run_steps (id, run_id, step_index, timestamp, source, type, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertTool = this.db.prepare(
      `INSERT INTO tool_calls (id, run_id, step_index, tool_name, input_json, output_json, status, duration_ms, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertEval = this.db.prepare(
      `INSERT INTO evaluator_results (id, run_id, evaluator_id, evaluator_type, mode, status, raw_score, normalized_score, weight, message, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.db.exec("BEGIN");
    try {
      for (const event of bundle.traceEvents) {
        insertStep.run(
          event.eventId,
          bundle.run.id,
          event.stepIndex,
          event.timestamp,
          event.source,
          event.type,
          JSON.stringify(event.payload),
        );
      }

      for (const toolCall of bundle.toolCalls) {
        insertTool.run(
          toolCall.id,
          bundle.run.id,
          toolCall.stepIndex,
          toolCall.toolName,
          JSON.stringify(toolCall.input),
          toolCall.output === undefined ? null : JSON.stringify(toolCall.output),
          toolCall.status,
          toolCall.durationMs ?? null,
          toolCall.errorMessage ?? null,
        );
      }

      for (const result of bundle.evaluatorResults) {
        insertEval.run(
          `${bundle.run.id}:${result.evaluatorId}`,
          bundle.run.id,
          result.evaluatorId,
          result.evaluatorType,
          result.mode,
          result.status,
          result.rawScore ?? null,
          result.normalizedScore ?? null,
          result.weight ?? null,
          result.message,
          result.details ? JSON.stringify(result.details) : null,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.writeTraceArtifact(bundle.run.id, bundle.traceEvents);
  }

  getRun(runId: string): RunBundle | null {
    const run = this.getRunRecord(runId);
    if (!run) {
      return null;
    }

    const traceEvents = this.db
      .prepare(
        `SELECT id as eventId, run_id as runId, step_index as stepIndex, timestamp, source, type, payload_json
         FROM run_steps WHERE run_id = ? ORDER BY step_index ASC`,
      )
      .all(runId)
      .map((row: any) => ({
        eventId: row.eventId,
        runId: row.runId,
        scenarioId: run.scenarioId,
        stepIndex: row.stepIndex,
        timestamp: row.timestamp,
        source: row.source,
        type: row.type,
        payload: JSON.parse(row.payload_json),
      }));

    const toolCalls = this.db
      .prepare(
        `SELECT id, step_index as stepIndex, tool_name as toolName, input_json, output_json, status, duration_ms as durationMs, error_message as errorMessage
         FROM tool_calls WHERE run_id = ? ORDER BY step_index ASC`,
      )
      .all(runId)
      .map((row: any) => ({
        id: row.id,
        stepIndex: row.stepIndex,
        toolName: row.toolName,
        input: JSON.parse(row.input_json),
        output: row.output_json ? JSON.parse(row.output_json) : undefined,
        status: row.status,
        durationMs: row.durationMs ?? undefined,
        errorMessage: row.errorMessage ?? undefined,
      }));

    const evaluatorResults = this.db
      .prepare(
        `SELECT evaluator_id as evaluatorId, evaluator_type as evaluatorType, mode, status, raw_score as rawScore,
                normalized_score as normalizedScore, weight, message, details_json
         FROM evaluator_results WHERE run_id = ? ORDER BY evaluator_id ASC`,
      )
      .all(runId)
      .map((row: any) => ({
        evaluatorId: row.evaluatorId,
        evaluatorType: row.evaluatorType,
        mode: row.mode,
        status: row.status,
        rawScore: row.rawScore ?? undefined,
        normalizedScore: row.normalizedScore ?? undefined,
        weight: row.weight ?? undefined,
        message: row.message,
        details: row.details_json ? JSON.parse(row.details_json) : undefined,
      }));

    return { run, traceEvents, toolCalls, evaluatorResults };
  }

  compareRuns(baselineRunId: string, candidateRunId: string): {
    baseline: RunRecord;
    candidate: RunRecord;
    notes: string[];
  } {
    const baseline = this.getRunRecordOrThrow(baselineRunId);
    const candidate = this.getRunRecordOrThrow(candidateRunId);

    if (baseline.scenarioId !== candidate.scenarioId) {
      throw new Error("Runs can only be compared when they share the same scenario id.");
    }

    const notes: string[] = [];
    if (baseline.status !== candidate.status) {
      notes.push(`Verdict changed: ${baseline.status} -> ${candidate.status}`);
    }
    if (baseline.score !== candidate.score) {
      notes.push(`Score changed: ${baseline.score} -> ${candidate.score}`);
    }
    if (baseline.totalSteps !== candidate.totalSteps) {
      notes.push(`Steps changed: ${baseline.totalSteps} -> ${candidate.totalSteps}`);
    }
    if (baseline.durationMs !== candidate.durationMs) {
      notes.push(`Runtime changed: ${baseline.durationMs}ms -> ${candidate.durationMs}ms`);
    }

    return { baseline, candidate, notes };
  }

  private getRunRecord(runId: string): RunRecord | null {
    return (
      (this.db
        .prepare(
          `SELECT id, scenario_id as scenarioId, scenario_file_hash as scenarioFileHash, agent_version_id as agentVersionId,
                  status, termination_reason as terminationReason, final_output as finalOutput, total_steps as totalSteps,
                  total_tool_calls as totalToolCalls, duration_ms as durationMs, total_tokens as totalTokens,
                  total_cost_usd as totalCostUsd, score, started_at as startedAt, finished_at as finishedAt
           FROM runs WHERE id = ?`,
        )
        .get(runId) as RunRecord | undefined) ?? null
    );
  }

  private getRunRecordOrThrow(runId: string): RunRecord {
    const run = this.getRunRecord(runId);
    if (!run) {
      throw new Error(`Run '${runId}' not found.`);
    }
    return run;
  }

  private writeTraceArtifact(runId: string, events: RunBundle["traceEvents"]): void {
    const path = resolve("artifacts", runId, "trace.json");
    ensureParentDir(path);
    writeFileSync(path, JSON.stringify(events, null, 2));
  }
}
