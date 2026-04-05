export type EvaluatorMode = "hard_gate" | "weighted";
export type EvaluatorStatus = "pass" | "fail" | "warn";
export type RunStatus = "pass" | "fail" | "error";
export type ComparisonClassification = "improved" | "regressed" | "unchanged_pass" | "unchanged_fail" | "changed_non_terminal";
export type TerminationReason =
  | "completed"
  | "evaluator_failed"
  | "step_limit_exceeded"
  | "forbidden_tool_used"
  | "timeout_exceeded"
  | "tool_error"
  | "agent_error";

export type ToolSpec = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type ToolRegistration = ToolSpec & {
  modulePath?: string;
  exportName?: string;
};

export type ScenarioDefinition = {
  id: string;
  name: string;
  suite: string;
  description?: string;
  tags?: string[];
  difficulty?: string;
  task: {
    instructions: string;
    success_hint?: string;
  };
  context?: {
    fixtures?: string[];
    variables?: Record<string, unknown>;
  };
  tools: {
    allowed: string[];
    forbidden?: string[];
  };
  runtime?: {
    max_steps?: number;
    timeout_seconds?: number;
  };
  evaluators: ScenarioEvaluator[];
  agent_preset?: {
    system_prompt?: string;
  };
};

export type ScenarioEvaluator = {
  id: string;
  type:
    | "exact_final_answer"
    | "final_answer_contains"
    | "forbidden_tool"
    | "tool_call_assertion"
    | "step_count_max";
  mode: EvaluatorMode;
  weight?: number;
  config: Record<string, unknown>;
};

export type AgentVersion = {
  id: string;
  label: string;
  modelId?: string;
  provider?: string;
  command?: string;
  args?: string[];
  config: Record<string, unknown>;
};

export type AgentRuntimeConfig = {
  provider: "mock" | "openai" | "external_process";
  model?: string;
  label?: string;
  agentName?: string;
  command?: string;
  args?: string[];
  envAllowlist?: string[];
};

export type AgentRunInput = {
  instructions: string;
  availableTools: ToolSpec[];
  context: Record<string, unknown>;
  maxSteps?: number;
  metadata?: Record<string, unknown>;
};

export type AgentEvent =
  | { type: "run_started" }
  | { type: "tool_result"; toolName: string; result: unknown }
  | { type: "runner_error"; message: string };

export type AgentTurnResult =
  | { type: "tool_call"; toolName: string; input: unknown; metadata?: Record<string, unknown> }
  | { type: "final"; output: string; metadata?: Record<string, unknown> }
  | { type: "error"; message: string; retryable?: boolean };

export interface AgentSession {
  next(event: AgentEvent): Promise<AgentTurnResult>;
}

export interface AgentAdapter {
  startRun(input: AgentRunInput): Promise<AgentSession>;
}

export type AgentAdapterFactory = {
  createAdapter(): AgentAdapter;
  createVersion(config: AgentRuntimeConfig): AgentVersion;
};

export type TraceEvent = {
  eventId: string;
  runId: string;
  scenarioId: string;
  stepIndex: number;
  timestamp: string;
  source: "runner" | "agent" | "tool" | "evaluator" | "system";
  type:
    | "run_started"
    | "run_finished"
    | "run_failed"
    | "agent_turn_started"
    | "agent_message"
    | "agent_final_output"
    | "agent_error"
    | "tool_call_requested"
    | "tool_call_started"
    | "tool_call_completed"
    | "tool_call_failed"
    | "step_budget_exceeded"
    | "forbidden_tool_attempted"
    | "timeout_exceeded"
    | "evaluation_started"
    | "evaluation_result"
    | "evaluation_finished";
  payload: Record<string, unknown>;
};

export type EvaluatorResult = {
  evaluatorId: string;
  evaluatorType: ScenarioEvaluator["type"];
  mode: EvaluatorMode;
  status: EvaluatorStatus;
  rawScore?: number;
  normalizedScore?: number;
  weight?: number;
  message: string;
  details?: Record<string, unknown>;
};

export type ToolCallRecord = {
  id: string;
  stepIndex: number;
  toolName: string;
  input: unknown;
  output?: unknown;
  status: "pass" | "fail";
  durationMs?: number;
  errorMessage?: string;
};

export type RunRecord = {
  id: string;
  scenarioId: string;
  scenarioFileHash: string;
  agentVersionId: string;
  suiteBatchId?: string;
  status: RunStatus;
  terminationReason: TerminationReason;
  finalOutput: string;
  totalSteps: number;
  totalToolCalls: number;
  durationMs: number;
  totalTokens?: number;
  totalCostUsd?: number;
  score: number;
  startedAt: string;
  finishedAt: string;
};

export type RunBundle = {
  run: RunRecord;
  traceEvents: TraceEvent[];
  toolCalls: ToolCallRecord[];
  evaluatorResults: EvaluatorResult[];
  agentVersion?: AgentVersion;
};

export type ScenarioSummary = {
  id: string;
  name: string;
  suite: string;
  difficulty?: string;
  description?: string;
};

export type RunListFilters = {
  suite?: string;
  status?: RunStatus;
  provider?: string;
};

export type RunListItem = {
  id: string;
  scenarioId: string;
  suite: string;
  suiteBatchId?: string;
  agentVersionId: string;
  agentLabel?: string;
  provider?: string;
  modelId?: string;
  status: RunStatus;
  score: number;
  durationMs: number;
  totalSteps: number;
  startedAt: string;
};

export type RunComparison = {
  baseline: RunBundle;
  candidate: RunBundle;
  classification: ComparisonClassification;
  verdictDelta: string;
  terminationDelta?: string;
  outputChanged: boolean;
  notes: string[];
  deltas: {
    score: number;
    runtimeMs: number;
    steps: number;
    runtimePct: number;
  };
  evaluatorDiffs: Array<{
    evaluatorId: string;
    hardGate: boolean;
    weight?: number;
    baselineStatus?: EvaluatorStatus;
    candidateStatus?: EvaluatorStatus;
    note: string;
  }>;
  toolDiffs: Array<{
    toolName: string;
    baselineCount: number;
    candidateCount: number;
    risk: "none" | "new_tool";
    note: string;
  }>;
};

export type SuiteScenarioComparison = {
  scenarioId: string;
  comparison: RunComparison;
};

export type SuiteComparison = {
  suite: string;
  baselineBatchId: string;
  candidateBatchId: string;
  classification: "improved" | "regressed" | "unchanged" | "mixed";
  notes: string[];
  deltas: {
    pass: number;
    fail: number;
    error: number;
    averageScore: number;
    averageRuntimeMs: number;
    averageSteps: number;
  };
  regressions: SuiteScenarioComparison[];
  improvements: SuiteScenarioComparison[];
  unchanged: SuiteScenarioComparison[];
  missingFromCandidate: string[];
  missingFromBaseline: string[];
};

export type AgentLabConfig = {
  tools?: ToolRegistration[];
  agents?: AgentRegistration[];
};

export type AgentRegistration = {
  name: string;
  provider: "mock" | "openai" | "external_process";
  model?: string;
  label?: string;
  command?: string;
  args?: string[];
  envAllowlist?: string[];
};
