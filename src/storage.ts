import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ensureParentDir } from "./lib/fs.js";
import { normalizeOutput } from "./normalize.js";
import type {
  AgentVersion,
  ConversationScenarioDefinition,
  RunBundle,
  RunComparison,
  RunListFilters,
  RunListItem,
  RunRecord,
  ScenarioDefinition,
  ScenarioSummary,
  SuiteComparison,
  SuiteScenarioComparison,
} from "./types.js";

const SCHEMA_VERSION = "3";

export class Storage {
  private readonly db: DatabaseSync;

  constructor() {
    const dbPath = resolve("artifacts", "agentlab.db");
    ensureParentDir(dbPath);
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

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
        command TEXT,
        args_json TEXT,
        variant_set_name TEXT,
        variant_label TEXT,
        prompt_version TEXT,
        model_version TEXT,
        tool_schema_version TEXT,
        config_label TEXT,
        config_hash TEXT,
        runtime_profile_name TEXT,
        suite_definition_name TEXT,
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL,
        scenario_file_hash TEXT NOT NULL,
        agent_version_id TEXT NOT NULL,
        suite_batch_id TEXT,
        variant_set_name TEXT,
        variant_label TEXT,
        prompt_version TEXT,
        model_version TEXT,
        tool_schema_version TEXT,
        config_label TEXT,
        config_hash TEXT,
        runtime_profile_name TEXT,
        suite_definition_name TEXT,
        status TEXT NOT NULL,
        termination_reason TEXT NOT NULL,
        final_output TEXT NOT NULL,
        total_steps INTEGER NOT NULL,
        total_tool_calls INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        total_tokens INTEGER,
        total_cost_usd REAL,
        score INTEGER NOT NULL,
        is_baseline INTEGER NOT NULL DEFAULT 0,
        normalize_config_json TEXT,
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
    this.ensureSchemaVersion();
    this.ensureAgentVersionColumns();
    this.ensureRunColumns();
  }

  close(): void {
    this.db.close();
  }

