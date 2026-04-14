import { statSync, readFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { parse } from "yaml";

import type {
  AgentLabConfig,
  AgentRegistration,
  HttpAgentRegistration,
  RuntimeProfileDefinition,
  SuiteDefinition,
  ToolRegistration,
  VariantSetDefinition,
} from "./types.js";

export function loadAgentLabConfig(): AgentLabConfig {
  const configPath = resolve("agentlab.config.yaml");
  if (!exists(configPath)) {
    return {};
  }

  const raw = readFileSync(configPath, "utf8");
  const parsed = parse(raw) as unknown;
  validateConfig(parsed);
  return parsed;
}

function validateConfig(value: unknown): asserts value is AgentLabConfig {
  if (!isObject(value)) {
    throw new Error("agentlab.config.yaml must contain a YAML object.");
  }

  if (value.tools !== undefined) {
    if (!Array.isArray(value.tools)) {
      throw new Error("agentlab.config.yaml field 'tools' must be an array.");
    }

    const names = new Set<string>();
    for (const tool of value.tools) {
      validateToolRegistration(tool);
      if (names.has(tool.name)) {
        throw new Error(`agentlab.config.yaml defines duplicate tool '${tool.name}'.`);
      }
      names.add(tool.name);
    }
  }

  if (value.agents !== undefined) {
    if (!Array.isArray(value.agents)) {
      throw new Error("agentlab.config.yaml field 'agents' must be an array.");
    }

    const names = new Set<string>();
    for (const agent of value.agents) {
      validateAgentRegistration(agent);
      if (names.has(agent.name)) {
        throw new Error(`agentlab.config.yaml defines duplicate agent '${agent.name}'.`);
      }
      names.add(agent.name);
    }
  }

  const agents = (value.agents ?? []) as Array<{ name: string }>;
  const agentNames = new Set<string>(agents.map((agent) => agent.name));

  if (value.variant_sets !== undefined) {
    if (!Array.isArray(value.variant_sets)) {
      throw new Error("agentlab.config.yaml field 'variant_sets' must be an array.");
    }

    const names = new Set<string>();
    for (const variantSet of value.variant_sets) {
      validateVariantSetDefinition(variantSet, agentNames);
      if (names.has(variantSet.name)) {
        throw new Error(`agentlab.config.yaml defines duplicate variant set '${variantSet.name}'.`);
      }
      names.add(variantSet.name);
    }
  }

  if (value.runtime_profiles !== undefined) {
    if (!Array.isArray(value.runtime_profiles)) {
      throw new Error("agentlab.config.yaml field 'runtime_profiles' must be an array.");
    }

    const names = new Set<string>();
    for (const runtimeProfile of value.runtime_profiles) {
      validateRuntimeProfileDefinition(runtimeProfile);
      if (names.has(runtimeProfile.name)) {
        throw new Error(`agentlab.config.yaml defines duplicate runtime profile '${runtimeProfile.name}'.`);
      }
      names.add(runtimeProfile.name);
    }
  }

  if (value.suite_definitions !== undefined) {
    if (!Array.isArray(value.suite_definitions)) {
      throw new Error("agentlab.config.yaml field 'suite_definitions' must be an array.");
    }

    const names = new Set<string>();
    for (const suiteDefinition of value.suite_definitions) {
      validateSuiteDefinition(suiteDefinition);
      if (names.has(suiteDefinition.name)) {
        throw new Error(`agentlab.config.yaml defines duplicate suite definition '${suiteDefinition.name}'.`);
      }
      names.add(suiteDefinition.name);
    }
  }
}

function validateToolRegistration(value: unknown): asserts value is ToolRegistration {
  if (!isObject(value)) {
    throw new Error("Each tool registration in agentlab.config.yaml must be an object.");
  }

  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new Error("Each tool registration must define a non-empty 'name'.");
  }

  const hasModulePath = typeof value.modulePath === "string" && value.modulePath.length > 0;
  const hasPackage = typeof value.package === "string" && value.package.length > 0;

  if ((hasModulePath ? 1 : 0) + (hasPackage ? 1 : 0) !== 1) {
    throw new Error(`Tool '${value.name}' must define exactly one of 'modulePath' or 'package'.`);
  }

  if (typeof value.exportName !== "string" || value.exportName.length === 0) {
    throw new Error(`Tool '${value.name}' must define a non-empty 'exportName'.`);
  }

  if (typeof value.description !== "string" || value.description.length === 0) {
    throw new Error(`Tool '${value.name}' must define a non-empty 'description'.`);
  }

  if (!isObject(value.inputSchema)) {
    throw new Error(`Tool '${value.name}' must define an object 'inputSchema'.`);
  }

  if (hasModulePath) {
    const resolved = resolve(value.modulePath!);
    const root = `${process.cwd()}${sep}`;
    if (!(resolved === process.cwd() || resolved.startsWith(root))) {
      throw new Error(`Tool '${value.name}' modulePath must stay within the repo.`);
    }
    if (!exists(resolved)) {
      throw new Error(`Tool '${value.name}' references missing module '${relative(process.cwd(), resolved)}'.`);
    }
  }
}

