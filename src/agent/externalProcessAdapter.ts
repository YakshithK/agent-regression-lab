import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

import type { AgentAdapter, AgentEvent, AgentRunInput, AgentSession, AgentTurnResult } from "../types.js";

type ExternalProcessAgentAdapterOptions = {
  command: string;
  args?: string[];
  envAllowlist?: string[];
  responseTimeoutMs?: number;
};

type ProtocolEvent =
  | { type: "run_started"; input: AgentRunInput }
  | { type: "tool_result"; toolName: string; result: unknown }
  | { type: "runner_error"; message: string };

type ProtocolResponse =
  | { type: "tool_call"; toolName: string; input: unknown; metadata?: Record<string, unknown> }
  | { type: "final"; output: string; metadata?: Record<string, unknown> }
  | { type: "error"; message: string; retryable?: boolean };

class ExternalProcessAgentSession implements AgentSession {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly stdoutLines: string[] = [];
  private readonly stderrLines: string[] = [];
  private pendingResolver?: { resolve: (value: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
  private exited = false;
  private closed = false;

  constructor(
    private readonly input: AgentRunInput,
    private readonly options: Required<ExternalProcessAgentAdapterOptions>,
  ) {
    this.process = spawn(this.options.command, this.options.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: buildChildEnv(this.options.envAllowlist),
    });

    const stdoutReader = readline.createInterface({ input: this.process.stdout });
    stdoutReader.on("line", (line) => this.handleStdoutLine(line));
    this.process.stderr.on("data", (chunk) => {
      this.stderrLines.push(String(chunk).trim());
    });
    this.process.on("exit", (code, signal) => {
      this.exited = true;
      if (this.pendingResolver) {
        const detail = this.stderrLines.filter(Boolean).join(" | ");
        this.pendingResolver.reject(
          new Error(
            `External agent exited before responding (code=${String(code)}, signal=${String(signal)}${detail ? `, stderr=${detail}` : ""}).`,
          ),
        );
        clearTimeout(this.pendingResolver.timer);
        this.pendingResolver = undefined;
      }
    });
  }

  async next(event: AgentEvent): Promise<AgentTurnResult> {
    if (this.exited || this.closed) {
      return { type: "error", message: "External agent process is no longer running." };
    }

    try {
      const response = await this.sendAndReceive(toProtocolEvent(event, this.input), this.options.responseTimeoutMs);
      const parsed = parseProtocolResponse(response);
      if (parsed.type === "final" || parsed.type === "error") {
        this.close();
      }
      return parsed;
    } catch (error) {
      this.close();
      return { type: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  private sendAndReceive(event: ProtocolEvent, timeoutMs: number): Promise<string> {
    this.process.stdin.write(`${JSON.stringify(event)}\n`);

    if (this.stdoutLines.length > 0) {
      return Promise.resolve(this.stdoutLines.shift()!);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResolver = undefined;
        reject(new Error(`External agent timed out after ${timeoutMs}ms waiting for a response.`));
      }, timeoutMs);
      this.pendingResolver = { resolve, reject, timer };
    });
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    if (this.pendingResolver) {
      const { resolve, timer } = this.pendingResolver;
      clearTimeout(timer);
      this.pendingResolver = undefined;
      resolve(trimmed);
      return;
    }

    this.stdoutLines.push(trimmed);
  }

  private close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (!this.exited) {
      this.process.kill();
    }
  }
}

export class ExternalProcessAgentAdapter implements AgentAdapter {
  constructor(private readonly options: ExternalProcessAgentAdapterOptions) {}

  async startRun(input: AgentRunInput): Promise<AgentSession> {
    if (!this.options.command) {
      throw new Error("External process agent requires a command.");
    }

    return new ExternalProcessAgentSession(input, {
      command: this.options.command,
      args: this.options.args ?? [],
      envAllowlist: this.options.envAllowlist ?? [],
      responseTimeoutMs: this.options.responseTimeoutMs ?? 10_000,
    });
  }
}

function toProtocolEvent(event: AgentEvent, input: AgentRunInput): ProtocolEvent {
  if (event.type === "run_started") {
    return { type: "run_started", input };
  }
  if (event.type === "tool_result") {
    return event;
  }
  return event;
}

function parseProtocolResponse(raw: string): AgentTurnResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`External agent returned invalid JSON: ${raw}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || typeof (parsed as any).type !== "string") {
    throw new Error("External agent returned an invalid protocol message.");
  }

  const type = (parsed as any).type;
  if (type === "tool_call") {
    if (typeof (parsed as any).toolName !== "string") {
      throw new Error("External agent tool_call response is missing toolName.");
    }
    return {
      type: "tool_call",
      toolName: (parsed as any).toolName,
      input: (parsed as any).input ?? {},
      metadata: isObject((parsed as any).metadata) ? (parsed as any).metadata : undefined,
    };
  }
  if (type === "final") {
    if (typeof (parsed as any).output !== "string") {
      throw new Error("External agent final response is missing output.");
    }
    return {
      type: "final",
      output: (parsed as any).output,
      metadata: isObject((parsed as any).metadata) ? (parsed as any).metadata : undefined,
    };
  }
  if (type === "error") {
    if (typeof (parsed as any).message !== "string") {
      throw new Error("External agent error response is missing message.");
    }
    return {
      type: "error",
      message: (parsed as any).message,
      retryable: Boolean((parsed as any).retryable),
    };
  }

  throw new Error(`External agent returned unsupported response type '${String(type)}'.`);
}

function buildChildEnv(allowlist: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowlist) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  env.PATH = process.env.PATH;
  env.PWD = process.cwd();
  env.HOME = process.env.HOME;
  return env;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
