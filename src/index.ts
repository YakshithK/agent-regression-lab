import { MockAgentAdapter } from "./agent/mockAdapter.js";
import { createAgentVersionId } from "./lib/id.js";
import { runScenario } from "./runner.js";
import { listScenarios, loadScenarioById, loadScenariosBySuite } from "./scenarios.js";
import { Storage } from "./storage.js";
import { createToolRegistry } from "./tools.js";
import type { AgentVersion, RunBundle } from "./types.js";

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
      console.log("UI is not implemented yet. Use `show` and `compare` for local inspection.");
      return;
    default:
      printUsage();
  }
}

function printUsage(): void {
  console.log(`Usage:
  agentlab list scenarios
  agentlab run <scenario-id>
  agentlab run --suite <suite-id>
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
  if (args[0] === "--suite") {
    const suite = args[1];
    if (!suite) {
      throw new Error("Missing suite id.");
    }

    const scenarios = loadScenariosBySuite(suite);
    if (scenarios.length === 0) {
      throw new Error(`No scenarios found for suite '${suite}'.`);
    }

    const runs: RunBundle[] = [];
    for (const scenario of scenarios) {
      runs.push(await executeOne(scenario.definition.id));
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

  const scenarioId = args[0];
  if (!scenarioId) {
    throw new Error("Missing scenario id.");
  }

  await executeOne(scenarioId);
}

async function executeOne(scenarioId: string): Promise<RunBundle> {
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

  const agentVersion = createAgentVersion();
  storage.upsertAgentVersion(agentVersion);

  const bundle = await runScenario({
    agentAdapter: new MockAgentAdapter(),
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
  console.log(`Termination: ${bundle.run.terminationReason}`);
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
  console.log(`Scenario: ${comparison.baseline.scenarioId}`);
  console.log(`Baseline: ${comparison.baseline.id} (${comparison.baseline.status.toUpperCase()} ${comparison.baseline.score}/100)`);
  console.log(`Candidate: ${comparison.candidate.id} (${comparison.candidate.status.toUpperCase()} ${comparison.candidate.score}/100)`);
  console.log("Changes:");
  if (comparison.notes.length === 0) {
    console.log("- No material changes.");
    return;
  }

  for (const note of comparison.notes) {
    console.log(`- ${note}`);
  }
}

function createAgentVersion(): AgentVersion {
  const label = "mock-support-agent-v1";
  const config = { adapter: "mock", domain: "support" };
  return {
    id: createAgentVersionId(label, config),
    label,
    modelId: "mock-model",
    provider: "local",
    config,
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