  upsertScenario(summary: ScenarioSummary, definition: ScenarioDefinition | ConversationScenarioDefinition, filePath: string, fileHash: string): void {
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
        `INSERT INTO agent_versions (
           id, label, model_id, provider, command, args_json,
           variant_set_name, variant_label, prompt_version, model_version, tool_schema_version,
           config_label, config_hash, runtime_profile_name, suite_definition_name,
           config_json, created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           model_id = excluded.model_id,
           provider = excluded.provider,
           command = excluded.command,
           args_json = excluded.args_json,
           variant_set_name = excluded.variant_set_name,
           variant_label = excluded.variant_label,
           prompt_version = excluded.prompt_version,
           model_version = excluded.model_version,
           tool_schema_version = excluded.tool_schema_version,
           config_label = excluded.config_label,
           config_hash = excluded.config_hash,
           runtime_profile_name = excluded.runtime_profile_name,
           suite_definition_name = excluded.suite_definition_name,
           config_json = excluded.config_json`,
      )
      .run(
        agentVersion.id,
        agentVersion.label,
        agentVersion.modelId ?? null,
        agentVersion.provider ?? null,
        agentVersion.command ?? null,
        JSON.stringify(agentVersion.args ?? []),
        agentVersion.variantSetName ?? null,
        agentVersion.variantLabel ?? null,
        agentVersion.promptVersion ?? null,
        agentVersion.modelVersion ?? null,
        agentVersion.toolSchemaVersion ?? null,
        agentVersion.configLabel ?? null,
        agentVersion.configHash ?? null,
        agentVersion.runtimeProfileName ?? null,
        agentVersion.suiteDefinitionName ?? null,
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
          suite_batch_id, variant_set_name, variant_label, prompt_version, model_version, tool_schema_version,
          config_label, config_hash, runtime_profile_name, suite_definition_name,
          total_steps, total_tool_calls, duration_ms, total_tokens, total_cost_usd, score, normalize_config_json, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.scenarioId,
        run.scenarioFileHash,
        run.agentVersionId,
        run.status,
        run.terminationReason,
        run.finalOutput,
        run.suiteBatchId ?? null,
        run.variantSetName ?? null,
        run.variantLabel ?? null,
        run.promptVersion ?? null,
        run.modelVersion ?? null,
        run.toolSchemaVersion ?? null,
        run.configLabel ?? null,
        run.configHash ?? null,
        run.runtimeProfileName ?? null,
        run.suiteDefinitionName ?? null,
        run.totalSteps,
        run.totalToolCalls,
        run.durationMs,
        run.totalTokens ?? null,
        run.totalCostUsd ?? null,
        run.score,
        run.normalizeConfig ? JSON.stringify(run.normalizeConfig) : null,
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

  listRuns(filters: RunListFilters = {}): RunListItem[] {
    const clauses: string[] = [];
    const values: Array<string> = [];

    if (filters.suite) {
      clauses.push("s.suite = ?");
      values.push(filters.suite);
    }
    if (filters.status) {
      clauses.push("r.status = ?");
      values.push(filters.status);
    }
    if (filters.provider) {
      clauses.push("av.provider = ?");
      values.push(filters.provider);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(
        `SELECT r.id, r.scenario_id as scenarioId, s.suite, r.agent_version_id as agentVersionId,
                r.suite_batch_id as suiteBatchId,
                r.variant_set_name as variantSetName, r.variant_label as variantLabel,
                av.label as agentLabel, av.provider, av.model_id as modelId,
                r.status, r.score, r.duration_ms as durationMs, r.total_steps as totalSteps,
                r.started_at as startedAt
         FROM runs r
         JOIN scenarios s ON s.id = r.scenario_id
         JOIN agent_versions av ON av.id = r.agent_version_id
         ${whereClause}
         ORDER BY r.started_at DESC`,
      )
      .all(...values) as RunListItem[];
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

    const agentVersion = this.db
      .prepare(
        `SELECT id, label, model_id as modelId, provider, command, args_json, config_json
                , variant_set_name as variantSetName, variant_label as variantLabel,
                prompt_version as promptVersion, model_version as modelVersion,
                tool_schema_version as toolSchemaVersion, config_label as configLabel,
                config_hash as configHash, runtime_profile_name as runtimeProfileName,
                suite_definition_name as suiteDefinitionName
         FROM agent_versions WHERE id = ?`,
      )
      .get(run.agentVersionId) as
      | {
          id: string;
          label: string;
          modelId?: string;
          provider?: string;
          command?: string;
          args_json?: string;
          variantSetName?: string;
          variantLabel?: string;
          promptVersion?: string;
          modelVersion?: string;
          toolSchemaVersion?: string;
          configLabel?: string;
          configHash?: string;
          runtimeProfileName?: string;
          suiteDefinitionName?: string;
          config_json: string;
        }
      | undefined;

    return {
      run,
      traceEvents,
      toolCalls,
      evaluatorResults,
      agentVersion: agentVersion
        ? {
            id: agentVersion.id,
            label: agentVersion.label,
            modelId: agentVersion.modelId ?? undefined,
            provider: agentVersion.provider ?? undefined,
            command: agentVersion.command ?? undefined,
            args: agentVersion.args_json ? JSON.parse(agentVersion.args_json) : undefined,
            variantSetName: agentVersion.variantSetName ?? undefined,
            variantLabel: agentVersion.variantLabel ?? undefined,
            promptVersion: agentVersion.promptVersion ?? undefined,
            modelVersion: agentVersion.modelVersion ?? undefined,
            toolSchemaVersion: agentVersion.toolSchemaVersion ?? undefined,
            configLabel: agentVersion.configLabel ?? undefined,
            configHash: agentVersion.configHash ?? undefined,
            runtimeProfileName: agentVersion.runtimeProfileName ?? undefined,
            suiteDefinitionName: agentVersion.suiteDefinitionName ?? undefined,
            config: JSON.parse(agentVersion.config_json),
          }
        : undefined,
    };
  }

  resolveRunId(id: string, context: { scenarioId?: string } = {}): string {
    if (!id.startsWith("@")) {
      return id;
    }

    const match = id.match(/^@(last|prev)(?::(.+))?$/);
    if (!match) {
      throw new Error(`Unknown run shorthand '${id}'. Use @last or @prev.`);
    }

    const shorthand = match[1] as "last" | "prev";
    const scenarioId = match[2] ?? context.scenarioId;
    const offset = shorthand === "last" ? 0 : 1;
    const rows = scenarioId
      ? (this.db
          .prepare(
            `SELECT id FROM runs
             WHERE scenario_id = ?
             ORDER BY started_at DESC, id DESC
             LIMIT 2`,
          )
          .all(scenarioId) as Array<{ id: string }>)
      : (this.db
          .prepare(
            `SELECT id FROM runs
             ORDER BY started_at DESC, id DESC
             LIMIT 2`,
          )
          .all() as Array<{ id: string }>);

    if (rows.length === 0) {
      const suffix = scenarioId ? ` for scenario '${scenarioId}'` : "";
      throw new Error(`No runs found yet${suffix}. Run: agentlab run <scenario-id> --agent <name>`);
    }

    const row = rows[offset];
    if (!row) {
      const suffix = scenarioId ? ` for scenario '${scenarioId}'` : "";
      throw new Error(`No previous run found${suffix}. Run a scenario first.`);
    }

    return row.id;
  }

  compareRuns(baselineRunId: string, candidateRunId: string): RunComparison {
    const baseline = this.getRun(baselineRunId);
    const candidate = this.getRun(candidateRunId);

    if (!baseline) {
      throw new Error(`Run '${baselineRunId}' not found.`);
    }
    if (!candidate) {
      throw new Error(`Run '${candidateRunId}' not found.`);
    }

    return compareRunBundles(baseline, candidate);
  }

  approveRun(runId: string): { status: "approved" | "already_baseline"; run: RunRecord } | { status: "not_found" } {
    const run = this.getRunRecord(runId);
    if (!run) {
      return { status: "not_found" };
    }

    const existing = this.db
      .prepare(`SELECT is_baseline FROM runs WHERE id = ?`)
      .get(runId) as { is_baseline: number } | undefined;
    if (existing?.is_baseline === 1) {
      return { status: "already_baseline", run };
    }

    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(`UPDATE runs SET is_baseline = 0 WHERE scenario_id = ? AND agent_version_id = ?`)
        .run(run.scenarioId, run.agentVersionId);
      this.db.prepare(`UPDATE runs SET is_baseline = 1 WHERE id = ?`).run(runId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return { status: "approved", run };
  }

  getBaselineRun(scenarioId: string, agentVersionId: string): RunBundle | null {
    const row = this.db
      .prepare(
        `SELECT id FROM runs
         WHERE scenario_id = ? AND agent_version_id = ? AND is_baseline = 1
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .get(scenarioId, agentVersionId) as { id: string } | undefined;
    return row ? this.getRun(row.id) : null;
  }

  compareSuites(baselineBatchId: string, candidateBatchId: string): SuiteComparison {
    const baselineRuns = this.getRunsBySuiteBatchId(baselineBatchId);
    const candidateRuns = this.getRunsBySuiteBatchId(candidateBatchId);
    if (baselineRuns.length === 0) {
      throw new Error(`No runs found for suite batch '${baselineBatchId}'.`);
    }
    if (candidateRuns.length === 0) {
      throw new Error(`No runs found for suite batch '${candidateBatchId}'.`);
    }

    const baselineSuites = new Set(baselineRuns.map((bundle) => deriveSuiteName(bundle.run.scenarioId)));
    const candidateSuites = new Set(candidateRuns.map((bundle) => deriveSuiteName(bundle.run.scenarioId)));
    if (baselineSuites.size !== 1) {
      throw new Error(`Suite batch '${baselineBatchId}' contains runs from multiple suites.`);
    }
    if (candidateSuites.size !== 1) {
      throw new Error(`Suite batch '${candidateBatchId}' contains runs from multiple suites.`);
    }

    const suite = [...baselineSuites][0] ?? "unknown";
    const candidateSuite = [...candidateSuites][0] ?? "unknown";
    if (suite !== candidateSuite) {
      throw new Error(`Suite batches can only be compared when they share the same suite. Got '${suite}' and '${candidateSuite}'.`);
    }

    const baselineMap = new Map(baselineRuns.map((bundle) => [bundle.run.scenarioId, bundle]));
    const candidateMap = new Map(candidateRuns.map((bundle) => [bundle.run.scenarioId, bundle]));
    const sharedScenarioIds = [...baselineMap.keys()].filter((scenarioId) => candidateMap.has(scenarioId)).sort();

    const comparisons: SuiteScenarioComparison[] = sharedScenarioIds.map((scenarioId) => ({
      scenarioId,
      comparison: compareRunBundles(baselineMap.get(scenarioId)!, candidateMap.get(scenarioId)!),
    }));

    const regressions = comparisons.filter((entry) => entry.comparison.classification === "regressed");
    const improvements = comparisons.filter((entry) => entry.comparison.classification === "improved");
    const unchanged = comparisons.filter((entry) => !["regressed", "improved"].includes(entry.comparison.classification));

    const baselineStats = summarizeRuns(baselineRuns);
    const candidateStats = summarizeRuns(candidateRuns);
    const missingFromCandidate = [...baselineMap.keys()].filter((scenarioId) => !candidateMap.has(scenarioId)).sort();
    const missingFromBaseline = [...candidateMap.keys()].filter((scenarioId) => !baselineMap.has(scenarioId)).sort();

    const notes: string[] = [];
    if (regressions.length > 0) {
      notes.push(`${regressions.length} scenario regressions detected.`);
    }
    if (improvements.length > 0) {
      notes.push(`${improvements.length} scenario improvements detected.`);
    }
    if (missingFromCandidate.length > 0) {
      notes.push(`${missingFromCandidate.length} scenarios missing from candidate batch.`);
    }
    if (missingFromBaseline.length > 0) {
      notes.push(`${missingFromBaseline.length} scenarios missing from baseline batch.`);
    }

    return {
      suite,
      baselineBatchId,
      candidateBatchId,
      classification: regressions.length > 0 ? "regressed" : improvements.length > 0 ? "improved" : notes.length > 0 ? "mixed" : "unchanged",
      notes,
      deltas: {
        pass: candidateStats.pass - baselineStats.pass,
        fail: candidateStats.fail - baselineStats.fail,
        error: candidateStats.error - baselineStats.error,
        averageScore: candidateStats.averageScore - baselineStats.averageScore,
        averageRuntimeMs: candidateStats.averageRuntimeMs - baselineStats.averageRuntimeMs,
        averageSteps: candidateStats.averageSteps - baselineStats.averageSteps,
      },
      regressions,
      improvements,
      unchanged,
      missingFromCandidate,
      missingFromBaseline,
    };
  }

  private getRunRecord(runId: string): RunRecord | null {
    const row =
      (this.db
      .prepare(
        `SELECT id, scenario_id as scenarioId, scenario_file_hash as scenarioFileHash, agent_version_id as agentVersionId,
                  suite_batch_id as suiteBatchId, variant_set_name as variantSetName, variant_label as variantLabel,
                  prompt_version as promptVersion, model_version as modelVersion, tool_schema_version as toolSchemaVersion,
                  config_label as configLabel, config_hash as configHash, runtime_profile_name as runtimeProfileName,
                  suite_definition_name as suiteDefinitionName,
                  status, termination_reason as terminationReason, final_output as finalOutput, total_steps as totalSteps,
                  total_tool_calls as totalToolCalls, duration_ms as durationMs, total_tokens as totalTokens,
                  total_cost_usd as totalCostUsd, score, normalize_config_json as normalizeConfigJson,
                  started_at as startedAt, finished_at as finishedAt
           FROM runs WHERE id = ?`,
      )
      .get(runId) as (RunRecord & { normalizeConfigJson?: string | null }) | undefined) ?? null;

    if (!row) {
      return null;
    }

    const { normalizeConfigJson, ...run } = row;
    return {
      ...run,
      normalizeConfig: normalizeConfigJson ? JSON.parse(normalizeConfigJson) : undefined,
    };
  }

  private writeTraceArtifact(runId: string, events: RunBundle["traceEvents"]): void {
    const path = resolve("artifacts", runId, "trace.json");
    ensureParentDir(path);
    writeFileSync(path, JSON.stringify(events, null, 2));
  }

  private ensureSchemaVersion(): void {
    const existing = this.db
      .prepare(`SELECT value FROM metadata WHERE key = 'schema_version'`)
      .get() as { value: string } | undefined;

    if (!existing) {
      this.db.prepare(`INSERT INTO metadata (key, value) VALUES ('schema_version', ?)`).run(SCHEMA_VERSION);
      return;
    }

    if (existing.value === "2" && SCHEMA_VERSION === "3") {
      this.db.exec("BEGIN");
      try {
        this.ensureRunColumns();
        this.db.prepare(`UPDATE metadata SET value = ? WHERE key = 'schema_version'`).run(SCHEMA_VERSION);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      return;
    }

    if (existing.value !== SCHEMA_VERSION) {
      throw new Error(
        `Unsupported database schema version '${existing.value}'. Expected '${SCHEMA_VERSION}'. Remove artifacts/agentlab.db or add a migration.`,
      );
    }
  }

  private ensureAgentVersionColumns(): void {
    const columns = this.db.prepare(`PRAGMA table_info(agent_versions)`).all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("command")) {
      this.db.exec(`ALTER TABLE agent_versions ADD COLUMN command TEXT`);
    }
    if (!names.has("args_json")) {
      this.db.exec(`ALTER TABLE agent_versions ADD COLUMN args_json TEXT`);
    }
    if (!names.has("variant_set_name")) {
      this.db.exec(`ALTER TABLE agent_versions ADD COLUMN variant_set_name TEXT`);
    }
    if (!names.has("variant_label")) {
      this.db.exec(`ALTER TABLE agent_versions ADD COLUMN variant_label TEXT`);
    }
    if (!names.has("prompt_version")) {
      this.db.exec(`ALTER TABLE agent_versions ADD COLUMN prompt_version TEXT`);
    }
    if (!names.has("model_version")) {
      this.db.exec(`ALTER TABLE agent_versions ADD COLUMN model_version TEXT`);
    }
    if (!names.has("tool_schema_version")) {
      this.db.exec(`ALTER TABLE agent_versions ADD COLUMN tool_schema_version TEXT`);
    }
    if (!names.has("config_label")) {
      this.db.exec(`ALTER TABLE agent_versions ADD COLUMN config_label TEXT`);
    }
    if (!names.has("config_hash")) {
      this.db.exec(`ALTER TABLE agent_versions ADD COLUMN config_hash TEXT`);
    }
    if (!names.has("runtime_profile_name")) {
      this.db.exec(`ALTER TABLE agent_versions ADD COLUMN runtime_profile_name TEXT`);
    }
    if (!names.has("suite_definition_name")) {
      this.db.exec(`ALTER TABLE agent_versions ADD COLUMN suite_definition_name TEXT`);
    }
  }

  private ensureRunColumns(): void {
    const columns = this.db.prepare(`PRAGMA table_info(runs)`).all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("suite_batch_id")) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN suite_batch_id TEXT`);
    }
    if (!names.has("variant_set_name")) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN variant_set_name TEXT`);
    }
    if (!names.has("variant_label")) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN variant_label TEXT`);
    }
    if (!names.has("prompt_version")) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN prompt_version TEXT`);
    }
    if (!names.has("model_version")) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN model_version TEXT`);
    }
    if (!names.has("tool_schema_version")) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN tool_schema_version TEXT`);
    }
    if (!names.has("config_label")) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN config_label TEXT`);
    }
    if (!names.has("config_hash")) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN config_hash TEXT`);
    }
    if (!names.has("runtime_profile_name")) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN runtime_profile_name TEXT`);
    }
    if (!names.has("suite_definition_name")) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN suite_definition_name TEXT`);
    }
    if (!names.has("is_baseline")) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN is_baseline INTEGER NOT NULL DEFAULT 0`);
    }
    if (!names.has("normalize_config_json")) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN normalize_config_json TEXT`);
    }
  }

  private getRunsBySuiteBatchId(suiteBatchId: string): RunBundle[] {
    const runIds = this.db
      .prepare(`SELECT id FROM runs WHERE suite_batch_id = ? ORDER BY scenario_id ASC`)
      .all(suiteBatchId) as Array<{ id: string }>;

    return runIds
      .map((row) => this.getRun(row.id))
      .filter((bundle): bundle is RunBundle => bundle !== null);
  }
}

function buildEvaluatorDiffs(baseline: RunBundle, candidate: RunBundle): RunComparison["evaluatorDiffs"] {
  const ids = new Set([
    ...baseline.evaluatorResults.map((result) => result.evaluatorId),
    ...candidate.evaluatorResults.map((result) => result.evaluatorId),
  ]);

  return [...ids]
    .sort()
    .map((evaluatorId) => {
      const baselineResult = baseline.evaluatorResults.find((result) => result.evaluatorId === evaluatorId);
      const candidateResult = candidate.evaluatorResults.find((result) => result.evaluatorId === evaluatorId);
      if (baselineResult?.status === candidateResult?.status) {
        return null;
      }
      const hardGate = baselineResult?.mode === "hard_gate" || candidateResult?.mode === "hard_gate";
      return {
        evaluatorId,
        hardGate,
        weight: candidateResult?.weight ?? baselineResult?.weight,
        baselineStatus: baselineResult?.status,
        candidateStatus: candidateResult?.status,
        note: `Evaluator '${evaluatorId}' changed: ${baselineResult?.status ?? "missing"} -> ${candidateResult?.status ?? "missing"}`,
      };
    })
    .filter((diff): diff is NonNullable<typeof diff> => diff !== null)
    .sort((left, right) => Number(right.hardGate) - Number(left.hardGate) || left.evaluatorId.localeCompare(right.evaluatorId));
}

function buildToolDiffs(baseline: RunBundle, candidate: RunBundle): RunComparison["toolDiffs"] {
  const toolNames = new Set([
    ...baseline.toolCalls.map((call) => call.toolName),
    ...candidate.toolCalls.map((call) => call.toolName),
  ]);

  return [...toolNames]
    .sort()
    .map((toolName) => {
      const baselineCount = baseline.toolCalls.filter((call) => call.toolName === toolName).length;
      const candidateCount = candidate.toolCalls.filter((call) => call.toolName === toolName).length;
      if (baselineCount === candidateCount) {
        return null;
      }
      const diff: RunComparison["toolDiffs"][number] = {
        toolName,
        baselineCount,
        candidateCount,
        risk: baselineCount === 0 && candidateCount > 0 ? "new_tool" : "none",
        note: `Tool '${toolName}' usage changed: ${baselineCount} -> ${candidateCount}`,
      };
      return diff;
    })
    .filter((diff): diff is NonNullable<typeof diff> => diff !== null);
}

function compareRunBundles(baseline: RunBundle, candidate: RunBundle): RunComparison {
  if (baseline.run.scenarioId !== candidate.run.scenarioId) {
    throw new Error("Runs can only be compared when they share the same scenario id.");
  }
  if (baseline.run.scenarioFileHash !== candidate.run.scenarioFileHash) {
    throw new Error("Runs can only be compared when they share the same scenario file hash.");
  }

  const notes: string[] = [];
  const verdictDelta = `${baseline.run.status} -> ${candidate.run.status}`;
  if (baseline.run.status !== candidate.run.status) {
    notes.push(`Verdict changed: ${verdictDelta}`);
  }
  if (baseline.run.score !== candidate.run.score) {
    notes.push(`Score changed: ${baseline.run.score} -> ${candidate.run.score}`);
  }
  if (baseline.run.totalSteps !== candidate.run.totalSteps) {
    notes.push(`Steps changed: ${baseline.run.totalSteps} -> ${candidate.run.totalSteps}`);
  }
  if (baseline.run.durationMs !== candidate.run.durationMs) {
    notes.push(`Runtime changed: ${baseline.run.durationMs}ms -> ${candidate.run.durationMs}ms`);
  }
  if (baseline.run.terminationReason !== candidate.run.terminationReason) {
    notes.push(`Termination changed: ${baseline.run.terminationReason} -> ${candidate.run.terminationReason}`);
  }

  const evaluatorDiffs = buildEvaluatorDiffs(baseline, candidate);
  const toolDiffs = buildToolDiffs(baseline, candidate);
  const hardGateRegression = evaluatorDiffs.some((diff) => diff.hardGate && diff.baselineStatus === "pass" && diff.candidateStatus === "fail");
  const scoreDelta = candidate.run.score - baseline.run.score;
  const runtimeDeltaMs = candidate.run.durationMs - baseline.run.durationMs;
  const stepDelta = candidate.run.totalSteps - baseline.run.totalSteps;
  const runtimePct = baseline.run.durationMs === 0 ? 0 : Math.round((runtimeDeltaMs / baseline.run.durationMs) * 100);
  const normalizationRules = baseline.run.normalizeConfig ?? [];
  const baselineOutput = normalizeOutput(baseline.run.finalOutput, normalizationRules);
  const candidateOutput = normalizeOutput(candidate.run.finalOutput, normalizationRules);
  const outputChanged = baselineOutput !== candidateOutput;
  if (outputChanged) {
    notes.push("Final output changed.");
  }

  return {
    baseline,
    candidate,
    classification: classifyComparison({
      baselineStatus: baseline.run.status,
      candidateStatus: candidate.run.status,
      scoreDelta,
      runtimePct,
      stepDelta,
      hardGateRegression,
    }),
    verdictDelta,
    terminationDelta:
      baseline.run.terminationReason === candidate.run.terminationReason
        ? undefined
        : `${baseline.run.terminationReason} -> ${candidate.run.terminationReason}`,
    outputChanged,
    notes,
    deltas: {
      score: scoreDelta,
      runtimeMs: runtimeDeltaMs,
      steps: stepDelta,
      runtimePct,
    },
    evaluatorDiffs,
    toolDiffs,
  };
}

function classifyComparison(input: {
  baselineStatus: RunRecord["status"];
  candidateStatus: RunRecord["status"];
  scoreDelta: number;
  runtimePct: number;
  stepDelta: number;
  hardGateRegression: boolean;
}): RunComparison["classification"] {
  if (
    input.baselineStatus === "pass" &&
    (input.candidateStatus !== "pass" || input.hardGateRegression || input.scoreDelta < -5 || input.runtimePct > 25 || input.stepDelta > 2)
  ) {
    return "regressed";
  }
  if (input.baselineStatus !== "pass" && input.candidateStatus === "pass") {
    return "improved";
  }
  if (
    input.baselineStatus === input.candidateStatus &&
    input.baselineStatus === "pass" &&
    input.scoreDelta >= 0 &&
    input.runtimePct <= 25 &&
    input.stepDelta <= 2 &&
    !input.hardGateRegression
  ) {
    return "unchanged_pass";
  }
  if (input.baselineStatus === input.candidateStatus && input.baselineStatus === "fail") {
    return "unchanged_fail";
  }
  if (input.baselineStatus !== "pass" && input.candidateStatus !== "pass" && input.scoreDelta > 0) {
    return "improved";
  }
  if (input.scoreDelta < -5 || input.runtimePct > 25 || input.stepDelta > 2 || input.hardGateRegression) {
    return "regressed";
  }
  return "changed_non_terminal";
}

function summarizeRuns(runs: RunBundle[]): {
  pass: number;
  fail: number;
  error: number;
  averageScore: number;
  averageRuntimeMs: number;
  averageSteps: number;
} {
  const pass = runs.filter((bundle) => bundle.run.status === "pass").length;
  const fail = runs.filter((bundle) => bundle.run.status === "fail").length;
  const error = runs.filter((bundle) => bundle.run.status === "error").length;
  const averageScore = runs.length === 0 ? 0 : Math.round(runs.reduce((sum, bundle) => sum + bundle.run.score, 0) / runs.length);
  const averageRuntimeMs = runs.length === 0 ? 0 : Math.round(runs.reduce((sum, bundle) => sum + bundle.run.durationMs, 0) / runs.length);
  const averageSteps = runs.length === 0 ? 0 : Math.round(runs.reduce((sum, bundle) => sum + bundle.run.totalSteps, 0) / runs.length);
  return { pass, fail, error, averageScore, averageRuntimeMs, averageSteps };
}

function deriveSuiteName(scenarioId: string): string {
  return scenarioId.split(".")[0] ?? "unknown";
}