function validateAgentRegistration(value: unknown): asserts value is AgentRegistration {
  if (!isObject(value)) {
    throw new Error("Each agent registration in agentlab.config.yaml must be an object.");
  }

  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new Error("Each agent registration must define a non-empty 'name'.");
  }

  if (value.provider !== "mock" && value.provider !== "openai" && value.provider !== "external_process" && value.provider !== "http") {
    throw new Error(`Agent '${value.name}' uses unsupported provider '${String(value.provider)}'.`);
  }

  if (value.label !== undefined && (typeof value.label !== "string" || value.label.length === 0)) {
    throw new Error(`Agent '${value.name}' must define a non-empty 'label' when provided.`);
  }

  if (value.provider === "http") {
    validateHttpAgentConfig(value);
    return;
  }

  if (value.provider === "openai" && value.model !== undefined && (typeof value.model !== "string" || value.model.length === 0)) {
    throw new Error(`Agent '${value.name}' must define a non-empty 'model' when provided.`);
  }

  if (value.provider === "external_process") {
    if (typeof value.command !== "string" || value.command.length === 0) {
      throw new Error(`Agent '${value.name}' must define a non-empty 'command'.`);
    }
    if (value.args !== undefined) {
      if (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== "string")) {
        throw new Error(`Agent '${value.name}' field 'args' must be an array of strings.`);
      }
    }
    if (value.envAllowlist !== undefined) {
      if (!Array.isArray(value.envAllowlist) || value.envAllowlist.some((key) => typeof key !== "string" || key.length === 0)) {
        throw new Error(`Agent '${value.name}' field 'envAllowlist' must be an array of non-empty strings.`);
      }
    }
  }
}

export function validateHttpAgentConfig(value: Record<string, unknown>): void {
  const name = String(value.name ?? "");
  if (typeof value.url !== "string" || value.url.length === 0) {
    throw new Error(`Agent '${name}' with provider 'http' must define a non-empty 'url'.`);
  }
  if (value.timeout_ms !== undefined && (typeof value.timeout_ms !== "number" || value.timeout_ms <= 0)) {
    throw new Error(`Agent '${name}' field 'timeout_ms' must be a positive number.`);
  }
  if (value.request_template !== undefined) {
    if (!isObject(value.request_template)) {
      throw new Error(`Agent '${name}' field 'request_template' must be an object.`);
    }
    for (const [k, v] of Object.entries(value.request_template)) {
      if (typeof v !== "string") {
        throw new Error(`Agent '${name}' request_template field '${k}' must be a string value.`);
      }
    }
  }
  if (value.response_field !== undefined && (typeof value.response_field !== "string" || value.response_field.length === 0)) {
    throw new Error(`Agent '${name}' field 'response_field' must be a non-empty string.`);
  }
  if (value.headers !== undefined) {
    if (!isObject(value.headers)) {
      throw new Error(`Agent '${name}' field 'headers' must be an object.`);
    }
    for (const [k, v] of Object.entries(value.headers)) {
      if (typeof v !== "string") {
        throw new Error(`Agent '${name}' headers field '${k}' must be a string value.`);
      }
    }
  }
}

