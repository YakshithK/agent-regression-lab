import { ExternalProcessAgentAdapter } from "./externalProcessAdapter.js";
import { MockAgentAdapter } from "./mockAdapter.js";
import { OpenAIResponsesAgentAdapter } from "./openaiResponsesAdapter.js";
import { createAgentVersionId } from "../lib/id.js";
import type { AgentAdapterFactory, AgentRuntimeConfig, AgentVersion } from "../types.js";

class MockAgentAdapterFactory implements AgentAdapterFactory {
  createAdapter() {
    return new MockAgentAdapter();
  }

  createVersion(config: AgentRuntimeConfig): AgentVersion {
    const label = config.label ?? config.agentName ?? "mock-support-agent-v1";
    const payload = { adapter: "mock", domain: "support", agentName: config.agentName };
    return {
      id: createAgentVersionId(label, payload),
      label,
      modelId: "mock-model",
      provider: "mock",
      config: payload,
    };
  }
}

class OpenAIAdapterFactory implements AgentAdapterFactory {
  createAdapter() {
    return new OpenAIResponsesAgentAdapter({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  createVersion(config: AgentRuntimeConfig): AgentVersion {
    const model = config.model ?? "gpt-4o-mini";
    const label = config.label ?? config.agentName ?? `openai-${model}`;
    const payload = { provider: "openai", model, agentName: config.agentName };
    return {
      id: createAgentVersionId(label, payload),
      label,
      modelId: model,
      provider: "openai",
      config: payload,
    };
  }
}

class ExternalProcessAdapterFactory implements AgentAdapterFactory {
  createAdapter(config: AgentRuntimeConfig = {} as AgentRuntimeConfig) {
    return new ExternalProcessAgentAdapter({
      command: config.command ?? "",
      args: config.args ?? [],
      envAllowlist: config.envAllowlist ?? [],
    });
  }

  createVersion(config: AgentRuntimeConfig): AgentVersion {
    const label = config.label ?? config.agentName ?? "external-process-agent";
    const payload = {
      provider: "external_process",
      command: config.command,
      args: config.args ?? [],
      agentName: config.agentName,
    };
    return {
      id: createAgentVersionId(label, payload),
      label,
      provider: "external_process",
      command: config.command,
      args: config.args ?? [],
      config: payload,
    };
  }
}

export function createAgentFactory(config: AgentRuntimeConfig): AgentAdapterFactory {
  switch (config.provider) {
    case "mock":
      return new MockAgentAdapterFactory();
    case "openai":
      return new OpenAIAdapterFactory();
    case "external_process":
      return {
        createAdapter: () =>
          new ExternalProcessAgentAdapter({
            command: config.command ?? "",
            args: config.args ?? [],
            envAllowlist: config.envAllowlist ?? [],
          }),
        createVersion: (runtimeConfig) => new ExternalProcessAdapterFactory().createVersion(runtimeConfig),
      };
    default:
      throw new Error(`Unsupported provider '${String(config.provider)}'.`);
  }
}
