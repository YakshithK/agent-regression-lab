#!/usr/bin/env node
import packageJson from "../package.json" with { type: "json" };
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import { createAgentFactory } from "./agent/factory.js";
import { getAgentRegistration, getVariantSet } from "./config.js";
import { createConfigHash, createSuiteBatchId } from "./lib/id.js";
import { formatCliErrorMessage, formatRunIdentityLines, getFailedEvaluatorSummaries, getRunErrorDetail } from "./runOutput.js";
import { initProject } from "./init.js";
import type { AgentRuntimeConfig, RunBundle, VariantDefinition } from "./types.js";

const colorEnabled = (): boolean => Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const color = (code: number) => (text: string): string => (colorEnabled() ? `\x1b[${code}m${text}\x1b[0m` : text);
const green = color(32);
const red = color(31);
const yellow = color(33);
const dim = color(2);

function suppressNodeSqliteExperimentalWarning(): void {
  const originalEmitWarning = process.emitWarning.bind(process) as (warning: string | Error, ...args: unknown[]) => void;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]): void => {
    const typeOrOptions = args[0];
    const warningType =
      warning instanceof Error
        ? warning.name
        : typeof typeOrOptions === "string"
          ? typeOrOptions
          : typeof typeOrOptions === "object" && typeOrOptions !== null && "type" in typeOrOptions
            ? typeOrOptions.type
            : undefined;
    const warningMessage = warning instanceof Error ? warning.message : warning;
    if (warningType === "ExperimentalWarning" && warningMessage.includes("SQLite is an experimental feature")) {
      return;
    }

    return originalEmitWarning(warning, ...args);
  }) as typeof process.emitWarning;
}

export async function main(): Promise<void> {
  suppressNodeSqliteExperimentalWarning();
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      printUsage();
      break;
    case "version":
    case "--version":
    case "-v":
      printVersion();
      break;
    case "list":
      await handleList(args);
      break;
    case "run":
      await handleRun(args);
      break;
    case "show":
      await handleShow(args);
      break;
    case "compare":
      await handleCompare(args);
      break;
    case "approve":
      await handleApprove(args);
      break;
    case "ui":
      await handleUi();
      break;
    case "init":
      await handleInit(args);
      break;
    default:
      printUsage();
  }
}

function printUsage(): void {
  console.log(`Usage:
  agentlab init <project-name>
  agentlab list scenarios
  agentlab run <scenario-id> [--agent <name>] [--provider mock|openai|external_process|http] [--model <model>] [--agent-label <label>]
  agentlab run --suite <suite-id> [--agent <name>] [--provider mock|openai|external_process|http] [--model <model>] [--agent-label <label>]
  agentlab run --suite-def <name> [--agent <name>]
  agentlab run <scenario-id> [--variant-set <name>]
  agentlab run --demo
  agentlab show <run-id>
  agentlab approve <run-id>
  agentlab compare <baseline-run-id> <candidate-run-id>
  agentlab compare --baseline <scenario-id> <candidate-run-id>
  agentlab compare --suite <baseline-batch-id> <candidate-batch-id>
  agentlab ui
  agentlab help
  agentlab version`);
}

function printVersion(): void {
  console.log(packageJson.version);
}

async function handleList(args: string[]): Promise<void> {
  if (args[0] !== "scenarios") {
    printUsage();
    return;
  }

  const { listScenarios } = await import("./scenarios.js");
  for (const scenario of listScenarios()) {
    console.log(`${scenario.id}\t${scenario.suite}\t${scenario.difficulty ?? "-"}\t${scenario.description ?? ""}`);
  }
}

async function handleInit(args: string[]): Promise<void> {
  const projectName = args[0];
  if (!projectName) {
    console.error("Error: project-name is required.");
    console.error("Usage: agentlab init <project-name>");
    process.exit(1);
  }
  await initProject(projectName);
}

