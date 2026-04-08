import { statSync, readFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { parse } from "yaml";

import type { AgentLabConfig, AgentRegistration, HttpAgentRegistration, ToolRegistration } from "./types.js";

const CONFIG_PATH = resolve("agentlab.config.yaml");

export function loadAgentLabConfig(): AgentLabConfig {
  if (!exists(CONFIG_PATH)) {
    return {};
  }

  const raw = readFileSync(CONFIG_PATH, "utf8");
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
}

function validateToolRegistration(value: unknown): asserts value is ToolRegistration {
  if (!isObject(value)) {
    throw new Error("Each tool registration in agentlab.config.yaml must be an object.");
  }

  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new Error("Each tool registration must define a non-empty 'name'.");
  }

  if (typeof value.modulePath !== "string" || value.modulePath.length === 0) {
    throw new Error(`Tool '${value.name}' must define a non-empty 'modulePath'.`);
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

  const resolved = resolve(value.modulePath);
  const root = `${process.cwd()}${sep}`;
  if (!(resolved === process.cwd() || resolved.startsWith(root))) {
    throw new Error(`Tool '${value.name}' modulePath must stay within the repo.`);
  }
  if (!exists(resolved)) {
    throw new Error(`Tool '${value.name}' references missing module '${relative(process.cwd(), resolved)}'.`);
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
