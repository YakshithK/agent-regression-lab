#!/usr/bin/env node
import packageJson from "../package.json" with { type: "json" };
import { createAgentFactory } from "./agent/factory.js";
import { getAgentRegistration } from "./config.js";
import { createSuiteBatchId } from "./lib/id.js";
import { getRunErrorDetail } from "./runOutput.js";
import type { AgentRuntimeConfig, RunBundle } from "./types.js";

async function main(): Promise<void> {
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
    case "ui":
      await handleUi();
      break;
    default:
      printUsage();
  }
}

function printUsage(): void {
  console.log(`Usage:
  agentlab list scenarios
  agentlab run <scenario-id> [--agent <name>] [--provider mock|openai|external_process] [--model <model>] [--agent-label <label>]
  agentlab run --suite <suite-id> [--agent <name>] [--provider mock|openai|external_process] [--model <model>] [--agent-label <label>]
  agentlab show <run-id>
  agentlab compare <baseline-run-id> <candidate-run-id>
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

async function handleRun(args: string[]): Promise<void> {
  const parsed = parseRunArgs(args);
  const runtimeConfig = validateRuntimeConfig(parsed.runtimeConfig);
  const { loadScenariosBySuite } = await import("./scenarios.js");

  if (parsed.suite) {
    const suite = parsed.suite;
    if (!suite) {
      throw new Error("Missing suite id.");
    }

    const scenarios = loadScenariosBySuite(suite);
    if (scenarios.length === 0) {
      throw new Error(`No scenarios found for suite '${suite}'.`);
    }

    const suiteBatchId = createSuiteBatchId();
    const runs: RunBundle[] = [];
    for (const scenario of scenarios) {
      runs.push(await executeOne(scenario.definition.id, runtimeConfig, suiteBatchId));
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
    console.log(`Suite batch: ${suiteBatchId}`);
    return;
  }

  const scenarioId = parsed.scenarioId;
  if (!scenarioId) {
    throw new Error("Missing scenario id.");
  }

  await executeOne(scenarioId, runtimeConfig);
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
    bundle.agentVersion = agentVersion;
    storage.saveRun(bundle);
    printRunSummary(bundle);
    return bundle;
  } finally {
    storage.close();
  }
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
  console.log(`Runtime: ${bundle.run.durationMs}ms`);
  if (bundle.run.status !== "pass") {
    console.log(`Reason: ${bundle.run.terminationReason}`);
    const errorDetail = getRunErrorDetail(bundle);
    if (errorDetail) {
      console.log(`Error: ${errorDetail}`);
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

    const [baselineRunId, candidateRunId] = args;
    if (!baselineRunId || !candidateRunId) {
      throw new Error("Missing baseline or candidate run id.");
    }

    const comparison = storage.compareRuns(baselineRunId, candidateRunId);
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
  } finally {
    storage.close();
  }
}

function signedMetric(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
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
      if (provider !== "mock" && provider !== "openai" && provider !== "external_process") {
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

  return { scenarioId, suite, runtimeConfig };
}

function validateRuntimeConfig(config: AgentRuntimeConfig): AgentRuntimeConfig {
  if (config.agentName) {
    const registration = getAgentRegistration(config.agentName);
    config.provider = registration.provider;
    config.model = config.model ?? registration.model;
    config.label = config.label ?? registration.label ?? registration.name;
    config.command = registration.command;
    config.args = registration.args;
    config.envAllowlist = registration.envAllowlist;
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

  return config;
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