async function handleRun(args: string[]): Promise<void> {
  const parsed = parseRunArgs(args);
  if (parsed.demo) {
    await executeDemo();
    return;
  }

  const runtimeConfig = validateRuntimeConfig(parsed.runtimeConfig);
  const { loadScenariosBySuite, loadScenariosBySuiteDefinition } = await import("./scenarios.js");

  if (parsed.suite && parsed.suiteDefinition) {
    throw new Error("--suite and --suite-def cannot be used together.");
  }
  if (parsed.runtimeConfig.agentName && parsed.variantSetName) {
    throw new Error("--agent and --variant-set cannot be used together.");
  }

  if (parsed.suite) {
    const suite = parsed.suite;
    const scenarios = loadScenariosBySuite(suite);
    if (scenarios.length === 0) {
      throw new Error(`No scenarios found for suite '${suite}'.`);
    }

    const suiteBatchId = createSuiteBatchId();
    const runs: RunBundle[] = [];
    if (parsed.variantSetName) {
      console.log(`Variant set: ${parsed.variantSetName}`);
      for (const scenario of scenarios) {
        runs.push(...await executeVariantSetScenario(scenario.definition.id, parsed.variantSetName, suiteBatchId));
      }
    } else {
      for (const scenario of scenarios) {
        runs.push(await executeOne(scenario.definition.id, runtimeConfig, suiteBatchId));
      }
    }

    printSuiteSummary(suite, runs, suiteBatchId);
    return;
  }

  if (parsed.suiteDefinition) {
    const suiteDefinition = parsed.suiteDefinition;
    const scenarios = loadScenariosBySuiteDefinition(suiteDefinition);
    if (scenarios.length === 0) {
      throw new Error(`No scenarios found for suite definition '${suiteDefinition}'.`);
    }

    const suiteBatchId = createSuiteBatchId();
    const runs: RunBundle[] = [];
    console.log(`Suite definition: ${suiteDefinition}`);
    if (parsed.variantSetName) {
      console.log(`Variant set: ${parsed.variantSetName}`);
      for (const scenario of scenarios) {
        runs.push(...await executeVariantSetScenario(scenario.definition.id, parsed.variantSetName, suiteBatchId, suiteDefinition));
      }
    } else {
      const suiteRuntimeConfig = { ...runtimeConfig, suiteDefinitionName: suiteDefinition };
      for (const scenario of scenarios) {
        runs.push(await executeOne(scenario.definition.id, suiteRuntimeConfig, suiteBatchId));
      }
    }

    printSuiteSummary(suiteDefinition, runs, suiteBatchId);
    return;
  }

  const scenarioId = parsed.scenarioId;
  if (!scenarioId) {
    throw new Error("Missing scenario id.");
  }

  if (parsed.variantSetName) {
    console.log(`Variant set: ${parsed.variantSetName}`);
    await executeVariantSetScenario(scenarioId, parsed.variantSetName);
    return;
  }

  // Detect scenario type to route to the right runner
  const { listScenarioFiles } = await import("./scenarios.js");
  const { parse } = await import("yaml");
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");

  let scenarioType: "task" | "conversation" = "task";
  for (const filePath of listScenarioFiles()) {
    const raw = readFileSync(resolve(filePath), "utf8");
    const parsedYaml = parse(raw) as Record<string, unknown>;
    if (parsedYaml.id === scenarioId) {
      scenarioType = parsedYaml.type === "conversation" ? "conversation" : "task";
      break;
    }
  }

  if (scenarioType === "task" && runtimeConfig.provider === "http") {
    throw new Error(
      `Scenario '${scenarioId}' is a task scenario. HTTP agents (provider: http) only work with ` +
      `type: conversation scenarios.\n` +
      `To test an HTTP agent, create a conversation scenario (type: conversation) — ` +
      `conversation scenarios do not use a tools: block. See docs/scenarios.md for the format.`,
    );
  }

  if (scenarioType === "conversation") {
    if (runtimeConfig.provider !== "http") {
      throw new Error(
        `Scenario '${scenarioId}' is a conversation scenario and requires provider: http. Use --agent <name> with a configured HTTP agent.`,
      );
    }
    const httpConfig: import("./types.js").HttpAgentRegistration = {
      name: runtimeConfig.agentName ?? "http-agent",
      provider: "http",
      url: runtimeConfig.url!,
      request_template: runtimeConfig.request_template,
      response_field: runtimeConfig.response_field,
      headers: runtimeConfig.headers,
      timeout_ms: runtimeConfig.timeout_ms,
    };
    await executeConversation(scenarioId, httpConfig, runtimeConfig.label);
  } else {
    await executeOne(scenarioId, runtimeConfig);
  }
}

