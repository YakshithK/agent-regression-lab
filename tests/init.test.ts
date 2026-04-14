import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject } from "../src/init.js";

describe("init command", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), "agentlab-init-test-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates project directory structure", async () => {
    await initProject("my-project");

    assert.equal(existsSync(join(tempDir, "my-project")), true);
    assert.equal(existsSync(join(tempDir, "my-project", "scenarios")), true);
    assert.equal(existsSync(join(tempDir, "my-project", "fixtures")), true);
    assert.equal(existsSync(join(tempDir, "my-project", "agentlab.config.yaml")), true);
  });

  it("creates sample scenario file", async () => {
    await initProject("my-project");

    const scenarioPath = join(tempDir, "my-project", "scenarios", "sample", "hello-world.yaml");
    assert.equal(existsSync(scenarioPath), true);

    const content = readFileSync(scenarioPath, "utf-8");
    assert.ok(content.includes("id: sample.hello-world"));
    assert.ok(content.includes("suite: sample"));
  });

  it("creates sample fixture file", async () => {
    await initProject("my-project");

    const fixturePath = join(tempDir, "my-project", "fixtures", "users.json");
    assert.equal(existsSync(fixturePath), true);
  });

  it("creates agentlab.config.yaml", async () => {
    await initProject("my-project");

    const configPath = join(tempDir, "my-project", "agentlab.config.yaml");
    assert.equal(existsSync(configPath), true);

    const content = readFileSync(configPath, "utf-8");
    assert.ok(content.includes("mock-default"));
    assert.ok(content.includes('modulePath: ./tools/customTool.ts'));
    assert.ok(content.includes('package: "@agentlab/example-support-tools"'));
  });

  it("prints next steps including package-backed tool guidance", async () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "));
    };

    try {
      await initProject("my-project");
    } finally {
      console.log = originalLog;
    }

    const output = lines.join("\n");
    assert.match(output, /npm install @agentlab\/example-support-tools/);
    assert.match(output, /agentlab run sample\.hello-world --agent mock-default/);
  });

  it("throws if directory already exists", async () => {
    await initProject("my-project");

    await assert.rejects(
      async () => await initProject("my-project"),
      /already exists/
    );
  });
});
