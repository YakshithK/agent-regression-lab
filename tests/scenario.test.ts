import test from "node:test";
import assert from "node:assert";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, rmSync } from "node:fs";

import { loadScenarioByPath } from "../src/scenarios.js";

const invalidScenario = `id: test.invalid\nname: invalid\nsuite: test\ntask:\n  instructions: hi\ntools:\n  allowed:\n    - missing.tool\n  forbidden: []\nevaluators:\n  - id: foo\n    type: final_answer_contains\n    mode: weighted\n    config:\n      required_substrings:\n        - ok`;

const validScenario = `id: test.valid\nname: valid\nsuite: test\ntask:\n  instructions: hi\ntools:\n  allowed:\n    - crm.search_customer\nevaluators:\n  - id: foo\n    type: final_answer_contains\n    mode: weighted\n    config:\n      required_substrings:\n        - ok`;

async function writeTemp(name: string, content: string): Promise<string> {
  const path = join(tmpdir(), `arl_${name}_${Date.now()}.yaml`);
  writeFileSync(path, content, "utf8");
  return path;
}

test("loadScenarioByPath rejects unknown tools", async () => {
  const path = await writeTemp("invalid", invalidScenario);
  try {
    assert.throws(() => loadScenarioByPath(path));
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