async function executeDemo(): Promise<RunBundle> {
  const [{ Storage }, { runScenario }, { DEMO_SCENARIO, DEMO_REGRESSION_SCENARIO, DEMO_TOOL_SPECS, DEMO_TOOLS }] = await Promise.all([
    import("./storage.js"),
    import("./runner.js"),
    import("./demo.js"),
  ]);
  const storage = new Storage();
  try {
    storage.upsertScenario(
      {
        id: DEMO_SCENARIO.id,
        name: DEMO_SCENARIO.name,
        suite: DEMO_SCENARIO.suite,
        difficulty: DEMO_SCENARIO.difficulty,
        description: DEMO_SCENARIO.description,
      },
      DEMO_SCENARIO,
      "<demo>",
      "demo",
    );

    const runtimeConfig: AgentRuntimeConfig = { provider: "mock", label: "mock-demo" };
    const factory = createAgentFactory(runtimeConfig);
    const agentVersion = factory.createVersion(runtimeConfig);
    storage.upsertAgentVersion(agentVersion);

    printDemoIntro();
    console.log("Phase 1: establish a baseline");
    const baseline = await withSpinner("Running demo scenario (pass)...", () =>
      runScenario({
        agentAdapter: factory.createAdapter(),
        agentVersion,
        scenario: DEMO_SCENARIO,
        scenarioFileHash: "demo",
        toolSpecs: DEMO_TOOL_SPECS,
        tools: DEMO_TOOLS,
      }),
    );
    baseline.agentVersion = agentVersion;
    storage.saveRun(baseline);
    storage.approveRun(baseline.run.id);
    printDemoRunReplay(baseline);
    printDemoVerdict(baseline);
    console.log("Approved as baseline.");
    console.log("");

    console.log("Simulating a prompt change...");
    const candidate = await withSpinner("Running demo scenario (degraded mode)...", () =>
      runScenario({
        agentAdapter: factory.createAdapter(),
        agentVersion,
        scenario: DEMO_REGRESSION_SCENARIO,
        scenarioFileHash: "demo",
        toolSpecs: DEMO_TOOL_SPECS,
        tools: DEMO_TOOLS,
      }),
    );
    candidate.agentVersion = agentVersion;
    storage.saveRun(candidate);
    printDemoRunReplay(candidate);
    printDemoVerdict(candidate, { regression: true });
    printDemoComparison(storage.compareRuns(baseline.run.id, candidate.run.id));
    printDemoCta();
    return candidate;
  } finally {
    storage.close();
  }
}

function printDemoIntro(): void {
  console.log("Scenario: demo.snapshot-companion");
  console.log('Task: "Use the bundled demo notes to answer today\'s date."');
  console.log("");
}

function printDemoRunReplay(bundle: RunBundle): void {
  console.log(line());
  console.log("Trace");
  const toolCalls = [...bundle.toolCalls].sort((left, right) => left.stepIndex - right.stepIndex);
  toolCalls.forEach((call, index) => {
    console.log(`  Step ${index + 1}  ${call.toolName}(${formatInlineObject(call.input)})`);
    console.log(`          -> ${formatInlineObject(call.output)}`);
  });
  console.log(`  Answer  "${bundle.run.finalOutput}"`);
  console.log(line());
}

function printDemoVerdict(bundle: RunBundle, options: { regression?: boolean } = {}): void {
  const status = bundle.run.status === "pass" ? green("PASS") : red("FAIL");
  if (options.regression && bundle.run.status !== "pass") {
    console.log(`${status}  Score: ${bundle.run.score}/100 -- regression detected  (${bundle.run.totalToolCalls} tool calls, ${bundle.run.durationMs}ms)`);
    return;
  }
  console.log(`${status}  Score: ${bundle.run.score}/100  (${bundle.run.totalToolCalls} tool calls, ${bundle.run.durationMs}ms)`);
  if (bundle.run.status === "pass") {
    console.log("The agent found the answer using 2 tool calls -- within budget.");
  }
}

function printDemoComparison(comparison: import("./types.js").RunComparison): void {
  console.log("");
  console.log("What changed:");
  const evaluatorIds = new Set([
    ...comparison.baseline.evaluatorResults.map((result) => result.evaluatorId),
    ...comparison.candidate.evaluatorResults.map((result) => result.evaluatorId),
  ]);
  for (const evaluatorId of [...evaluatorIds].sort()) {
    const baseline = comparison.baseline.evaluatorResults.find((result) => result.evaluatorId === evaluatorId);
    const candidate = comparison.candidate.evaluatorResults.find((result) => result.evaluatorId === evaluatorId);
    if (baseline?.status === candidate?.status) {
      console.log(`  ${green("OK")}  ${evaluatorId}   unchanged`);
    } else {
      console.log(`  ${red("FAIL")}  ${evaluatorId}   was: ${baseline?.status.toUpperCase() ?? "MISSING"}   now: ${candidate?.status.toUpperCase() ?? "MISSING"}`);
    }
  }
  console.log("");
  console.log("This is what agent regression testing catches.");
}

