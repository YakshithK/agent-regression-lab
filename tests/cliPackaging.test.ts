import assert from "node:assert";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import packageJson from "../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const CLI_FIXTURE_PATHS = ["dist", "package.json", "agentlab.config.yaml", "scenarios", "fixtures", "custom_agents", "user_tools"];
const CLI_COMMAND_TIMEOUT_MS = 10_000;

test("cli entrypoint has a node shebang", () => {
  const source = readFileSync(resolve("src/index.ts"), "utf8");
  assert.match(source.split("\n")[0] ?? "", /^#!\/usr\/bin\/env node$/);
});

test("built cli responds to help and version", async (t) => {
  const cliPath = resolve("dist/index.js");
  const fixtureRoot = createCliFixtureWorkspace();
  configureTierOneFixture(fixtureRoot);
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  assert.equal(existsSync(resolve("dist/ui-assets/client.js")), true);
  assert.equal(existsSync(resolve("dist/ui-assets/client.css")), true);

  const help = await runCli(cliPath, fixtureRoot, "--help");
  assert.match(help.stdout, /agentlab run <scenario-id>/);

  const version = await runCli(cliPath, fixtureRoot, "version");
  assert.equal(version.stdout.trim(), packageJson.version);

  const listed = await runCli(cliPath, fixtureRoot, "list", "scenarios");
  assert.match(listed.stdout, /support\.refund-correct-order/);

  const firstRun = await runCli(cliPath, fixtureRoot, "run", "support.refund-correct-order", "--agent", "mock-default");
  const secondRun = await runCli(cliPath, fixtureRoot, "run", "support.refund-correct-order", "--agent", "mock-default");

  const firstRunId = firstRun.stdout.match(/^Run: (.+)$/m)?.[1];
  const secondRunId = secondRun.stdout.match(/^Run: (.+)$/m)?.[1];
  assert.ok(firstRunId);
  assert.ok(secondRunId);
  if (!firstRunId || !secondRunId) {
    throw new Error("Expected both run ids in CLI output.");
  }

  const shown = await runCli(cliPath, fixtureRoot, "show", firstRunId);
  assert.match(shown.stdout, /Scenario: support\.refund-correct-order/);

  const suiteRun = await runCli(cliPath, fixtureRoot, "run", "--suite-def", "pre_merge", "--agent", "mock-default");
  assert.match(suiteRun.stdout, /Suite definition: pre_merge/);

  const variantRun = await runCli(cliPath, fixtureRoot, "run", "support.refund-correct-order", "--variant-set", "refund-agent-model-comparison");
  assert.match(variantRun.stdout, /Variant set: refund-agent-model-comparison/);
  assert.match(variantRun.stdout, /Variant: baseline/);
});

function createCliFixtureWorkspace(): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "agentlab-cli-"));
  for (const relativePath of CLI_FIXTURE_PATHS) {
    cpSync(resolve(relativePath), join(fixtureRoot, relativePath), { recursive: true });
  }
  symlinkSync(resolve("node_modules"), join(fixtureRoot, "node_modules"), "dir");
  return fixtureRoot;
}

function configureTierOneFixture(fixtureRoot: string): void {
  writeFileSync(
    join(fixtureRoot, "agentlab.config.yaml"),
    `agents:
  - name: mock-default
    provider: mock
    label: mock-default
  - name: mock-alt
    provider: mock
    label: mock-alt

variant_sets:
  - name: refund-agent-model-comparison
    variants:
      - agent: mock-default
        label: baseline
        prompt_version: prompt-v3
        model_version: mock-model-a
        tool_schema_version: refunds-v1
        config_label: baseline-config
      - agent: mock-alt
        label: candidate
        prompt_version: prompt-v4
        model_version: mock-model-b
        tool_schema_version: refunds-v2
        config_label: candidate-config

runtime_profiles:
  - name: timeout-orders-tool
    tool_faults:
      - tool: orders.list
        mode: timeout
        timeout_ms: 1500

suite_definitions:
  - name: pre_merge
    include:
      scenarios:
        - support.refund-correct-order

tools:
  - name: support.find_duplicate_charge
    modulePath: user_tools/findDuplicateCharge.ts
    exportName: findDuplicateCharge
    description: Find the duplicated charge order id for a given customer.
    inputSchema:
      type: object
      additionalProperties: false
      properties:
        customer_id:
          type: string
          description: Customer id to inspect for duplicated charges.
      required:
        - customer_id
`,
    "utf8",
  );
}

async function runCli(cliPath: string, fixtureRoot: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync("node", [cliPath, ...args], {
      cwd: fixtureRoot,
      timeout: CLI_COMMAND_TIMEOUT_MS,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`CLI command timed out or failed: node ${cliPath} ${args.join(" ")}\n${details}`);
  }
}
