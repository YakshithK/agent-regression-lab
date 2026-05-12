#!/usr/bin/env node
import packageJson from "../package.json" with { type: "json" };
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import { createAgentFactory } from "./agent/factory.js";
import { getAgentRegistration, getVariantSet } from "./config.js";
import { createConfigHash, createSuiteBatchId } from "./lib/id.js";
import { badge, boxed, divider, gradient, scoreBar, sectionHeader, style, withSpinner } from "./cliStyle.js";
import { formatCliErrorMessage, formatRunIdentityLines, getFailedEvaluatorSummaries, getRunErrorDetail } from "./runOutput.js";
import { initProject } from "./init.js";
import type { AgentRuntimeConfig, RunBundle, VariantDefinition } from "./types.js";

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
    case "generate":
      await handleGenerate(args);
      break;
    default:
      printUsage();
  }
}

function printUsage(): void {
  const cmd = (text: string) => style.cyan(text);
  const arg = (text: string) => style.yellow(text);
  const dim = style.dim;
  console.log(`
  ${gradient("Agent Regression Lab", "#6366f1", "#a855f7")}  ${style.muted("— catch AI regressions before they ship")}

  ${style.bold("Commands")}

  ${cmd("agentlab init")} ${arg("[project-name]")}
  ${cmd("agentlab generate")} ${arg("[--agent <name>] [--domain support|coding|research|ops|general] [--count <n>]")}
  ${cmd("agentlab list scenarios")}
  ${cmd("agentlab run")} ${arg("<scenario-id>")} ${dim("[--agent <name>] [--provider mock|openai|external_process|http]")}
  ${cmd("agentlab run")} ${arg("--suite <suite-id>")} ${dim("[--agent <name>]")}
  ${cmd("agentlab run")} ${arg("--suite-def <name>")} ${dim("[--agent <name>]")}
  ${cmd("agentlab run")} ${arg("--demo")}
  ${cmd("agentlab show")} ${arg("<run-id|@last|@prev>")}
  ${cmd("agentlab approve")} ${arg("<run-id|@last>")}
  ${cmd("agentlab compare")} ${arg("<baseline-id> <candidate-id>")}
  ${cmd("agentlab compare --baseline")} ${arg("<scenario-id> <candidate-id>")}
  ${cmd("agentlab compare --suite")} ${arg("<baseline-batch-id> <candidate-batch-id>")}
  ${cmd("agentlab ui")}
  ${cmd("agentlab version")}
`);
}

function printVersion(): void {
  console.log(`${gradient("agentlab", "#6366f1", "#a855f7")} ${style.muted(`v${packageJson.version}`)}`);
}

async function handleList(args: string[]): Promise<void> {
  if (args[0] !== "scenarios") {
    printUsage();
    return;
  }

  const { listScenarios } = await import("./scenarios.js");
  const scenarios = listScenarios();
  console.log();
  console.log(sectionHeader(`${scenarios.length} scenario${scenarios.length !== 1 ? "s" : ""}`));
  for (const scenario of scenarios) {
    const diff = scenario.difficulty ?? "-";
    const diffPadded = diff.padEnd(6);
    const diffColor = diff === "easy" ? style.green(diffPadded) : diff === "hard" ? style.red(diffPadded) : style.yellow(diffPadded);
    console.log(`  ${style.cyan(scenario.id.padEnd(42))} ${style.muted(scenario.suite.padEnd(18))} ${diffColor}  ${style.dim(scenario.description ?? "")}`);
  }
  console.log();
}

async function handleInit(args: string[]): Promise<void> {
  const projectName = args[0];
  await initProject(projectName, { interactive: true });
}

