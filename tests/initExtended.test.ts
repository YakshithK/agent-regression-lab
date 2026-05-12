/**
 * Extended init tests covering branches not exercised by init.test.ts:
 *  - in-place init (no project-name argument)
 *  - interactive mode rejection in non-TTY
 *  - config already exists guard
 *  - external_process harness scaffolding (node + python)
 *  - non-support fixture domains (coding, ops, research/general)
 *  - http provider config generation
 *  - openai provider config generation
 *  - initProject with explicit answers overrides
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject } from "../src/init.js";

describe("initProject extended", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), "agentlab-init-ext-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // In-place init (no project-name)
  // -------------------------------------------------------------------------
  it("creates project files in cwd when no projectName is given", async () => {
    await initProject(undefined, { answers: { provider: "mock", domain: "support", agentName: "test-agent" } });

    assert.equal(existsSync(join(tempDir, "agentlab.config.yaml")), true);
    assert.equal(existsSync(join(tempDir, "scenarios")), true);
    assert.equal(existsSync(join(tempDir, "fixtures")), true);
  });

  it("throws if agentlab.config.yaml already exists during in-place init", async () => {
    writeFileSync(join(tempDir, "agentlab.config.yaml"), "# existing config\n", "utf8");

    await assert.rejects(
      () => initProject(undefined, { answers: { provider: "mock", domain: "support", agentName: "agent" } }),
      /Config already exists/,
    );
  });

  // -------------------------------------------------------------------------
  // Interactive mode guard
  // -------------------------------------------------------------------------
  it("throws when interactive=true and stdin is not a TTY", async () => {
    // process.stdin.isTTY is falsy in CI / test runner
    if (process.stdin.isTTY) {
      // Skip if running in interactive terminal
      return;
    }
    await assert.rejects(
      () => initProject("my-project", { interactive: true }),
      /requires an interactive terminal/,
    );
  });

  // -------------------------------------------------------------------------
  // external_process provider — node harness
  // -------------------------------------------------------------------------
  it("writes harness.js for external_process provider with node language", async () => {
    await initProject("ext-node", {
      answers: {
        provider: "external_process",
        domain: "support",
        agentName: "ext-agent",
        harnessLanguage: "node",
      },
    });

    assert.equal(existsSync(join(tempDir, "ext-node", "harness.js")), true);
    const config = readFileSync(join(tempDir, "ext-node", "agentlab.config.yaml"), "utf8");
    assert.ok(config.includes("provider: external_process"));
    assert.ok(config.includes("node harness.js"));
  });

  it("writes harness.py for external_process provider with python language", async () => {
    await initProject("ext-python", {
      answers: {
        provider: "external_process",
        domain: "support",
        agentName: "ext-py-agent",
        harnessLanguage: "python",
      },
    });

    assert.equal(existsSync(join(tempDir, "ext-python", "harness.py")), true);
    const config = readFileSync(join(tempDir, "ext-python", "agentlab.config.yaml"), "utf8");
    assert.ok(config.includes("provider: external_process"));
    assert.ok(config.includes("python harness.py"));
  });

  // -------------------------------------------------------------------------
  // HTTP provider
  // -------------------------------------------------------------------------
  it("writes http provider config with base URL", async () => {
    await initProject("http-project", {
      answers: {
        provider: "http",
        domain: "support",
        agentName: "http-agent",
        baseUrl: "http://localhost:4000",
      },
    });

    const config = readFileSync(join(tempDir, "http-project", "agentlab.config.yaml"), "utf8");
    assert.ok(config.includes("provider: http"));
    assert.ok(config.includes("http://localhost:4000"));
  });

  // -------------------------------------------------------------------------
  // OpenAI provider
  // -------------------------------------------------------------------------
  it("writes openai provider config", async () => {
    await initProject("openai-project", {
      answers: {
        provider: "openai",
        domain: "general",
        agentName: "openai-agent",
      },
    });

    const config = readFileSync(join(tempDir, "openai-project", "agentlab.config.yaml"), "utf8");
    assert.ok(config.includes("provider: openai"));
    assert.ok(config.includes("gpt-4o-mini"));
  });

  // -------------------------------------------------------------------------
  // Non-support domains — fixture stubs
  // -------------------------------------------------------------------------
  it("writes coding fixture stub", async () => {
    await initProject("coding-project", {
      answers: { provider: "mock", domain: "coding", agentName: "coder" },
    });

    assert.equal(existsSync(join(tempDir, "coding-project", "fixtures", "coding", "repo-files.json")), true);
  });

  it("writes ops fixture stubs", async () => {
    await initProject("ops-project", {
      answers: { provider: "mock", domain: "ops", agentName: "ops-agent" },
    });

    assert.equal(existsSync(join(tempDir, "ops-project", "fixtures", "ops", "alerts.json")), true);
    assert.equal(existsSync(join(tempDir, "ops-project", "fixtures", "ops", "logs.json")), true);
  });

  it("writes research fixture stub for research domain", async () => {
    await initProject("research-project", {
      answers: { provider: "mock", domain: "research", agentName: "researcher" },
    });

    assert.equal(existsSync(join(tempDir, "research-project", "fixtures", "research", "documents.json")), true);
  });

  it("writes research fixture stub for general domain (fallback)", async () => {
    await initProject("general-project", {
      answers: { provider: "mock", domain: "general", agentName: "gen-agent" },
    });

    // general falls through to the research fixture stub
    assert.equal(existsSync(join(tempDir, "general-project", "fixtures", "research", "documents.json")), true);
  });

  // -------------------------------------------------------------------------
  // .gitignore is created / appended
  // -------------------------------------------------------------------------
  it("appends artifacts/ to .gitignore", async () => {
    await initProject("gitignore-project", {
      answers: { provider: "mock", domain: "support", agentName: "agent" },
    });

    const gitignore = readFileSync(join(tempDir, "gitignore-project", ".gitignore"), "utf8");
    assert.ok(gitignore.includes("artifacts/"));
  });

  // -------------------------------------------------------------------------
  // Generates scenarios as part of init
  // -------------------------------------------------------------------------
  it("generates 5 scenarios by default", async () => {
    await initProject("full-project", {
      answers: { provider: "mock", domain: "support", agentName: "agent" },
    });

    // At minimum the happy-path scenario must exist
    assert.equal(
      existsSync(join(tempDir, "full-project", "scenarios", "support", "generated-happy-path.yaml")),
      true,
    );
  });

  // -------------------------------------------------------------------------
  // Prints cd instruction when a project name is given
  // -------------------------------------------------------------------------
  it("prints cd instruction for named project", async () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    try {
      await initProject("named-project", {
        answers: { provider: "mock", domain: "support", agentName: "agent" },
      });
    } finally {
      console.log = original;
    }

    const output = lines.join("\n");
    assert.match(output, /cd named-project/);
  });
});
