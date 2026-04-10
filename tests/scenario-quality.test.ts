import test from "node:test";
import assert from "node:assert";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, writeFileSync } from "node:fs";

import { loadConversationScenarioByPath } from "../src/scenarios.js";

function writeTempScenario(name: string, content: string): string {
  const path = join(tmpdir(), `arl_scenario_quality_${name}_${Date.now()}.yaml`);
  writeFileSync(path, content, "utf8");
  return path;
}

test("conversation scenarios reject stale config.text for response_contains", () => {
  const path = writeTempScenario(
    "stale_text",
    `
type: conversation
id: quality.stale-text
name: Stale Text
suite: quality
steps:
  - role: user
    message: "hello"
    evaluators:
      - type: response_contains
        mode: hard_gate
        config:
          text: hello
`,
  );

  try {
    assert.throws(
      () => loadConversationScenarioByPath(path),
      /stale 'config.text'.*config.keywords/s,
    );
  } finally {
    rmSync(path);
  }
});

test("conversation scenarios reject response_contains without config.keywords", () => {
  const path = writeTempScenario(
    "missing_keywords",
    `
type: conversation
id: quality.missing-keywords
name: Missing Keywords
suite: quality
steps:
  - role: user
    message: "hello"
    evaluators:
      - type: response_contains
        mode: hard_gate
        config: {}
`,
  );

  try {
    assert.throws(
      () => loadConversationScenarioByPath(path),
      /must define config.keywords as a string array/,
    );
  } finally {
    rmSync(path);
  }
});
