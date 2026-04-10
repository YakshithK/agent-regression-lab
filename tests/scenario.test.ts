import test from "node:test";
import assert from "node:assert";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { chdir, cwd } from "node:process";

import { loadScenarioByPath } from "../src/scenarios.js";

const invalidScenario = `id: test.invalid\nname: invalid\nsuite: test\ntask:\n  instructions: hi\ntools:\n  allowed:\n    - missing.tool\n  forbidden: []\nevaluators:\n  - id: foo\n    type: final_answer_contains\n    mode: weighted\n    config:\n      required_substrings:\n        - ok`;

const validScenario = `id: test.valid\nname: valid\nsuite: test\ntask:\n  instructions: hi\ntools:\n  allowed:\n    - crm.search_customer\nevaluators:\n  - id: foo\n    type: final_answer_contains\n    mode: weighted\n    config:\n      required_substrings:\n        - ok`;

const invalidForbiddenToolsScenario = `id: test.invalid-forbidden\nname: invalid forbidden\nsuite: test\ntask:\n  instructions: hi\ntools:\n  allowed:\n    - crm.search_customer\n  forbidden:\n    tool: orders.refund_all\nevaluators:\n  - id: foo\n    type: final_answer_contains\n    mode: weighted\n    config:\n      required_substrings:\n        - ok`;

async function writeTemp(name: string, content: string): Promise<string> {
  const path = join(tmpdir(), `arl_${name}_${Date.now()}.yaml`);
  writeFileSync(path, content, "utf8");
  return path;
}

function withTempWorkspace<T>(files: Record<string, string>, fn: () => T): T {
  const previousCwd = cwd();
  const root = join(tmpdir(), `arl_workspace_${Date.now()}`);
  mkdirSync(root, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(root, relativePath);
    mkdirSync(join(absolutePath, ".."), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }

  try {
    chdir(root);
    return fn();
  } finally {
    chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
}

test("loadScenarioByPath rejects unknown tools", async () => {
  const path = await writeTemp("invalid", invalidScenario);
  try {
    assert.throws(() => loadScenarioByPath(path), /references unknown allowed tool 'missing\.tool'/);
  } finally {
    rmSync(path);
  }
});

test("loadScenarioByPath reads valid scenarios", async () => {
  const path = await writeTemp("valid", validScenario);
  try {
    const loaded = loadScenarioByPath(path);
    assert.strictEqual(loaded.definition.id, "test.valid");
  } finally {
    rmSync(path);
  }
});

test("loadScenarioByPath rejects non-array tools.forbidden", async () => {
  const path = await writeTemp("invalid-forbidden", invalidForbiddenToolsScenario);
  try {
    assert.throws(() => loadScenarioByPath(path), /field 'tools\.forbidden' must be an array of strings/);
  } finally {
    rmSync(path);
  }
});

test("task scenario accepts runtime_profile reference", () => {
  withTempWorkspace(
    {
      "agentlab.config.yaml": `
runtime_profiles:
  - name: timeout-orders-tool
    tool_faults:
      - tool: orders.list
        mode: timeout
        timeout_ms: 250
`,
      "scenarios/internal-teams/tool-timeout-profile.yaml": `
id: internal-teams.tool-timeout-profile
name: Tool Timeout Profile
suite: internal-teams
runtime_profile: timeout-orders-tool
task:
  instructions: "Inspect the order state."
tools:
  allowed:
    - crm.search_customer
evaluators:
  - id: final-answer
    type: final_answer_contains
    mode: weighted
    config:
      required_substrings:
        - order
`,
    },
    () => {
      const loaded = loadScenarioByPath("scenarios/internal-teams/tool-timeout-profile.yaml");
      assert.strictEqual((loaded.definition as any).runtime_profile, "timeout-orders-tool");
    },
  );
});
