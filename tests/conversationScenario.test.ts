import test from "node:test";
import assert from "node:assert";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, rmSync } from "node:fs";

import { loadConversationScenarioByPath } from "../src/scenarios.js";

async function writeTemp(name: string, content: string): Promise<string> {
  const path = join(tmpdir(), `arl_conv_${name}_${Date.now()}.yaml`);
  writeFileSync(path, content, "utf8");
  return path;
}

const validConversation = `
type: conversation
id: support.order-tracking
name: Order Tracking Multi-Turn
suite: support
steps:
  - role: user
    message: "Where is my order?"
    evaluators:
      - type: response_contains
        mode: hard_gate
        config:
          keywords: [shipped]
  - role: user
    message: "What is the tracking number?"
evaluators:
  - type: step_count_max
    mode: hard_gate
    config:
      max: 10
`;

const missingSteps = `
type: conversation
id: support.no-steps
name: No Steps
suite: support
steps: []
`;

const hasToolsField = `
type: conversation
id: support.with-tools
name: With Tools
suite: support
steps:
  - role: user
    message: "hello"
tools:
  allowed: [some.tool]
`;

const missingId = `
type: conversation
name: Missing ID
suite: support
steps:
  - role: user
    message: "hi"
`;

const invalidEvaluatorType = `
type: conversation
id: support.bad-eval
name: Bad Eval
suite: support
steps:
  - role: user
    message: "hi"
    evaluators:
      - type: forbidden_tool
        mode: hard_gate
        config: {}
`;

test("loadConversationScenarioByPath loads valid conversation scenario", async () => {
  const path = await writeTemp("valid", validConversation);
  try {
    const loaded = loadConversationScenarioByPath(path);
    assert.strictEqual(loaded.definition.id, "support.order-tracking");
    assert.strictEqual(loaded.definition.type, "conversation");
    assert.strictEqual(loaded.definition.steps.length, 2);
    assert.strictEqual(loaded.definition.steps[0].message, "Where is my order?");
    assert.strictEqual(loaded.definition.evaluators?.length, 1);
  } finally {
    rmSync(path);
  }
});

test("loadConversationScenarioByPath rejects empty steps", async () => {
  const path = await writeTemp("no-steps", missingSteps);
  try {
    assert.throws(() => loadConversationScenarioByPath(path), /at least one step/);
  } finally {
    rmSync(path);
  }
});

test("loadConversationScenarioByPath rejects tools field", async () => {
  const path = await writeTemp("with-tools", hasToolsField);
  try {
    assert.throws(() => loadConversationScenarioByPath(path), /tools/);
  } finally {
    rmSync(path);
  }
});

test("loadConversationScenarioByPath rejects missing id", async () => {
  const path = await writeTemp("no-id", missingId);
  try {
    assert.throws(() => loadConversationScenarioByPath(path), /id/);
  } finally {
    rmSync(path);
  }
});

test("loadConversationScenarioByPath rejects invalid evaluator type", async () => {
  const path = await writeTemp("bad-eval", invalidEvaluatorType);
  try {
    assert.throws(() => loadConversationScenarioByPath(path), /invalid type/);
  } finally {
    rmSync(path);
  }
});
