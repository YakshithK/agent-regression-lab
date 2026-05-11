import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { parse } from "yaml";

import { getRuntimeProfile, getSuiteDefinition, loadAgentLabConfig } from "./config.js";
import { isSupportedNormalizeRule, SUPPORTED_NORMALIZE_RULES } from "./normalize.js";
import { getBuiltinToolSpecs } from "./tools.js";
import type { ConversationScenarioDefinition, ScenarioDefinition, ScenarioSummary } from "./types.js";

const SCENARIOS_ROOT = resolve("scenarios");
const VALID_TASK_EVALUATOR_TYPES = new Set([
  "exact_final_answer",
  "final_answer_contains",
  "forbidden_tool",
  "tool_call_assertion",
  "step_count_max",
  "tool_call_count_max",
  "tool_repeat_max",
  "cost_max",
]);
const VALID_EVALUATOR_MODES = new Set(["hard_gate", "weighted"]);

type LoadedScenario = {
  definition: ScenarioDefinition;
  filePath: string;
  fileHash: string;
};

type LoadedScenarioRecord = LoadedScenario | LoadedConversationScenario;

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
  return listScenarioFiles().flatMap((filePath) => {
    try {
      const scenarioType = getScenarioType(filePath);
      if (scenarioType === "conversation") {
        const { definition } = loadConversationScenarioByPath(filePath);
        return [{
          id: definition.id,
          name: definition.name,
          suite: definition.suite,
          difficulty: definition.difficulty,
          description: definition.description,
        }];
      }
      const { definition } = loadScenarioByPath(filePath, getKnownToolNames());
      return [{
        id: definition.id,
        name: definition.name,
        suite: definition.suite,
        difficulty: definition.difficulty,
        description: definition.description,
      }];
    } catch {
      return [];
    }
  });
}

export function loadScenarioById(scenarioId: string): LoadedScenario {
  for (const filePath of listScenarioFiles()) {
    if (getScenarioType(filePath) !== "task") continue;
    const loaded = loadScenarioByPath(filePath, getKnownToolNames());
    if (loaded.definition.id === scenarioId) {
      return loaded;
    }
  }

  throw new Error(`Scenario '${scenarioId}' not found.`);
}

export function loadScenariosBySuite(suite: string): LoadedScenario[] {
  return listScenarioFiles()
    .filter((filePath) => getScenarioType(filePath) === "task")
    .map((filePath) => loadScenarioByPath(filePath, getKnownToolNames()))
    .filter(({ definition }) => definition.suite === suite);
}