function printDemoCta(): void {
  console.log(line());
  console.log("Ready to test your own agent?");
  console.log("  agentlab init        bootstrap a new project");
  console.log("  agentlab run --help  see all options");
}

function line(): string {
  return dim("--------------------------------------------------");
}

function formatInlineObject(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(value);
}

async function withSpinner<T>(message: string, fn: () => Promise<T>): Promise<T> {
  if (!process.stdout.isTTY) {
    return await fn();
  }

  const frames = ["-", "\\", "|", "/"];
  let index = 0;
  process.stdout.write(`  ${frames[index]}  ${message}`);
  const interval = setInterval(() => {
    index = (index + 1) % frames.length;
    process.stdout.write(`\r  ${frames[index]}  ${message}`);
  }, 80);

  try {
    return await fn();
  } finally {
    clearInterval(interval);
    process.stdout.write(`\r${" ".repeat(message.length + 6)}\r`);
  }
}

async function executeOne(scenarioId: string, runtimeConfig: AgentRuntimeConfig, suiteBatchId?: string): Promise<RunBundle> {
  const [{ Storage }, { loadToolRegistry, loadToolSpecs }, { loadScenarioById }, { runScenario }] = await Promise.all([
    import("./storage.js"),
    import("./tools.js"),
    import("./scenarios.js"),
    import("./runner.js"),
  ]);
  const storage = new Storage();
  try {
    const toolSpecs = await loadToolSpecs();
    const toolRegistry = await loadToolRegistry();
    const loaded = loadScenarioById(scenarioId);
    storage.upsertScenario(
      {
        id: loaded.definition.id,
        name: loaded.definition.name,
        suite: loaded.definition.suite,
        difficulty: loaded.definition.difficulty,
        description: loaded.definition.description,
      },
      loaded.definition,
      loaded.filePath,
      loaded.fileHash,
    );

    const factory = createAgentFactory(runtimeConfig);
    const agentVersion = factory.createVersion(runtimeConfig);
    storage.upsertAgentVersion(agentVersion);

    const bundle = await runScenario({
      agentAdapter: factory.createAdapter(),
      agentVersion,
      scenario: loaded.definition,
      scenarioFileHash: loaded.fileHash,
      toolSpecs,
      tools: toolRegistry,
    });

    bundle.run.suiteBatchId = suiteBatchId;
    bundle.run.variantSetName = agentVersion.variantSetName;
    bundle.run.variantLabel = agentVersion.variantLabel;
    bundle.run.promptVersion = agentVersion.promptVersion;
    bundle.run.modelVersion = agentVersion.modelVersion;
    bundle.run.toolSchemaVersion = agentVersion.toolSchemaVersion;
    bundle.run.configLabel = agentVersion.configLabel;
    bundle.run.configHash = agentVersion.configHash;
    bundle.run.runtimeProfileName = loaded.definition.runtime_profile;
    bundle.run.suiteDefinitionName = runtimeConfig.suiteDefinitionName;
    bundle.agentVersion = agentVersion;
    storage.saveRun(bundle);
    printRunSummary(bundle);
    return bundle;
  } finally {
    storage.close();
  }
}

export async function executeVariantSetScenario(
  scenarioId: string,
  variantSetName: string,
  suiteBatchId?: string,
  suiteDefinitionName?: string,
): Promise<RunBundle[]> {
  const variantSet = getVariantSet(variantSetName);
  const runs: RunBundle[] = [];

  for (const variant of variantSet.variants) {
    const registration = getAgentRegistration(variant.agent);
    const runtimeConfig = buildVariantRuntimeConfig(registration, variantSet.name, variant, suiteDefinitionName);
    runs.push(await executeOne(scenarioId, runtimeConfig, suiteBatchId));
  }

  return runs;
}

