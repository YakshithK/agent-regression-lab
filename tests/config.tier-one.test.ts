import test from "node:test";
import assert from "node:assert";
import { chdir, cwd } from "node:process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getRuntimeProfile, getSuiteDefinition, getVariantSet, loadAgentLabConfig } from "../src/config.js";

function writeTempConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "arl-tier1-"));
  writeFileSync(join(dir, "agentlab.config.yaml"), content, "utf8");
  return dir;
}

function withTempConfig<T>(content: string, fn: () => T): T {
  const previousCwd = cwd();
  const dir = writeTempConfig(content);
  try {
    chdir(dir);
    return fn();
  } finally {
    chdir(previousCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

const validConfig = `
agents:
  - name: base-agent
    provider: mock
    label: base-agent
variant_sets:
  - name: support-experiments
    variants:
      - agent: base-agent
        label: baseline
        notes: baseline path
runtime_profiles:
  - name: flaky-tools
    tool_faults:
      - tool: support.find_duplicate_charge
        mode: timeout
        timeout_ms: 250
    state:
      reset: per_run
      seeded_messages:
        - role: user
          message: hello
suite_definitions:
  - name: support-smoke
    include:
      scenarios:
        - support.order-tracking
      tags:
        - smoke
      suites:
        - support
    exclude:
      scenarios:
        - support.known-issue
`;

test("config accepts valid tier-one config sections", () => {
  withTempConfig(validConfig, () => {
    const config = loadAgentLabConfig();
    assert.strictEqual(config.variant_sets?.length, 1);
    assert.strictEqual(config.runtime_profiles?.length, 1);
    assert.strictEqual(config.suite_definitions?.length, 1);
    assert.strictEqual(getVariantSet("support-experiments").variants[0].label, "baseline");
    assert.strictEqual(getRuntimeProfile("flaky-tools").state?.reset, "per_run");
    assert.strictEqual(getSuiteDefinition("support-smoke").include.tags?.[0], "smoke");
  });
});

test("config rejects variant_set referencing unknown agent", () => {
  const invalidConfig = `
agents:
  - name: base-agent
    provider: mock
variant_sets:
  - name: support-experiments
    variants:
      - agent: missing-agent
        label: baseline
`;

  assert.throws(
    () => withTempConfig(invalidConfig, () => loadAgentLabConfig()),
    /unknown agent/i,
  );
});

test("config rejects duplicate suite_definition names", () => {
  const invalidConfig = `
agents:
  - name: base-agent
    provider: mock
suite_definitions:
  - name: support-smoke
    include:
      scenarios:
        - support.order-tracking
  - name: support-smoke
    include:
      tags:
        - smoke
`;

  assert.throws(
    () => withTempConfig(invalidConfig, () => loadAgentLabConfig()),
    /duplicate suite definition/i,
  );
});

test("config rejects invalid runtime profile fault mode", () => {
  const invalidConfig = `
agents:
  - name: base-agent
    provider: mock
runtime_profiles:
  - name: flaky-tools
    tool_faults:
      - tool: support.find_duplicate_charge
        mode: broken
`;

  assert.throws(
    () => withTempConfig(invalidConfig, () => loadAgentLabConfig()),
    /invalid tool fault mode/i,
  );
});

test("config accepts a package-backed tool registration", () => {
  const packageToolConfig = `
tools:
  - name: support.find_duplicate_charge
    package: "@agentlab/example-support-tools"
    exportName: findDuplicateCharge
    description: Find the duplicated charge order id for a given customer.
    inputSchema:
      type: object
      additionalProperties: false
      properties:
        customer_id:
          type: string
      required:
        - customer_id
`;

  withTempConfig(packageToolConfig, () => {
    const config = loadAgentLabConfig();
    assert.strictEqual(config.tools?.[0]?.package, "@agentlab/example-support-tools");
  });
});

test("config rejects a tool with both modulePath and package", () => {
  const invalidConfig = `
tools:
  - name: support.find_duplicate_charge
    modulePath: ./user_tools/findDuplicateCharge.ts
    package: "@agentlab/example-support-tools"
    exportName: findDuplicateCharge
    description: Find the duplicated charge order id for a given customer.
    inputSchema:
      type: object
`;

  assert.throws(
    () => withTempConfig(invalidConfig, () => loadAgentLabConfig()),
    /exactly one of 'modulePath' or 'package'/i,
  );
});

test("config rejects a tool with neither modulePath nor package", () => {
  const invalidConfig = `
tools:
  - name: support.find_duplicate_charge
    exportName: findDuplicateCharge
    description: Find the duplicated charge order id for a given customer.
    inputSchema:
      type: object
`;

  assert.throws(
    () => withTempConfig(invalidConfig, () => loadAgentLabConfig()),
    /exactly one of 'modulePath' or 'package'/i,
  );
});
