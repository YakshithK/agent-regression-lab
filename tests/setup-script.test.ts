import assert from "node:assert";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chdir, cwd } from "node:process";
import test from "node:test";

import { runScenario } from "../src/runner.js";
import type { AgentAdapter, AgentRunInput, AgentSession, AgentVersion, ScenarioDefinition, ToolSpec } from "../src/types.js";

const agentVersion: AgentVersion = {
  id: "agent_setup_test",
  label: "setup-test-agent",
  provider: "mock",
  config: {},
};

const toolSpecs: ToolSpec[] = [{ name: "support.wait" }];

class FinalSession implements AgentSession {
  async next() {
    return { type: "final", output: "done" } as const;
  }
}

const adapter: AgentAdapter = {
  async startRun(_input: AgentRunInput) {
    return new FinalSession();
  },
};

const baseScenario: ScenarioDefinition = {
  id: "support.setup-test",
  name: "Setup test",
  suite: "support",
  task: {
    instructions: "finish",
  },
  tools: {
    allowed: ["support.wait"],
  },
  runtime: {
    max_steps: 2,
  },
  evaluators: [
    {
      id: "final",
      type: "exact_final_answer",
      mode: "hard_gate",
      config: { expected: "done" },
    },
  ],
};

function withTempWorkspace<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const previous = cwd();
  const root = join(tmpdir(), `arl_setup_${Date.now()}`);
  mkdirSync(root, { recursive: true });
  chdir(root);

  return fn(root).finally(() => {
    chdir(previous);
    rmSync(root, { recursive: true, force: true });
  });
}

async function runWithSetup(setupScript: string): Promise<void> {
  await runScenario({
    agentAdapter: adapter,
    agentVersion,
    scenario: {
      ...baseScenario,
      setup_script: setupScript,
    },
    scenarioFileHash: "hash_setup",
    toolSpecs,
    tools: {
      "support.wait": async () => ({ ok: true }),
    },
  });
}

test("setup_script executes before scenario run", async () => {
  await withTempWorkspace(async (root) => {
    mkdirSync(join(root, "fixtures"), { recursive: true });
    writeFileSync(join(root, "fixtures", "setup.ts"), `import { writeFileSync } from "node:fs";\nwriteFileSync("marker.txt", "ok");\n`);

    await runWithSetup("./fixtures/setup.ts");

    assert.equal(existsSync(join(root, "marker.txt")), true);
  });
});

test("setup_script failure aborts run and includes stderr", async () => {
  await withTempWorkspace(async (root) => {
    mkdirSync(join(root, "fixtures"), { recursive: true });
    writeFileSync(join(root, "fixtures", "setup.ts"), `console.error("seed failed");\nprocess.exit(7);\n`);

    await assert.rejects(() => runWithSetup("./fixtures/setup.ts"), /setup_script failed.*seed failed/s);
  });
});

test("setup_script rejects absolute paths", async () => {
  await assert.rejects(() => runWithSetup(resolve("/tmp/setup.ts")), /setup_script must be a relative path/);
});

test("setup_script rejects parent directory traversal", async () => {
  await assert.rejects(() => runWithSetup("../fixtures/setup.ts"), /setup_script cannot contain parent directory traversal/);
});

test("setup_script rejects missing files", async () => {
  await withTempWorkspace(async () => {
    await assert.rejects(() => runWithSetup("./fixtures/missing.ts"), /setup_script file not found/);
  });
});