function buildVariantRuntimeConfig(
  registration: ReturnType<typeof getAgentRegistration>,
  variantSetName: string,
  variant: VariantDefinition,
  suiteDefinitionName?: string,
): AgentRuntimeConfig {
  const runtimeConfig: AgentRuntimeConfig = {
    ...registration,
    agentName: registration.name,
    label: registration.label ?? variant.label,
    variantSetName,
    variantLabel: variant.label,
    promptVersion: variant.prompt_version,
    modelVersion: variant.model_version,
    toolSchemaVersion: variant.tool_schema_version,
    configLabel: variant.config_label,
    suiteDefinitionName,
  };
  runtimeConfig.configHash = createConfigHash({
    provider: runtimeConfig.provider,
    agentName: runtimeConfig.agentName,
    label: runtimeConfig.label,
    model: runtimeConfig.model,
    command: runtimeConfig.command,
    args: runtimeConfig.args ?? [],
    variantSetName,
    variantLabel: variant.label,
    promptVersion: variant.prompt_version,
    modelVersion: variant.model_version,
    toolSchemaVersion: variant.tool_schema_version,
    configLabel: variant.config_label,
  });
  return runtimeConfig;
}

export async function executeConversation(
  scenarioId: string,
  httpConfig: import("./types.js").HttpAgentRegistration,
  label?: string,
  suiteBatchId?: string,
): Promise<RunBundle> {
  const [{ Storage }, { loadConversationScenarioById }, { runConversation }, { createAgentVersionId }] =
    await Promise.all([
      import("./storage.js"),
      import("./scenarios.js"),
      import("./conversationRunner.js"),
      import("./lib/id.js"),
    ]);

  const storage = new Storage();
  try {
    const loaded = loadConversationScenarioById(scenarioId);

    storage.upsertScenario(
      {
        id: loaded.definition.id,
        name: loaded.definition.name,
        suite: loaded.definition.suite,
        difficulty: loaded.definition.difficulty,
        description: loaded.definition.description,
      },
      loaded.definition,
      loaded.filePath,
      loaded.fileHash,
    );

    const agentLabel = label ?? httpConfig.label ?? httpConfig.name;
    const agentConfig = { provider: "http", url: httpConfig.url, agentName: httpConfig.name };
    const agentVersion: import("./types.js").AgentVersion = {
      id: createAgentVersionId(agentLabel, agentConfig),
      label: agentLabel,
      provider: "http",
      config: agentConfig,
    };
    storage.upsertAgentVersion(agentVersion);

    const bundle = await runConversation({
      httpConfig,
      agentVersion,
      scenario: loaded.definition,
      scenarioFileHash: loaded.fileHash,
    });

    bundle.run.suiteBatchId = suiteBatchId;
    bundle.agentVersion = agentVersion;
    storage.saveRun(bundle);
    printConversationSummary(bundle, httpConfig.url, loaded.definition.steps.length);
    return bundle;
  } finally {
    storage.close();
  }
}

function printSuiteSummary(suite: string, runs: RunBundle[], suiteBatchId: string): void {
  const passed = runs.filter((bundle) => bundle.run.status === "pass").length;
  const failed = runs.filter((bundle) => bundle.run.status === "fail").length;
  const errored = runs.filter((bundle) => bundle.run.status === "error").length;
  const avgScore = Math.round(runs.reduce((sum, bundle) => sum + bundle.run.score, 0) / runs.length);
  console.log(`Suite: ${suite}`);
  console.log(`Passed: ${passed}/${runs.length}`);
  console.log(`Failed: ${failed}/${runs.length}`);
  console.log(`Errored: ${errored}/${runs.length}`);
  console.log(`Average score: ${avgScore}`);
  console.log(`Suite batch: ${suiteBatchId}`);
}

