import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { parse } from "yaml";

import { loadAgentLabConfig } from "./config.js";
import { getBuiltinToolSpecs } from "./tools.js";
import type { ScenarioDefinition, ScenarioSummary } from "./types.js";

const SCENARIOS_ROOT = resolve("scenarios");

type LoadedScenario = {
  definition: ScenarioDefinition;
  filePath: string;
  fileHash: string;
};

export function listScenarioFiles(root = SCENARIOS_ROOT): string[] {
  if (!safeExists(root)) {
    return [];
  }

  const results: string[] = [];

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
        results.push(fullPath);
      }
    }
  }

  walk(root);
  return results.sort();
}

export function listScenarios(): ScenarioSummary[] {
  return listScenarioFiles().map((filePath) => {
    const { definition } = loadScenarioByPath(filePath, getKnownToolNames());
    return {
      id: definition.id,
      name: definition.name,
      suite: definition.suite,
      difficulty: definition.difficulty,
      description: definition.description,
    };
  });
}

export function loadScenarioById(scenarioId: string): LoadedScenario {
  for (const filePath of listScenarioFiles()) {
    const loaded = loadScenarioByPath(filePath, getKnownToolNames());
    if (loaded.definition.id === scenarioId) {
      return loaded;
    }
  }

  throw new Error(`Scenario '${scenarioId}' not found.`);
}

export function loadScenariosBySuite(suite: string): LoadedScenario[] {
  return listScenarioFiles()
    .map((filePath) => loadScenarioByPath(filePath, getKnownToolNames()))
    .filter(({ definition }) => definition.suite === suite);
}

export function loadScenarioByPath(filePath: string, knownToolNames = getKnownToolNames()): LoadedScenario {
  const absolutePath = resolve(filePath);
  const raw = readFileSync(absolutePath, "utf8");
  const parsed = parse(raw) as unknown;
  validateScenario(parsed, absolutePath, knownToolNames);

  return {
    definition: parsed,
    filePath: relative(process.cwd(), absolutePath),
    fileHash: createHash("sha256").update(raw).digest("hex"),
  };
}

function validateScenario(value: unknown, filePath: string, knownToolNames: Set<string>): asserts value is ScenarioDefinition {
  if (!isObject(value)) {
    throw new Error(`Scenario file '${filePath}' must contain a YAML object.`);
  }

  const requiredStrings = [
    ["id", value.id],
    ["name", value.name],
    ["suite", value.suite],
  ] as const;

  for (const [field, candidate] of requiredStrings) {
    if (typeof candidate !== "string" || candidate.length === 0) {
      throw new Error(`Scenario file '${filePath}' is missing required string field '${field}'.`);
    }
  }

  if (!isObject(value.task) || typeof value.task.instructions !== "string" || value.task.instructions.length === 0) {
    throw new Error(`Scenario file '${filePath}' must define task.instructions.`);
  }

  if (!isObject(value.tools) || !Array.isArray(value.tools.allowed) || value.tools.allowed.length === 0) {
    throw new Error(`Scenario file '${filePath}' must define at least one allowed tool.`);
  }
  for (const toolName of value.tools.allowed) {
    if (typeof toolName !== "string") {
      throw new Error(`Scenario file '${filePath}' contains a non-string tool name in tools.allowed.`);
    }
    if (!knownToolNames.has(toolName)) {
      throw new Error(`Scenario file '${filePath}' references unknown allowed tool '${toolName}'.`);
    }
  }
  if (Array.isArray(value.tools.forbidden)) {
    for (const toolName of value.tools.forbidden) {
      if (typeof toolName !== "string") {
        throw new Error(`Scenario file '${filePath}' contains a non-string tool name in tools.forbidden.`);
      }
    }
  }

  if (!Array.isArray(value.evaluators) || value.evaluators.length === 0) {
    throw new Error(`Scenario file '${filePath}' must define at least one evaluator.`);
  }

  const evaluatorIds = new Set<string>();
  for (const evaluator of value.evaluators) {
    if (!isObject(evaluator) || typeof evaluator.id !== "string" || typeof evaluator.type !== "string") {
      throw new Error(`Scenario file '${filePath}' has an invalid evaluator entry.`);
    }

    if (evaluatorIds.has(evaluator.id)) {
      throw new Error(`Scenario file '${filePath}' defines duplicate evaluator id '${evaluator.id}'.`);
    }
    evaluatorIds.add(evaluator.id);
  }

  if (isObject(value.runtime)) {
    validatePositiveInt(value.runtime.max_steps, "runtime.max_steps", filePath);
    validatePositiveInt(value.runtime.timeout_seconds, "runtime.timeout_seconds", filePath);
  }

  if (isObject(value.context) && Array.isArray(value.context.fixtures)) {
    for (const fixturePath of value.context.fixtures) {
      if (typeof fixturePath !== "string") {
        throw new Error(`Scenario file '${filePath}' contains a non-string fixture path.`);
      }

      const resolvedPath = resolve(fixturePath);
      if (!safeExists(resolvedPath) || !statSync(resolvedPath).isFile()) {
        throw new Error(`Scenario file '${filePath}' references missing fixture '${fixturePath}'.`);
      }
    }
  }
}

function validatePositiveInt(value: unknown, field: string, filePath: string): void {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Scenario file '${filePath}' field '${field}' must be a positive integer.`);
  }
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function getKnownToolNames(): Set<string> {
  const names = new Set(getBuiltinToolSpecs().map((tool) => tool.name));
  for (const tool of loadAgentLabConfig().tools ?? []) {
    names.add(tool.name);
  }
  return names;
}
