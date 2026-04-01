import { createAgentFactory } from "./agent/factory.js";
import { getRunErrorDetail } from "./runOutput.js";
import { runScenario } from "./runner.js";
import { listScenarios, loadScenarioById, loadScenariosBySuite } from "./scenarios.js";
import { Storage } from "./storage.js";
import { createToolRegistry } from "./tools.js";
import { startUiServer } from "./ui/server.js";
import type { AgentRuntimeConfig, RunBundle } from "./types.js";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "list":
      handleList(args);
      return;
    case "run":
      await handleRun(args);
      return;
    case "show":
      handleShow(args);
      return;
    case "compare":
      handleCompare(args);
      return;
    case "ui":
      await startUiServer();
      return;
    default:
      printUsage();
  }
}

function printUsage(): void {
  console.log(`Usage:
  agentlab list scenarios
  agentlab run <scenario-id> [--provider mock|openai] [--model <model>] [--agent-label <label>]
  agentlab run --suite <suite-id> [--provider mock|openai] [--model <model>] [--agent-label <label>]
  agentlab show <run-id>
  agentlab compare <baseline-run-id> <candidate-run-id>
  agentlab ui`);
}

function handleList(args: string[]): void {
  if (args[0] !== "scenarios") {
    printUsage();
    return;
  }

  for (const scenario of listScenarios()) {
    console.log(`${scenario.id}\t${scenario.suite}\t${scenario.difficulty ?? "-"}\t${scenario.description ?? ""}`);
  }
}

async function handleRun(args: string[]): Promise<void> {
  const parsed = parseRunArgs(args);
  const runtimeConfig = validateRuntimeConfig(parsed.runtimeConfig);

  if (parsed.suite) {
    const suite = parsed.suite;
    if (!suite) {
      throw new Error("Missing suite id.");
    }

    const scenarios = loadScenariosBySuite(suite);
    if (scenarios.length === 0) {
      throw new Error(`No scenarios found for suite '${suite}'.`);
    }

    const runs: RunBundle[] = [];
    for (const scenario of scenarios) {
      runs.push(await executeOne(scenario.definition.id, runtimeConfig));
    }

    const passed = runs.filter((bundle) => bundle.run.status === "pass").length;
    const failed = runs.filter((bundle) => bundle.run.status === "fail").length;
    const errored = runs.filter((bundle) => bundle.run.status === "error").length;
    const avgScore = Math.round(runs.reduce((sum, bundle) => sum + bundle.run.score, 0) / runs.length);

    console.log(`Suite: ${suite}`);
    console.log(`Passed: ${passed}/${runs.length}`);
    console.log(`Failed: ${failed}/${runs.length}`);
    console.log(`Errored: ${errored}/${runs.length}`);
    console.log(`Average score: ${avgScore}`);
    return;
  }

  const scenarioId = parsed.scenarioId;
  if (!scenarioId) {
    throw new Error("Missing scenario id.");
  }

  await executeOne(scenarioId, runtimeConfig);
}

async function executeOne(scenarioId: string, runtimeConfig: AgentRuntimeConfig): Promise<RunBundle> {
  const storage = new Storage();
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
    tools: createToolRegistry(),
  });

  storage.saveRun(bundle);
  printRunSummary(bundle);
  return bundle;
}

function printRunSummary(bundle: RunBundle): void {
  console.log(`Run: ${bundle.run.id}`);
  console.log(`Scenario: ${bundle.run.scenarioId}`);
  console.log(`Status: ${bundle.run.status.toUpperCase()}`);
  console.log(`Score: ${bundle.run.score}/100`);
  console.log(`Runtime: ${bundle.run.durationMs}ms`);
  if (bundle.run.status !== "pass") {
    console.log(`Reason: ${bundle.run.terminationReason}`);
    const errorDetail = getRunErrorDetail(bundle);
    if (errorDetail) {
      console.log(`Error: ${errorDetail}`);
    }
  }
}

function handleShow(args: string[]): void {
  const runId = args[0];
  if (!runId) {
    throw new Error("Missing run id.");
  }

  const storage = new Storage();
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
}

function handleCompare(args: string[]): void {
  const [baselineRunId, candidateRunId] = args;
  if (!baselineRunId || !candidateRunId) {
    throw new Error("Missing baseline or candidate run id.");
  }

  const storage = new Storage();
  const comparison = storage.compareRuns(baselineRunId, candidateRunId);
  console.log(`Scenario: ${comparison.baseline.run.scenarioId}`);
  console.log(`Baseline: ${comparison.baseline.run.id} (${comparison.baseline.run.status.toUpperCase()} ${comparison.baseline.run.score}/100)`);
  console.log(`Candidate: ${comparison.candidate.run.id} (${comparison.candidate.run.status.toUpperCase()} ${comparison.candidate.run.score}/100)`);
  console.log("Changes:");
  if (comparison.notes.length === 0) {
    console.log("- No material changes.");
    return;
  }

  for (const note of comparison.notes) {
    console.log(`- ${note}`);
  }
}

function parseRunArgs(args: string[]): {
  scenarioId?: string;
  suite?: string;
  runtimeConfig: AgentRuntimeConfig;
} {
  const runtimeConfig: AgentRuntimeConfig = { provider: "mock" };
  let scenarioId: string | undefined;
  let suite: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--suite") {
      suite = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--provider") {
      const provider = args[index + 1];
      if (provider !== "mock" && provider !== "openai") {
        throw new Error(`Unsupported provider '${String(provider)}'.`);
      }
      runtimeConfig.provider = provider;
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

  return { scenarioId, suite, runtimeConfig };
}

function validateRuntimeConfig(config: AgentRuntimeConfig): AgentRuntimeConfig {
  if (config.provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required when --provider openai is used.");
    }
    config.model = config.model ?? "gpt-4o-mini";
  }

  return config;
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