function printConversationSummary(bundle: RunBundle, agentUrl: string, totalSteps: number): void {
  const statusLabel = bundle.run.status.toUpperCase();
  console.log(`run ${bundle.run.scenarioId} — ${statusLabel}`);
  console.log(`  agent: ${bundle.agentVersion?.label ?? bundle.run.agentVersionId} (${agentUrl})`);
  console.log(`  turns completed: ${bundle.run.totalSteps}/${totalSteps}`);

  const stepEvals = bundle.evaluatorResults.filter((r) => r.evaluatorId.startsWith("step_"));
  const stepIndices = new Set(
    stepEvals.map((r) => {
      const match = r.evaluatorId.match(/^step_(\d+)_/);
      return match ? parseInt(match[1], 10) : -1;
    }),
  );

  for (const stepIndex of [...stepIndices].sort((a, b) => a - b)) {
    const resultsForStep = stepEvals.filter((r) => r.evaluatorId.startsWith(`step_${stepIndex}_`));
    const allPass = resultsForStep.every((r) => r.status === "pass");
    const stepStatus = allPass ? "pass" : "FAIL";
    const details = resultsForStep.map((r) => {
      if (r.evaluatorType === "response_latency_max") {
        const latencyMatch = r.message.match(/(\d+)ms/);
        return latencyMatch ? `latency ${latencyMatch[1]}ms ✓` : r.message;
      }
      return `${r.evaluatorType} ${r.status === "pass" ? "✓" : "✗"}`;
    });
    console.log(`  step ${stepIndex + 1}: ${stepStatus}${details.length > 0 ? ` (${details.join(", ")})` : ""}`);
  }

  if (bundle.run.status !== "pass") {
    console.log(`  run stopped (${bundle.run.terminationReason})`);
  }
  console.log(`  run id: ${bundle.run.id}`);
}

async function handleUi(): Promise<void> {
  const { startUiServer } = await import("./ui/server.js");
  await startUiServer();
}

function printRunSummary(bundle: RunBundle): void {
  console.log(`Run: ${bundle.run.id}`);
  console.log(`Scenario: ${bundle.run.scenarioId}`);
  console.log(`Status: ${bundle.run.status.toUpperCase()}`);
  console.log(`Score: ${bundle.run.score}/100`);
  console.log(`Agent: ${bundle.agentVersion?.label ?? bundle.run.agentVersionId}`);
  if (bundle.agentVersion?.provider) {
    console.log(`Provider: ${bundle.agentVersion.provider}`);
  }
  if (bundle.agentVersion?.modelId) {
    console.log(`Model: ${bundle.agentVersion.modelId}`);
  }
  if (bundle.agentVersion?.command) {
    console.log(`Command: ${bundle.agentVersion.command} ${(bundle.agentVersion.args ?? []).join(" ")}`.trim());
  }
  for (const line of formatRunIdentityLines(bundle)) {
    console.log(line);
  }
  console.log(`Runtime: ${bundle.run.durationMs}ms`);
  if (bundle.run.status === "pass") {
    console.log("No regressions yet -- approve this run to set a baseline.");
  }
  if (bundle.run.status !== "pass") {
    console.log(`Reason: ${bundle.run.terminationReason}`);
    const errorDetail = getRunErrorDetail(bundle);
    if (errorDetail) {
      console.log(`Error: ${errorDetail}`);
    }
    const failedEvaluators = getFailedEvaluatorSummaries(bundle);
    if (failedEvaluators.length > 0) {
      console.log("Failed evaluators:");
      for (const summary of failedEvaluators) {
        console.log(`- ${summary}`);
      }
    }
  }
}

async function handleShow(args: string[]): Promise<void> {
  const runId = args[0];
  if (!runId) {
    throw new Error("Missing run id.");
  }

  const { Storage } = await import("./storage.js");
  const storage = new Storage();
  try {
    const bundle = storage.getRun(runId);
    if (!bundle) {
      throw new Error(`Run '${runId}' not found.`);
    }

    console.log(`Run: ${bundle.run.id}`);
    console.log(`Scenario: ${bundle.run.scenarioId}`);
    console.log(`Status: ${bundle.run.status.toUpperCase()}`);
    console.log(`Score: ${bundle.run.score}/100`);
    if (bundle.agentVersion) {
      console.log(`Provider: ${bundle.agentVersion.provider ?? "unknown"}`);
      console.log(`Model: ${bundle.agentVersion.modelId ?? "unknown"}`);
      if (bundle.agentVersion.command) {
        console.log(`Command: ${bundle.agentVersion.command} ${(bundle.agentVersion.args ?? []).join(" ")}`.trim());
      }
    }
    console.log(`Termination: ${bundle.run.terminationReason}`);
    const errorDetail = getRunErrorDetail(bundle);
    if (errorDetail) {
      console.log(`Error: ${errorDetail}`);
    }
    console.log(`Final output: ${bundle.run.finalOutput}`);
    console.log("Evaluators:");
    for (const result of bundle.evaluatorResults) {
      console.log(`- ${result.evaluatorId}: ${result.status.toUpperCase()} - ${result.message}`);
    }
  } finally {
    storage.close();
  }
}

