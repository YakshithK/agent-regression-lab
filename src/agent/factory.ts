import { MockAgentAdapter } from "./mockAdapter.js";
import { OpenAIResponsesAgentAdapter } from "./openaiResponsesAdapter.js";
import { createAgentVersionId } from "../lib/id.js";
import type { AgentAdapterFactory, AgentRuntimeConfig, AgentVersion } from "../types.js";

class MockAgentAdapterFactory implements AgentAdapterFactory {
  createAdapter() {
    return new MockAgentAdapter();
  }

  createVersion(config: AgentRuntimeConfig): AgentVersion {
    const label = config.label ?? "mock-support-agent-v1";
    const payload = { adapter: "mock", domain: "support" };
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
    const model = config.model ?? "unknown-model";
    const label = config.label ?? `openai-${model}`;
    const payload = { provider: "openai", model };
    return {
      id: createAgentVersionId(label, payload),
      label,
      modelId: model,
      provider: "openai",
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
    default:
      throw new Error(`Unsupported provider '${String(config.provider)}'.`);
  }
}
