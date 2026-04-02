import OpenAI from "openai";

import type { AgentAdapter, AgentEvent, AgentRunInput, AgentSession, AgentTurnResult, ToolSpec } from "../types.js";

type OpenAIResponsesClient = {
  responses: {
    create(request: unknown): Promise<any>;
  };
};

type OpenAIResponsesAgentAdapterOptions = {
  apiKey?: string;
  client?: OpenAIResponsesClient;
};

type PendingToolCall = {
  callId: string;
  providerToolName: string;
};

class OpenAIResponsesSession implements AgentSession {
  private previousResponseId?: string;
  private pendingToolCall?: PendingToolCall;
  private readonly toolNameMap: Map<string, string>;
  private readonly providerTools: Array<{ internalName: string; providerName: string; tool: ToolSpec }>;

  constructor(
    private readonly client: OpenAIResponsesClient,
    private readonly model: string,
    private readonly input: AgentRunInput,
  ) {
    this.providerTools = input.availableTools.map((tool) => ({
      internalName: tool.name,
      providerName: toProviderToolName(tool.name),
      tool,
    }));
    this.toolNameMap = new Map(this.providerTools.map((entry) => [entry.providerName, entry.internalName]));
  }

  async next(event: AgentEvent): Promise<AgentTurnResult> {
    try {
      const requestBody: any = {
        model: this.model,
        instructions: this.input.instructions,
        input: this.buildInput(event),
        tools: this.providerTools.map((entry) => toOpenAITool(entry.providerName, entry.tool)),
        previous_response_id: this.previousResponseId,
        parallel_tool_calls: false,
      };
      const response = await this.client.responses.create(requestBody);

      this.previousResponseId = response.id;
      const output = Array.isArray((response as any).output) ? (response as any).output : [];
      const functionCall = output.find((item: any) => item?.type === "function_call");

      if (functionCall) {
        const providerToolName = String(functionCall.name);
        const internalToolName = this.toolNameMap.get(providerToolName);
        if (!internalToolName) {
          return {
            type: "error",
            message: `OpenAI requested unknown provider tool '${providerToolName}'.`,
          };
        }

        this.pendingToolCall = {
          callId: String(functionCall.call_id),
          providerToolName,
        };
        return {
          type: "tool_call",
          toolName: internalToolName,
          input: safeJsonParse(String(functionCall.arguments ?? "{}")),
          metadata: {
            responseId: response.id,
            providerToolName,
            message: `OpenAI requested tool ${internalToolName}.`,
          },
        };
      }

      const finalOutput = typeof (response as any).output_text === "string" ? (response as any).output_text : "";
      if (finalOutput) {
        return {
          type: "final",
          output: finalOutput,
          metadata: {
            responseId: response.id,
            usage: (response as any).usage ?? undefined,
          },
        };
      }

      return {
        type: "error",
        message: "OpenAI response did not include a function call or final output.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { type: "error", message };
    }
  }

  private buildInput(event: AgentEvent): any {
    if (event.type === "run_started") {
      return [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildInitialPrompt(this.input),
            },
          ],
        },
      ];
    }

    if (event.type === "tool_result") {
      if (!this.pendingToolCall) {
        throw new Error("Received tool result without a pending provider tool call.");
      }

      const output = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
      const payload = [
        {
          type: "function_call_output",
          call_id: this.pendingToolCall.callId,
          output,
        },
      ];
      this.pendingToolCall = undefined;
      return payload;
    }

    throw new Error(event.message);
  }
}

export class OpenAIResponsesAgentAdapter implements AgentAdapter {
  constructor(private readonly options: OpenAIResponsesAgentAdapterOptions) {}

  async startRun(input: AgentRunInput): Promise<AgentSession> {
    if (!this.options.apiKey && !this.options.client) {
      throw new Error("OPENAI_API_KEY is required for provider=openai.");
    }

    const model = typeof input.metadata?.model === "string" && input.metadata.model.length > 0 ? input.metadata.model : "gpt-4o-mini";

    const client = this.options.client ?? new OpenAI({ apiKey: this.options.apiKey });
    return new OpenAIResponsesSession(client, model, input);
  }
}

function toOpenAITool(providerName: string, tool: ToolSpec): any {
  return {
    type: "function",
    name: providerName,
    description: tool.description ?? "",
    parameters: tool.inputSchema ?? {
      type: "object",
      additionalProperties: true,
      properties: {},
    },
  };
}

function buildInitialPrompt(input: AgentRunInput): string {
  const context = JSON.stringify(input.context, null, 2);
  const tools = input.availableTools
    .map((tool) => `- ${toProviderToolName(tool.name)}: ${tool.description ?? "No description"}`)
    .join("\n");
  return `Task:\n${input.instructions}\n\nContext:\n${context}\n\nAvailable tools:\n${tools}\n\nUse tools when needed and provide a final answer when the task is complete.`;
}

function toProviderToolName(internalName: string): string {
  return internalName.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