async function handleCompare(args: string[]): Promise<void> {
  const isSuiteCompare = args[0] === "--suite";
  const isBaselineCompare = args[0] === "--baseline";
  const { Storage } = await import("./storage.js");
  const storage = new Storage();
  try {
    if (isSuiteCompare) {
      const baselineBatchId = args[1];
      const candidateBatchId = args[2];
      if (!baselineBatchId || !candidateBatchId) {
        throw new Error("Missing baseline or candidate suite batch id.");
      }

      const comparison = storage.compareSuites(baselineBatchId, candidateBatchId);
      console.log(`Suite: ${comparison.suite}`);
      console.log(`Baseline batch: ${comparison.baselineBatchId}`);
      console.log(`Candidate batch: ${comparison.candidateBatchId}`);
      console.log(`Classification: ${comparison.classification.toUpperCase()}`);
      console.log(`Pass delta: ${signedMetric(comparison.deltas.pass)}`);
      console.log(`Fail delta: ${signedMetric(comparison.deltas.fail)}`);
      console.log(`Error delta: ${signedMetric(comparison.deltas.error)}`);
      console.log(`Average score delta: ${signedMetric(comparison.deltas.averageScore)}`);
      console.log(`Average runtime delta: ${signedMetric(comparison.deltas.averageRuntimeMs)}ms`);
      console.log(`Average steps delta: ${signedMetric(comparison.deltas.averageSteps)}`);
      if (comparison.notes.length > 0) {
        console.log("Notes:");
        for (const note of comparison.notes) {
          console.log(`- ${note}`);
        }
      }
      if (comparison.regressions.length > 0) {
        console.log("Regressions:");
        for (const regression of comparison.regressions) {
          console.log(`- ${regression.scenarioId}: ${regression.comparison.classification}`);
        }
      }
      if (comparison.improvements.length > 0) {
        console.log("Improvements:");
        for (const improvement of comparison.improvements) {
          console.log(`- ${improvement.scenarioId}: ${improvement.comparison.classification}`);
        }
      }
      if (comparison.missingFromCandidate.length > 0) {
        console.log(`Missing from candidate: ${comparison.missingFromCandidate.join(", ")}`);
      }
      if (comparison.missingFromBaseline.length > 0) {
        console.log(`Missing from baseline: ${comparison.missingFromBaseline.join(", ")}`);
      }
      return;
    }

    if (isBaselineCompare) {
      const scenarioId = args[1];
      const candidateRunId = args[2];
      if (!scenarioId || !candidateRunId) {
        throw new Error("Missing scenario id or candidate run id.");
      }

      const candidate = storage.getRun(candidateRunId);
      if (!candidate) {
        throw new Error(`Run '${candidateRunId}' not found.`);
      }
      const baseline = storage.getBaselineRun(scenarioId, candidate.run.agentVersionId);
      if (!baseline) {
        const agentLabel = candidate.agentVersion?.label ?? candidate.run.agentVersionId;
        throw new Error(`No baseline found for scenario ${scenarioId} with agent ${agentLabel}. Run \`agentlab approve <run-id>\` first.`);
      }

      printRunComparison(storage.compareRuns(baseline.run.id, candidate.run.id));
      return;
    }

    const [baselineRunId, candidateRunId] = args;
    if (!baselineRunId || !candidateRunId) {
      throw new Error("Missing baseline or candidate run id.");
    }

    printRunComparison(storage.compareRuns(baselineRunId, candidateRunId));
  } finally {
    storage.close();
  }
}

async function handleApprove(args: string[]): Promise<void> {
  const runId = args[0];
  if (!runId) {
    throw new Error("Missing run id.");
  }

  const { Storage } = await import("./storage.js");
  const storage = new Storage();
  try {
    const result = storage.approveRun(runId);
    if (result.status === "not_found") {
      throw new Error("run-id not found");
    }
    if (result.status === "already_baseline") {
      console.log(`Already the baseline for scenario ${result.run.scenarioId}`);
      return;
    }
    console.log(`Approved baseline for scenario ${result.run.scenarioId}`);
  } finally {
    storage.close();
  }
}

