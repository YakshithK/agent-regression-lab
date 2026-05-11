import assert from "node:assert";
import { execFile } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TSX_BIN = resolve("node_modules/.bin/tsx");
const CLI_PATH = resolve("src/index.ts");
const CLI_TIMEOUT_MS = 10_000;

test("help documents snapshot companion commands", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "arl_cli_help_"));
  try {
    const result = await runCli(workspace, "--help");
    assert.match(result.stdout, /agentlab run --demo/);
    assert.match(result.stdout, /agentlab approve <run-id>/);
    assert.match(result.stdout, /agentlab compare --baseline <scenario-id> <candidate-run-id>/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("run --demo works without config or scenarios from any cwd", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "arl_cli_demo_"));
  try {
    const result = await runCli(workspace, "run", "--demo");
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Scenario: demo\.snapshot-companion/);
    assert.match(result.stdout, /Phase 1: establish a baseline/);
    assert.match(result.stdout, /PASS\s+Score: 100\/100/);
    assert.match(result.stdout, /Approved as baseline/);
    assert.match(result.stdout, /Simulating a prompt change/);
    assert.match(result.stdout, /FAIL\s+Score: 50\/100\s+-- regression detected/);
    assert.match(result.stdout, /What changed:/);
    assert.match(result.stdout, /mentions-date\s+was: PASS\s+now: FAIL/);
    assert.match(result.stdout, /uses-two-tools\s+unchanged/);
    assert.match(result.stdout, /This is what agent regression testing catches/);
    assert.match(result.stdout, /Ready to test your own agent\?/);
    assert.match(result.stdout, /agentlab init/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("run --demo emits no ANSI escapes in non-TTY output", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "arl_cli_demo_plain_"));
  try {
    const result = await runCli(workspace, "run", "--demo");
    assert.doesNotMatch(result.stdout, /\x1b\[[0-9;]*m/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("approve and compare --baseline run the snapshot workflow", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "arl_cli_snapshot_"));
  try {
    cpSync(resolve("scenarios"), join(workspace, "scenarios"), { recursive: true });
    cpSync(resolve("fixtures"), join(workspace, "fixtures"), { recursive: true });
    mkdirSync(join(workspace, "artifacts"), { recursive: true });
    writeSnapshotConfig(workspace);

    const first = await runCli(workspace, "run", "support.refund-correct-order");
    const second = await runCli(workspace, "run", "support.refund-correct-order");
    const firstRunId = first.stdout.match(/^Run: (.+)$/m)?.[1];
    const secondRunId = second.stdout.match(/^Run: (.+)$/m)?.[1];
    assert.ok(firstRunId);
    assert.ok(secondRunId);

    const approved = await runCli(workspace, "approve", firstRunId!);
    assert.match(approved.stdout, /Approved baseline for scenario support\.refund-correct-order/);

    const approvedAgain = await runCli(workspace, "approve", firstRunId!);
    assert.match(approvedAgain.stdout, /Already the baseline for scenario support\.refund-correct-order/);

    const compared = await runCli(workspace, "compare", "--baseline", "support.refund-correct-order", secondRunId!);
    assert.match(compared.stdout, new RegExp(`Baseline: ${escapeRegExp(firstRunId!)}`));
    assert.match(compared.stdout, new RegExp(`Candidate: ${escapeRegExp(secondRunId!)}`));
    assert.match(compared.stdout, /Classification:/);
    assert.match(compared.stdout, /No regressions detected\./);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("compare --baseline reports when no approved baseline exists", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "arl_cli_no_baseline_"));
  try {
    cpSync(resolve("scenarios"), join(workspace, "scenarios"), { recursive: true });
    cpSync(resolve("fixtures"), join(workspace, "fixtures"), { recursive: true });
    mkdirSync(join(workspace, "artifacts"), { recursive: true });
    writeSnapshotConfig(workspace);

    const run = await runCli(workspace, "run", "support.refund-correct-order");
    const runId = run.stdout.match(/^Run: (.+)$/m)?.[1];
    assert.ok(runId);

    await assert.rejects(
      () => runCli(workspace, "compare", "--baseline", "support.refund-correct-order", runId!),
      (error: unknown) =>
        error instanceof Error &&
        /No baseline found for scenario support\.refund-correct-order with agent mock-support-agent-v1/.test(error.message) &&
        /agentlab approve <run-id>/.test(error.message),
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("approve reports unknown run ids", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "arl_cli_approve_missing_"));
  try {
    await assert.rejects(
      () => runCli(workspace, "approve", "run_missing"),
      (error: unknown) => error instanceof Error && /run-id not found/.test(error.message),
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

async function runCli(workspace: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(TSX_BIN, [CLI_PATH, ...args], {
      cwd: workspace,
      timeout: CLI_TIMEOUT_MS,
    });
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    throw new Error(`${err.message}\nstdout:\n${err.stdout ?? ""}\nstderr:\n${err.stderr ?? ""}`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function writeSnapshotConfig(workspace: string): void {
  writeFileSync(
    join(workspace, "agentlab.config.yaml"),
    `runtime_profiles:
  - name: timeout-orders-tool
    tool_faults:
      - tool: orders.list
        mode: timeout
        timeout_ms: 1500
`,
  );
}