async function handleGenerate(args: string[]): Promise<void> {
  const { handleGenerate: generate } = await import("./generate.js");
  await generate(args);
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
      console.log(`  ${style.muted("Variant set:")} ${style.cyan(parsed.variantSetName!)}`);
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
    console.log(`  ${style.muted("Suite definition:")} ${style.cyan(suiteDefinition)}`);
    if (parsed.variantSetName) {
      console.log(`  ${style.muted("Variant set:")} ${style.cyan(parsed.variantSetName!)}`);
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
    console.log(`  ${style.bold("Phase 1:")} ${style.muted("establish a baseline")}`);
    console.log();
    const baseline = await withSpinner("Running baseline scenario...", () =>
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
    console.log(`  ${badge.approved()}  Set as baseline.`);
    console.log();

    console.log(`  ${style.bold("Phase 2:")} ${style.muted("simulate a prompt change")}`);
    console.log();
    const candidate = await withSpinner("Running degraded scenario...", () =>
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
  console.log(sectionHeader("Demo Run"));
  console.log(`  ${style.muted("Scenario:")} demo.snapshot-companion`);
  console.log(`  ${style.muted("Task:")}     "Use the bundled demo notes to answer today's date."`);
  console.log();
}

function printDemoRunReplay(bundle: RunBundle): void {
  console.log(divider("Trace"));
  const toolCalls = [...bundle.toolCalls].sort((left, right) => left.stepIndex - right.stepIndex);
  toolCalls.forEach((call, index) => {
    console.log(`  ${style.muted(`Step ${index + 1}`)}  ${style.cyan(call.toolName)}(${style.dim(formatInlineObject(call.input))})`);
    console.log(`          ${style.dim("->")} ${style.yellow(formatInlineObject(call.output))}`);
  });
  console.log(`  ${style.bold("Answer")}  ${style.green(`"${bundle.run.finalOutput}"`)}`);
  console.log(divider());
}

function printDemoVerdict(bundle: RunBundle, options: { regression?: boolean } = {}): void {
  const statusBadge = bundle.run.status === "pass" ? badge.pass() : badge.fail();
  const regressionNote = options.regression && bundle.run.status !== "pass" ? `  ${badge.regression()}` : "";
  console.log(`  ${statusBadge}${regressionNote}  ${scoreBar(bundle.run.score)}  ${style.muted(`${bundle.run.totalToolCalls} tool calls · ${bundle.run.durationMs}ms`)}`);
  if (bundle.run.status === "pass" && !options.regression) {
    console.log(`  ${style.green("✓")} Agent found the answer within budget.`);
  }
}

function printDemoComparison(comparison: import("./types.js").RunComparison): void {
  console.log();
  console.log(sectionHeader("What changed"));
  const evaluatorIds = new Set([
    ...comparison.baseline.evaluatorResults.map((result) => result.evaluatorId),
    ...comparison.candidate.evaluatorResults.map((result) => result.evaluatorId),
  ]);
  for (const evaluatorId of [...evaluatorIds].sort()) {
    const baseline = comparison.baseline.evaluatorResults.find((result) => result.evaluatorId === evaluatorId);
    const candidate = comparison.candidate.evaluatorResults.find((result) => result.evaluatorId === evaluatorId);
    if (baseline?.status === candidate?.status) {
      console.log(`    ${style.green("✓")} ${style.muted(evaluatorId)}  ${style.dim("unchanged")}`);
    } else {
      console.log(`    ${style.red("✗")} ${style.bold(evaluatorId)}  ${style.muted(`was: ${baseline?.status.toUpperCase() ?? "MISSING"}`)}  ${style.red(`now: ${candidate?.status.toUpperCase() ?? "MISSING"}`)}`);
    }
  }
  console.log();
  console.log(`  ${style.bold(gradient("This is what agent regression testing catches.", "#6366f1", "#a855f7"))}`);
}

function printDemoCta(): void {
  console.log(divider());
  console.log(boxed(
    `Ready to test your own agent?\n\n  ${style.cyan("agentlab init")}        bootstrap a new project\n  ${style.cyan("agentlab run --help")}  see all options`,
    "purple",
  ));
}

function formatInlineObject(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(value);
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
  const hasIssues = failed > 0 || errored > 0;
  console.log();
  if (hasIssues) {
    console.log(boxed(
      `${badge.regression()}  ${failed + errored} regression${failed + errored !== 1 ? "s" : ""} in ${suite}\n\n  ${passed}/${runs.length} passed · avg score ${avgScore}/100`,
      "red",
    ));
  } else {
    console.log(boxed(
      `${badge.pass()}  All scenarios passed in ${suite}\n\n  ${passed}/${runs.length} passed · avg score ${avgScore}/100`,
      "green",
    ));
  }
  console.log(`  ${style.muted("Suite")}   ${style.cyan(suite)}`);
  console.log(`  ${style.muted("Batch")}   ${style.dim(suiteBatchId)}`);
  console.log();
}

function printConversationSummary(bundle: RunBundle, agentUrl: string, totalSteps: number): void {
  const statusBadge = bundle.run.status === "pass" ? badge.pass() : badge.fail();
  console.log();
  console.log(`  ${statusBadge}  ${style.bold(bundle.run.scenarioId)}`);
  console.log();
  console.log(`  ${style.muted("Agent")}    ${bundle.agentVersion?.label ?? bundle.run.agentVersionId}  ${style.dim(`(${agentUrl})`)}`);
  console.log(`  ${style.muted("Turns")}    ${bundle.run.totalSteps}/${totalSteps} completed`);
  console.log(`  ${style.muted("Run ID")}   ${style.dim(bundle.run.id)}`);

  const stepEvals = bundle.evaluatorResults.filter((r) => r.evaluatorId.startsWith("step_"));
  const stepIndices = new Set(
    stepEvals.map((r) => {
      const match = r.evaluatorId.match(/^step_(\d+)_/);
      return match ? parseInt(match[1], 10) : -1;
    }),
  );

  if (stepIndices.size > 0) {
    console.log();
    console.log(sectionHeader("Steps"));
    for (const stepIndex of [...stepIndices].sort((a, b) => a - b)) {
      const resultsForStep = stepEvals.filter((r) => r.evaluatorId.startsWith(`step_${stepIndex}_`));
      const allPass = resultsForStep.every((r) => r.status === "pass");
      const icon = allPass ? style.green("✓") : style.red("✗");
      const details = resultsForStep.map((r) => {
        if (r.evaluatorType === "response_latency_max") {
          const latencyMatch = r.message.match(/(\d+)ms/);
          return latencyMatch ? style.muted(`latency ${latencyMatch[1]}ms`) : r.message;
        }
        return `${r.evaluatorType} ${r.status === "pass" ? style.green("✓") : style.red("✗")}`;
      });
      const detailStr = details.length > 0 ? `  ${style.dim(`(${details.join(", ")})`)}` : "";
      console.log(`    ${icon} ${style.muted(`step ${stepIndex + 1}`)}${detailStr}`);
    }
  }

  if (bundle.run.status !== "pass") {
    console.log();
    console.log(`  ${style.muted("Stopped:")} ${bundle.run.terminationReason}`);
  }
  console.log();
}

async function handleUi(): Promise<void> {
  const { startUiServer } = await import("./ui/server.js");
  await startUiServer();
}

function printRunSummary(bundle: RunBundle): void {
  const statusBadge = bundle.run.status === "pass" ? badge.pass() : bundle.run.status === "fail" ? badge.fail() : badge.error();
  console.log();
  console.log(`  ${statusBadge}  ${scoreBar(bundle.run.score)}  ${style.muted(`${bundle.run.durationMs}ms`)}`);
  console.log();
  console.log(`  ${style.muted("Scenario")}   ${style.bold(bundle.run.scenarioId)}`);
  console.log(`  ${style.muted("Agent")}      ${bundle.agentVersion?.label ?? bundle.run.agentVersionId}`);
  if (bundle.agentVersion?.provider) {
    console.log(`  ${style.muted("Provider")}   ${bundle.agentVersion.provider}`);
  }
  if (bundle.agentVersion?.modelId) {
    console.log(`  ${style.muted("Model")}      ${bundle.agentVersion.modelId}`);
  }
  if (bundle.agentVersion?.command) {
    console.log(`  ${style.muted("Command")}    ${bundle.agentVersion.command} ${(bundle.agentVersion.args ?? []).join(" ")}`.trim());
  }
  for (const identityLine of formatRunIdentityLines(bundle)) {
    console.log(`  ${identityLine}`);
  }
  console.log(`  ${style.muted("Run ID")}     ${style.dim(bundle.run.id)}`);
  if (bundle.run.status === "pass") {
    console.log();
    console.log(`  ${style.green("✓")} No regressions detected.  ${style.muted("Run")} ${style.cyan(`agentlab approve ${bundle.run.id}`)} ${style.muted("to set as baseline.")}`);
  }
  if (bundle.run.status !== "pass") {
    console.log();
    console.log(`  ${style.muted("Reason")}  ${bundle.run.terminationReason}`);
    const errorDetail = getRunErrorDetail(bundle);
    if (errorDetail) {
      console.log(`  ${style.muted("Error")}   ${style.red(errorDetail)}`);
    }
    const failedEvaluators = getFailedEvaluatorSummaries(bundle);
    if (failedEvaluators.length > 0) {
      console.log();
      console.log(`  ${style.bold("Failed evaluators")}`);
      for (const summary of failedEvaluators) {
        console.log(`    ${style.red("✗")} ${summary}`);
      }
    }
  }
  console.log();
}

async function handleShow(args: string[]): Promise<void> {
  const runIdArg = args[0];
  if (!runIdArg) {
    throw new Error("Missing run id.");
  }

  const { Storage } = await import("./storage.js");
  const storage = new Storage();
  try {
    const runId = storage.resolveRunId(runIdArg);
    const bundle = storage.getRun(runId);
    if (!bundle) {
      throw new Error(`Run '${runId}' not found.`);
    }

    const statusBadge = bundle.run.status === "pass" ? badge.pass() : bundle.run.status === "fail" ? badge.fail() : badge.error();
    console.log();
    console.log(`  ${statusBadge}  ${scoreBar(bundle.run.score)}  ${style.muted(`${bundle.run.durationMs}ms`)}`);
    console.log();
    console.log(`  ${style.muted("Scenario")}     ${style.bold(bundle.run.scenarioId)}`);
    console.log(`  ${style.muted("Run ID")}       ${style.dim(bundle.run.id)}`);
    console.log(`  ${style.muted("Termination")}  ${bundle.run.terminationReason}`);
    if (bundle.agentVersion) {
      console.log(`  ${style.muted("Provider")}     ${bundle.agentVersion.provider ?? "unknown"}`);
      if (bundle.agentVersion.modelId) {
        console.log(`  ${style.muted("Model")}        ${bundle.agentVersion.modelId}`);
      }
      if (bundle.agentVersion.command) {
        console.log(`  ${style.muted("Command")}      ${bundle.agentVersion.command} ${(bundle.agentVersion.args ?? []).join(" ")}`.trim());
      }
    }
    const errorDetail = getRunErrorDetail(bundle);
    if (errorDetail) {
      console.log(`  ${style.muted("Error")}        ${style.red(errorDetail)}`);
    }
    console.log();
    console.log(`  ${style.bold("Final output")}`);
    console.log(`  ${style.dim(bundle.run.finalOutput ?? "(none)")}`);
    if (bundle.evaluatorResults.length > 0) {
      console.log();
      console.log(sectionHeader("Evaluators"));
      for (const result of bundle.evaluatorResults) {
        const icon = result.status === "pass" ? style.green("✓") : style.red("✗");
        const statusLabel = result.status === "pass" ? style.green("pass") : style.red("fail");
        console.log(`    ${icon} ${style.cyan(result.evaluatorId)}  ${statusLabel}  ${style.dim(result.message)}`);
      }
    }
    console.log();
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
      const hasRegressions = comparison.regressions.length > 0;
      const hasImprovements = comparison.improvements.length > 0;
      const classBadge = hasRegressions ? badge.regression() : hasImprovements ? badge.improved() : badge.pass();
      console.log();
      console.log(`  ${classBadge}  ${style.bold(comparison.suite)}`);
      console.log();
      console.log(`  ${style.muted("Baseline batch")}   ${style.dim(comparison.baselineBatchId)}`);
      console.log(`  ${style.muted("Candidate batch")}  ${style.dim(comparison.candidateBatchId)}`);
      console.log();
      console.log(sectionHeader("Deltas"));
      const delta = (label: string, val: number, unit = "") => {
        const v = signedMetric(val);
        const colored = val > 0 ? style.green(v) : val < 0 ? style.red(v) : style.dim(v);
        console.log(`    ${style.muted(label.padEnd(18))} ${colored}${unit}`);
      };
      delta("Pass", comparison.deltas.pass);
      delta("Fail", comparison.deltas.fail);
      delta("Error", comparison.deltas.error);
      delta("Avg score", comparison.deltas.averageScore);
      delta("Avg runtime", comparison.deltas.averageRuntimeMs, "ms");
      delta("Avg steps", comparison.deltas.averageSteps);
      if (comparison.notes.length > 0) {
        console.log(sectionHeader("Notes"));
        for (const note of comparison.notes) {
          console.log(`    ${style.muted("·")} ${note}`);
        }
      }
      if (comparison.regressions.length > 0) {
        console.log(sectionHeader(`Regressions (${comparison.regressions.length})`));
        for (const regression of comparison.regressions) {
          console.log(`    ${style.red("✗")} ${style.bold(regression.scenarioId)}  ${style.muted(regression.comparison.classification)}`);
        }
      }
      if (comparison.improvements.length > 0) {
        console.log(sectionHeader(`Improvements (${comparison.improvements.length})`));
        for (const improvement of comparison.improvements) {
          console.log(`    ${style.green("↑")} ${style.bold(improvement.scenarioId)}  ${style.muted(improvement.comparison.classification)}`);
        }
      }
      if (comparison.missingFromCandidate.length > 0) {
        console.log();
        console.log(`  ${style.yellow("Missing from candidate:")} ${comparison.missingFromCandidate.join(", ")}`);
      }
      if (comparison.missingFromBaseline.length > 0) {
        console.log(`  ${style.yellow("Missing from baseline:")} ${comparison.missingFromBaseline.join(", ")}`);
      }
      console.log();
      return;
    }

    if (isBaselineCompare) {
      const scenarioId = args[1];
      const candidateRunIdArg = args[2];
      if (!scenarioId || !candidateRunIdArg) {
        throw new Error("Missing scenario id or candidate run id.");
      }
      const candidateRunId = storage.resolveRunId(candidateRunIdArg, { scenarioId });

      const candidate = storage.getRun(candidateRunId);
      if (!candidate) {
        throw new Error(`Run '${candidateRunId}' not found.`);
      }
      const baseline = storage.getBaselineRun(scenarioId, candidate.run.agentVersionId);
      if (!baseline) {
        const agentLabel = candidate.agentVersion?.label ?? candidate.run.agentVersionId;
        throw new Error(`No baseline found for scenario ${scenarioId} with agent ${agentLabel}.\n\nRun: agentlab approve @last`);
      }

      printRunComparison(storage.compareRuns(baseline.run.id, candidate.run.id));
      return;
    }

    const [baselineRunId, candidateRunId] = args;
    if (!baselineRunId || !candidateRunId) {
      throw new Error("Missing baseline or candidate run id.");
    }

    printRunComparison(storage.compareRuns(storage.resolveRunId(baselineRunId), storage.resolveRunId(candidateRunId)));
  } finally {
    storage.close();
  }
}

async function handleApprove(args: string[]): Promise<void> {
  const runIdArg = args[0];
  if (!runIdArg) {
    throw new Error("Missing run id.");
  }

  const { Storage } = await import("./storage.js");
  const storage = new Storage();
  try {
    const runId = storage.resolveRunId(runIdArg);
    const result = storage.approveRun(runId);
    if (result.status === "not_found") {
      throw new Error("run-id not found");
    }
    if (result.status === "already_baseline") {
      console.log();
      console.log(`  ${badge.approved()}  Already the baseline for ${style.cyan(result.run.scenarioId)}`);
      console.log(`  ${style.dim(result.run.id)}`);
      console.log();
      return;
    }
    console.log();
    console.log(boxed(
      `${badge.approved()}  Baseline set!\n\n  ${style.bold(result.run.scenarioId)}\n  ${style.dim(result.run.id)}`,
      "blue",
    ));
  } finally {
    storage.close();
  }
}

export function printRunComparison(comparison: import("./types.js").RunComparison): void {
  const behaviorRegressed =
    comparison.baseline.run.status !== comparison.candidate.run.status ||
    comparison.candidate.run.score < comparison.baseline.run.score ||
    comparison.evaluatorDiffs.some((diff) => diff.hardGate && diff.baselineStatus === "pass" && diff.candidateStatus === "fail");
  const displayClassification = comparison.classification === "regressed" && !behaviorRegressed ? "changed_non_terminal" : comparison.classification;

  console.log();
  if (comparison.classification === "regressed" && behaviorRegressed) {
    console.log(boxed(`${badge.regression()}  Regression detected\n\n  ${comparison.baseline.run.scenarioId}`, "red"));
  } else if (displayClassification === "improved") {
    console.log(boxed(`${badge.improved()}  Scores improved\n\n  ${comparison.baseline.run.scenarioId}`, "green"));
  }

  const baseStatus = statusBadge(comparison.baseline.run.status);
  const candStatus = statusBadge(comparison.candidate.run.status);
  const scoreDelta = comparison.candidate.run.score - comparison.baseline.run.score;
  const deltaStr = scoreDelta > 0 ? style.green(`+${scoreDelta}`) : scoreDelta < 0 ? style.red(`${scoreDelta}`) : style.dim("±0");

  console.log(`  ${style.muted("Scenario")}   ${style.bold(comparison.baseline.run.scenarioId)}`);
  console.log(`  ${style.muted("Baseline")}   ${baseStatus}  ${scoreBar(comparison.baseline.run.score, 12)}  ${style.dim(comparison.baseline.run.id)}`);
  console.log(`  ${style.muted("Candidate")}  ${candStatus}  ${scoreBar(comparison.candidate.run.score, 12)}  ${style.dim(comparison.candidate.run.id)}`);
  console.log(`  ${style.muted("Score Δ")}    ${deltaStr}`);
  console.log();

  if (comparison.notes.length > 0 || comparison.evaluatorDiffs.length > 0 || comparison.toolDiffs.length > 0) {
    console.log(sectionHeader("Changes"));
    for (const note of comparison.notes) {
      console.log(`    ${style.muted("·")} ${note}`);
    }
    for (const diff of comparison.evaluatorDiffs) {
      const icon = diff.baselineStatus === "pass" && diff.candidateStatus === "fail" ? style.red("✗") : style.green("✓");
      console.log(`    ${icon} ${diff.note}`);
    }
    for (const diff of comparison.toolDiffs) {
      console.log(`    ${style.yellow("~")} ${diff.note}`);
    }
  } else {
    console.log(`    ${style.dim("No material changes.")}`);
  }

  console.log();
  if (scoreDelta > 0) {
    console.log(`  ${style.green("✓")} Score improved ${comparison.baseline.run.score} → ${comparison.candidate.run.score} — your agent got better!`);
  } else if (!["unchanged_fail"].includes(comparison.classification) && !behaviorRegressed) {
    console.log(`  ${style.green("✓")} No regressions detected.`);
  }
  console.log();
}

function statusBadge(status: import("./types.js").RunStatus): string {
  if (status === "pass") return badge.pass();
  if (status === "error") return badge.error();
  return badge.fail();
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
    // Some runtimes set argv[1] to a non-filesystem value (e.g. --eval).
    return false;
  }
}