export function printRunComparison(comparison: import("./types.js").RunComparison): void {
  console.log(`Scenario: ${comparison.baseline.run.scenarioId}`);
  console.log(`Baseline: ${comparison.baseline.run.id} (${comparison.baseline.run.status.toUpperCase()} ${comparison.baseline.run.score}/100)`);
  console.log(`Candidate: ${comparison.candidate.run.id} (${comparison.candidate.run.status.toUpperCase()} ${comparison.candidate.run.score}/100)`);
  console.log(`Classification: ${comparison.classification.toUpperCase()}`);
  console.log("Changes:");
  if (comparison.notes.length === 0) {
    console.log("- No material changes.");
  } else {
    for (const note of comparison.notes) {
      console.log(`- ${note}`);
    }
  }

  if (comparison.evaluatorDiffs.length > 0) {
    console.log("Evaluator diffs:");
    for (const diff of comparison.evaluatorDiffs) {
      console.log(`- ${diff.note}`);
    }
  }

  if (comparison.toolDiffs.length > 0) {
    console.log("Tool diffs:");
    for (const diff of comparison.toolDiffs) {
      console.log(`- ${diff.note}`);
    }
  }

  const scoreDelta = comparison.candidate.run.score - comparison.baseline.run.score;
  if (scoreDelta > 0) {
    console.log(`Score improved ${comparison.baseline.run.score} -> ${comparison.candidate.run.score} -- your agent got better.`);
  } else if (!["regressed", "unchanged_fail"].includes(comparison.classification)) {
    console.log("No regressions detected.");
  }
}

function signedMetric(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function parseRunArgs(args: string[]): {
  scenarioId?: string;
  suite?: string;
  suiteDefinition?: string;
  variantSetName?: string;
  demo: boolean;
  runtimeConfig: AgentRuntimeConfig;
} {
  const runtimeConfig: AgentRuntimeConfig = { provider: "mock" };
  let scenarioId: string | undefined;
  let suite: string | undefined;
  let suiteDefinition: string | undefined;
  let variantSetName: string | undefined;
  let demo = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--demo") {
      demo = true;
      continue;
    }
    if (arg === "--suite") {
      suite = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--suite-def") {
      suiteDefinition = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--variant-set") {
      variantSetName = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--provider") {
      const provider = args[index + 1];
      if (provider !== "mock" && provider !== "openai" && provider !== "external_process" && provider !== "http") {
        throw new Error(`Unsupported provider '${String(provider)}'.`);
      }
      runtimeConfig.provider = provider;
      index += 1;
      continue;
    }
    if (arg === "--agent") {
      runtimeConfig.agentName = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--model") {
      runtimeConfig.model = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--agent-label") {
      runtimeConfig.label = args[index + 1];
      index += 1;
      continue;
    }
    if (!scenarioId) {
      scenarioId = arg;
      continue;
    }

    throw new Error(`Unexpected argument '${arg}'.`);
  }

  return { scenarioId, suite, suiteDefinition, variantSetName, demo, runtimeConfig };
}

function validateRuntimeConfig(config: AgentRuntimeConfig): AgentRuntimeConfig {
  if (config.agentName) {
    const registration = getAgentRegistration(config.agentName);
    config.provider = registration.provider;
    config.label = config.label ?? registration.label ?? registration.name;
    if (registration.provider !== "http") {
      config.model = config.model ?? registration.model;
      config.command = registration.command;
      config.args = registration.args;
      config.envAllowlist = registration.envAllowlist;
    } else {
      config.url = registration.url;
      config.request_template = registration.request_template;
      config.response_field = registration.response_field;
      config.headers = registration.headers;
      config.timeout_ms = registration.timeout_ms;
    }
  }

  if (config.provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required when --provider openai is used.");
    }
    config.model = config.model ?? "gpt-4o-mini";
  }

  if (config.provider === "mock") {
    config.label = config.label ?? config.agentName ?? "mock-support-agent-v1";
  }

  if (config.provider === "external_process") {
    if (!config.command) {
      throw new Error("External process agents require a configured command.");
    }
    config.label = config.label ?? config.agentName ?? "external-process-agent";
  }

  if (config.provider === "http") {
    if (!config.url) {
      throw new Error("HTTP agents require a configured url. Use --agent <name> with provider: http in agentlab.config.yaml.");
    }
    config.label = config.label ?? config.agentName ?? "http-agent";
  }

  return config;
}
if (isEntrypoint()) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(formatCliErrorMessage(message));
    process.exitCode = 1;
  });
}

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  if (basename(entry) === "agentlab") {
    return true;
  }
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}