export function loadScenariosBySuiteDefinition(name: string): LoadedScenarioRecord[] {
  const suiteDefinition = getSuiteDefinition(name);
  const knownToolNames = getKnownToolNames();
  const scenarioFiles = listScenarioFiles(resolve("scenarios"));
  const loadedScenarios = scenarioFiles.map((filePath) => loadScenarioRecordByPath(filePath, knownToolNames));

  const included = loadedScenarios
    .filter(({ definition }) => matchesSuiteDefinitionInclude(definition, suiteDefinition));

  const excludedIds = new Set(
    loadedScenarios
      .filter(({ definition }) => matchesSuiteDefinitionExclude(definition, suiteDefinition))
      .map(({ definition }) => definition.id),
  );

  return included
    .filter(({ definition }) => !excludedIds.has(definition.id))
    .sort((left, right) => left.definition.id.localeCompare(right.definition.id));
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
  if (value.tools.forbidden !== undefined) {
    if (!Array.isArray(value.tools.forbidden)) {
      throw new Error(`Scenario file '${filePath}' field 'tools.forbidden' must be an array of strings.`);
    }
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
    if (!VALID_TASK_EVALUATOR_TYPES.has(evaluator.type)) {
      throw new Error(
        `Scenario file '${filePath}' evaluator '${evaluator.id}' has invalid type '${evaluator.type}'. ` +
          `Valid types: ${[...VALID_TASK_EVALUATOR_TYPES].join(", ")}.`,
      );
    }
    if (!VALID_EVALUATOR_MODES.has(evaluator.mode)) {
      throw new Error(
        `Scenario file '${filePath}' evaluator '${evaluator.id}' has invalid mode '${String(evaluator.mode)}'. ` +
          `Valid modes: hard_gate, weighted.`,
      );
    }
    if (!isObject(evaluator.config)) {
      throw new Error(`Scenario file '${filePath}' evaluator '${evaluator.id}' must define an object config.`);
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

  if (value.runtime_profile !== undefined) {
    if (typeof value.runtime_profile !== "string" || value.runtime_profile.length === 0) {
      throw new Error(`Scenario file '${filePath}' field 'runtime_profile' must be a non-empty string.`);
    }
    getRuntimeProfile(value.runtime_profile);
  }

  if (value.setup_script !== undefined && (typeof value.setup_script !== "string" || value.setup_script.length === 0)) {
    throw new Error(`Scenario file '${filePath}' field 'setup_script' must be a non-empty string.`);
  }

  if (value.normalize !== undefined) {
    if (!Array.isArray(value.normalize)) {
      throw new Error(`Scenario file '${filePath}' field 'normalize' must be an array of strings.`);
    }
    for (const rule of value.normalize) {
      if (typeof rule !== "string") {
        throw new Error(`Scenario file '${filePath}' field 'normalize' must be an array of strings.`);
      }
      if (!isSupportedNormalizeRule(rule)) {
        throw new Error(
          `Scenario file '${filePath}' has unknown normalize rule '${rule}'. ` +
            `Supported rules: ${SUPPORTED_NORMALIZE_RULES.join(", ")}.`,
        );
      }
    }
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

// --- Conversation scenario support ---

type LoadedConversationScenario = {
  definition: ConversationScenarioDefinition;
  filePath: string;
  fileHash: string;
};

export function getScenarioType(filePath: string): "task" | "conversation" {
  const absolutePath = resolve(filePath);
  const raw = readFileSync(absolutePath, "utf8");
  const parsed = parse(raw) as unknown;
  if (isObject(parsed) && parsed.type === "conversation") {
    return "conversation";
  }
  return "task";
}

export function loadConversationScenarioByPath(filePath: string): LoadedConversationScenario {
  const absolutePath = resolve(filePath);
  const raw = readFileSync(absolutePath, "utf8");
  const parsed = parse(raw) as unknown;
  validateConversationScenario(parsed, absolutePath);
  return {
    definition: parsed as ConversationScenarioDefinition,
    filePath: relative(process.cwd(), absolutePath),
    fileHash: createHash("sha256").update(raw).digest("hex"),
  };
}

export function loadConversationScenarioById(scenarioId: string): LoadedConversationScenario {
  for (const filePath of listScenarioFiles()) {
    const absolutePath = resolve(filePath);
    const raw = readFileSync(absolutePath, "utf8");
    const parsed = parse(raw) as Record<string, unknown>;
    if (parsed.type === "conversation" && parsed.id === scenarioId) {
      return loadConversationScenarioByPath(filePath);
    }
  }
  throw new Error(`Conversation scenario '${scenarioId}' not found.`);
}

const VALID_CONVERSATION_EVALUATOR_TYPES = new Set([
  "response_contains",
  "response_not_contains",
  "response_matches_regex",
  "response_latency_max",
  "step_count_max",
  "exact_final_answer",
  "final_answer_contains",
]);

function validateConversationEvaluatorList(evaluators: unknown, context: string, filePath: string): void {
  if (!Array.isArray(evaluators)) {
    throw new Error(`Conversation scenario '${filePath}' ${context} evaluators must be an array.`);
  }
  for (let i = 0; i < evaluators.length; i += 1) {
    const ev = evaluators[i];
    if (!isObject(ev)) {
      throw new Error(`Conversation scenario '${filePath}' ${context} evaluator ${i} must be an object.`);
    }
    if (typeof ev.type !== "string" || !VALID_CONVERSATION_EVALUATOR_TYPES.has(ev.type)) {
      throw new Error(
        `Conversation scenario '${filePath}' ${context} evaluator ${i} has invalid type '${String(ev.type)}'. ` +
          `Valid types: ${[...VALID_CONVERSATION_EVALUATOR_TYPES].join(", ")}.`,
      );
    }
    if (ev.mode !== "hard_gate" && ev.mode !== "weighted") {
      throw new Error(`Conversation scenario '${filePath}' ${context} evaluator ${i} must have mode: hard_gate or weighted.`);
    }

    if (ev.type === "response_contains" || ev.type === "response_not_contains") {
      if (!isObject(ev.config)) {
        throw new Error(`Conversation scenario '${filePath}' ${context} evaluator ${i} must define an object config.`);
      }
      if ("text" in ev.config) {
        throw new Error(
          `Conversation scenario '${filePath}' ${context} evaluator ${i} uses stale 'config.text'; use 'config.keywords: string[]'.`,
        );
      }
      if (!Array.isArray(ev.config.keywords) || ev.config.keywords.some((kw: unknown) => typeof kw !== "string")) {
        throw new Error(
          `Conversation scenario '${filePath}' ${context} evaluator ${i} must define config.keywords as a string array.`,
        );
      }
    }
  }
}

function validateConversationScenario(
  value: unknown,
  filePath: string,
): asserts value is ConversationScenarioDefinition {
  if (!isObject(value)) {
    throw new Error(`Scenario file '${filePath}' must contain a YAML object.`);
  }

  for (const field of ["id", "name", "suite"] as const) {
    if (typeof value[field] !== "string" || (value[field] as string).length === 0) {
      throw new Error(`Conversation scenario '${filePath}' is missing required string field '${field}'.`);
    }
  }

  if (value.type !== "conversation") {
    throw new Error(`Scenario file '${filePath}' does not have type: conversation.`);
  }

  if (value.runtime_profile !== undefined) {
    if (typeof value.runtime_profile !== "string" || value.runtime_profile.length === 0) {
      throw new Error(`Conversation scenario '${filePath}' field 'runtime_profile' must be a non-empty string.`);
    }
    getRuntimeProfile(value.runtime_profile);
  }

  if ("tools" in value) {
    throw new Error(
      `Conversation scenario '${filePath}' must not define 'tools'. HTTP agents manage their own tools internally.`,
    );
  }

  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw new Error(`Conversation scenario '${filePath}' must define at least one step.`);
  }

  for (let i = 0; i < value.steps.length; i += 1) {
    const step = value.steps[i];
    if (!isObject(step)) {
      throw new Error(`Conversation scenario '${filePath}' step ${i} must be an object.`);
    }
    if (step.role !== "user") {
      throw new Error(`Conversation scenario '${filePath}' step ${i} must have role: user.`);
    }
    if (typeof step.message !== "string" || step.message.length === 0) {
      throw new Error(`Conversation scenario '${filePath}' step ${i} must have a non-empty message.`);
    }
    if (step.evaluators !== undefined) {
      validateConversationEvaluatorList(step.evaluators, `step ${i}`, filePath);
    }
  }

  if (value.evaluators !== undefined) {
    validateConversationEvaluatorList(value.evaluators, "end-of-run evaluators", filePath);
  }
}

function loadScenarioRecordByPath(filePath: string, knownToolNames = getKnownToolNames()): LoadedScenarioRecord {
  if (getScenarioType(filePath) === "conversation") {
    return loadConversationScenarioByPath(filePath);
  }
  return loadScenarioByPath(filePath, knownToolNames);
}

function matchesSuiteDefinitionInclude(
  definition: { id: string; suite: string; tags?: string[] },
  suiteDefinition: { include: { scenarios?: string[]; tags?: string[]; suites?: string[] } },
): boolean {
  return matchesSuiteDefinitionSelectors(definition, suiteDefinition.include);
}

function matchesSuiteDefinitionExclude(
  definition: { id: string; suite: string; tags?: string[] },
  suiteDefinition: { exclude?: { scenarios?: string[]; tags?: string[]; suites?: string[] } },
): boolean {
  return suiteDefinition.exclude !== undefined && matchesSuiteDefinitionSelectors(definition, suiteDefinition.exclude);
}

function matchesSuiteDefinitionSelectors(
  definition: { id: string; suite: string; tags?: string[] },
  selectors: { scenarios?: string[]; tags?: string[]; suites?: string[] },
): boolean {
  if (selectors.scenarios?.includes(definition.id)) {
    return true;
  }

  if (selectors.tags?.some((tag) => definition.tags?.includes(tag) ?? false)) {
    return true;
  }

  if (selectors.suites?.includes(definition.suite)) {
    return true;
  }

  return false;
}
