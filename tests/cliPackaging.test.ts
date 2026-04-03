import assert from "node:assert";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

test("cli entrypoint has a node shebang", () => {
  const source = readFileSync(resolve("src/index.ts"), "utf8");
  assert.match(source.split("\n")[0] ?? "", /^#!\/usr\/bin\/env node$/);
});

test("built cli responds to help and version", async () => {
  await execFileAsync("/bin/bash", [
    "-lc",
    "export NVM_DIR=/home/yakshith/.nvm && source /home/yakshith/.nvm/nvm.sh && npm run build",
  ], { cwd: process.cwd() });
  const cliPath = resolve("dist/index.js");

  assert.equal(existsSync(resolve("dist/ui-assets/client.js")), true);
  assert.equal(existsSync(resolve("dist/ui-assets/client.css")), true);

  const help = await execFileAsync("node", [cliPath, "--help"], { cwd: process.cwd() });
  assert.match(help.stdout, /agentlab run <scenario-id>/);

  const version = await execFileAsync("node", [cliPath, "version"], { cwd: process.cwd() });
  assert.match(version.stdout.trim(), /^0\.1\.0$/);
});
