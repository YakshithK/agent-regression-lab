export type EvaluatorMode = "hard_gate" | "weighted";
export type EvaluatorStatus = "pass" | "fail" | "warn";
export type RunStatus = "pass" | "fail" | "error";
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
  config: Record<string, unknown>;
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
};

export type ScenarioSummary = {
  id: string;
  name: string;
  suite: string;
  difficulty?: string;
  description?: string;
};
