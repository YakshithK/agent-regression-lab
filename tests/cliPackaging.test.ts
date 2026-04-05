import assert from "node:assert";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import packageJson from "../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const CLI_FIXTURE_PATHS = ["dist", "package.json", "agentlab.config.yaml", "scenarios", "fixtures", "custom_agents", "user_tools"];

test("cli entrypoint has a node shebang", () => {
  const source = readFileSync(resolve("src/index.ts"), "utf8");
  assert.match(source.split("\n")[0] ?? "", /^#!\/usr\/bin\/env node$/);
});

test("built cli responds to help and version", async (t) => {
  await execFileAsync("/bin/bash", [
    "-lc",
    "export NVM_DIR=/home/yakshith/.nvm && source /home/yakshith/.nvm/nvm.sh && npm run build",
  ], { cwd: process.cwd() });
  const cliPath = resolve("dist/index.js");
  const fixtureRoot = createCliFixtureWorkspace();
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  assert.equal(existsSync(resolve("dist/ui-assets/client.js")), true);
  assert.equal(existsSync(resolve("dist/ui-assets/client.css")), true);

  const help = await execFileAsync("node", [cliPath, "--help"], { cwd: fixtureRoot });
  assert.match(help.stdout, /agentlab run <scenario-id>/);

  const version = await execFileAsync("node", [cliPath, "version"], { cwd: fixtureRoot });
  assert.equal(version.stdout.trim(), packageJson.version);

  const listed = await execFileAsync("node", [cliPath, "list", "scenarios"], { cwd: fixtureRoot });
  assert.match(listed.stdout, /support\.refund-correct-order/);

  const firstRun = await execFileAsync("node", [cliPath, "run", "support.refund-correct-order", "--agent", "mock-default"], {
    cwd: fixtureRoot,
  });
  const secondRun = await execFileAsync("node", [cliPath, "run", "support.refund-correct-order", "--agent", "mock-default"], {
    cwd: fixtureRoot,
  });

  const firstRunId = firstRun.stdout.match(/^Run: (.+)$/m)?.[1];
  const secondRunId = secondRun.stdout.match(/^Run: (.+)$/m)?.[1];
  assert.ok(firstRunId);
  assert.ok(secondRunId);
  if (!firstRunId || !secondRunId) {
    throw new Error("Expected both run ids in CLI output.");
  }

  const shown = await execFileAsync("node", [cliPath, "show", firstRunId], { cwd: fixtureRoot });
  assert.match(shown.stdout, /Scenario: support\.refund-correct-order/);

  const comparedRuns = await execFileAsync("node", [cliPath, "compare", firstRunId, secondRunId], { cwd: fixtureRoot });
  assert.match(comparedRuns.stdout, /Classification:/);

  const firstSuite = await execFileAsync("node", [cliPath, "run", "--suite", "support", "--agent", "mock-default"], {
    cwd: fixtureRoot,
  });
  const secondSuite = await execFileAsync("node", [cliPath, "run", "--suite", "support", "--agent", "mock-default"], {
    cwd: fixtureRoot,
  });

  const firstBatchId = firstSuite.stdout.match(/^Suite batch: (.+)$/m)?.[1];
  const secondBatchId = secondSuite.stdout.match(/^Suite batch: (.+)$/m)?.[1];
  assert.ok(firstBatchId);
  assert.ok(secondBatchId);
  if (!firstBatchId || !secondBatchId) {
    throw new Error("Expected both suite batch ids in CLI output.");
  }

  const comparedSuites = await execFileAsync("node", [cliPath, "compare", "--suite", firstBatchId, secondBatchId], {
    cwd: fixtureRoot,
  });
  assert.match(comparedSuites.stdout, /Suite: support/);
  assert.match(comparedSuites.stdout, /Classification:/);
});

function createCliFixtureWorkspace(): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "agentlab-cli-"));
  for (const relativePath of CLI_FIXTURE_PATHS) {
    cpSync(resolve(relativePath), join(fixtureRoot, relativePath), { recursive: true });
  }
  return fixtureRoot;
}