export function getAgentRegistration(name: string): AgentRegistration {
  const match = loadAgentLabConfig().agents?.find((agent) => agent.name === name);
  if (!match) {
    throw new Error(`agentlab.config.yaml does not define agent '${name}'.`);
  }
  return match;
}

export function getVariantSet(name: string): VariantSetDefinition {
  const match = loadAgentLabConfig().variant_sets?.find((variantSet) => variantSet.name === name);
  if (!match) {
    throw new Error(`agentlab.config.yaml does not define variant set '${name}'.`);
  }
  return match;
}

export function getRuntimeProfile(name: string): RuntimeProfileDefinition {
  const match = loadAgentLabConfig().runtime_profiles?.find((runtimeProfile) => runtimeProfile.name === name);
  if (!match) {
    throw new Error(`agentlab.config.yaml does not define runtime profile '${name}'.`);
  }
  return match;
}

export function getSuiteDefinition(name: string): SuiteDefinition {
  const match = loadAgentLabConfig().suite_definitions?.find((suiteDefinition) => suiteDefinition.name === name);
  if (!match) {
    throw new Error(`agentlab.config.yaml does not define suite definition '${name}'.`);
  }
  return match;
}

function validateVariantSetDefinition(value: unknown, agentNames: Set<string>): asserts value is VariantSetDefinition {
  if (!isObject(value)) {
    throw new Error("Each variant set definition in agentlab.config.yaml must be an object.");
  }

  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new Error("Each variant set definition must define a non-empty 'name'.");
  }

  if (!Array.isArray(value.variants)) {
    throw new Error(`Variant set '${value.name}' must define a 'variants' array.`);
  }

  const labels = new Set<string>();
  for (const variant of value.variants) {
    if (!isObject(variant)) {
      throw new Error(`Variant set '${value.name}' contains a non-object variant definition.`);
    }
    if (typeof variant.agent !== "string" || variant.agent.length === 0) {
      throw new Error(`Variant set '${value.name}' contains a variant with a non-empty 'agent' required.`);
    }
    if (!agentNames.has(variant.agent)) {
      throw new Error(`Variant set '${value.name}' references unknown agent '${variant.agent}'.`);
    }
    if (typeof variant.label !== "string" || variant.label.length === 0) {
      throw new Error(`Variant set '${value.name}' contains a variant with a non-empty 'label' required.`);
    }
    if (labels.has(variant.label)) {
      throw new Error(`Variant set '${value.name}' defines duplicate variant label '${variant.label}'.`);
    }
    labels.add(variant.label);
  }
}

function validateRuntimeProfileDefinition(value: unknown): asserts value is RuntimeProfileDefinition {
  if (!isObject(value)) {
    throw new Error("Each runtime profile definition in agentlab.config.yaml must be an object.");
  }

  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new Error("Each runtime profile definition must define a non-empty 'name'.");
  }

  if (value.tool_faults !== undefined) {
    if (!Array.isArray(value.tool_faults)) {
      throw new Error(`Runtime profile '${value.name}' field 'tool_faults' must be an array.`);
    }

    for (const fault of value.tool_faults) {
      if (!isObject(fault)) {
        throw new Error(`Runtime profile '${value.name}' contains a non-object tool fault definition.`);
      }
      if (typeof fault.tool !== "string" || fault.tool.length === 0) {
        throw new Error(`Runtime profile '${value.name}' contains a tool fault with a non-empty 'tool' required.`);
      }
      if (fault.mode !== "timeout" && fault.mode !== "error" && fault.mode !== "malformed_output" && fault.mode !== "partial_output") {
        throw new Error(`Runtime profile '${value.name}' uses invalid tool fault mode '${String(fault.mode)}'.`);
      }
      if (fault.error_message !== undefined && (typeof fault.error_message !== "string" || fault.error_message.length === 0)) {
        throw new Error(`Runtime profile '${value.name}' tool fault for '${fault.tool}' field 'error_message' must be a non-empty string.`);
      }
      if (fault.timeout_ms !== undefined && (typeof fault.timeout_ms !== "number" || fault.timeout_ms <= 0)) {
        throw new Error(`Runtime profile '${value.name}' tool fault for '${fault.tool}' field 'timeout_ms' must be a positive number.`);
      }
      if (fault.partial_output !== undefined && !isObject(fault.partial_output)) {
        throw new Error(`Runtime profile '${value.name}' tool fault for '${fault.tool}' field 'partial_output' must be an object.`);
      }
    }
  }

  if (value.state !== undefined) {
    if (!isObject(value.state)) {
      throw new Error(`Runtime profile '${value.name}' field 'state' must be an object.`);
    }
    if (value.state.reset !== "per_run" && value.state.reset !== "per_variant_run" && value.state.reset !== "manual") {
      throw new Error(`Runtime profile '${value.name}' field 'state.reset' must be one of 'per_run', 'per_variant_run', or 'manual'.`);
    }
    if (value.state.seeded_messages !== undefined) {
      if (!Array.isArray(value.state.seeded_messages)) {
        throw new Error(`Runtime profile '${value.name}' field 'state.seeded_messages' must be an array.`);
      }
      for (const message of value.state.seeded_messages) {
        if (!isObject(message)) {
          throw new Error(`Runtime profile '${value.name}' contains a non-object seeded message.`);
        }
        if (message.role !== "user" && message.role !== "assistant") {
          throw new Error(`Runtime profile '${value.name}' seeded message role must be 'user' or 'assistant'.`);
        }
        if (typeof message.message !== "string" || message.message.length === 0) {
          throw new Error(`Runtime profile '${value.name}' seeded message must define a non-empty 'message'.`);
        }
      }
    }
    if (value.state.memory_blob !== undefined && !isObject(value.state.memory_blob)) {
      throw new Error(`Runtime profile '${value.name}' field 'state.memory_blob' must be an object.`);
    }
  }
}

function validateSuiteDefinition(value: unknown): asserts value is SuiteDefinition {
  if (!isObject(value)) {
    throw new Error("Each suite definition in agentlab.config.yaml must be an object.");
  }

  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new Error("Each suite definition must define a non-empty 'name'.");
  }

  if (!isObject(value.include)) {
    throw new Error(`Suite definition '${value.name}' must define an object 'include'.`);
  }

  validateSuiteSelectorArray(value.include, value.name, "include.scenarios");
  validateSuiteSelectorArray(value.include, value.name, "include.tags");
  validateSuiteSelectorArray(value.include, value.name, "include.suites");

  if (value.exclude !== undefined) {
    if (!isObject(value.exclude)) {
      throw new Error(`Suite definition '${value.name}' field 'exclude' must be an object.`);
    }
    validateSuiteSelectorArray(value.exclude, value.name, "exclude.scenarios");
    validateSuiteSelectorArray(value.exclude, value.name, "exclude.tags");
    validateSuiteSelectorArray(value.exclude, value.name, "exclude.suites");
  }
}

function validateSuiteSelectorArray(
  value: Record<string, unknown>,
  suiteName: string,
  key: "include.scenarios" | "include.tags" | "include.suites" | "exclude.scenarios" | "exclude.tags" | "exclude.suites",
): void {
  const fieldName = key.split(".")[1];
  const selector = value[fieldName];
  if (selector !== undefined) {
    if (!Array.isArray(selector) || selector.some((item) => typeof item !== "string")) {
      throw new Error(`Suite definition '${suiteName}' field '${key}' must be an array of strings.`);
    }
  }
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
