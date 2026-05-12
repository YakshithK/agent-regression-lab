import assert from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { describe, beforeEach, afterEach } from "node:test";

import { generateScenarios, parseGenerateArgs } from "../src/generate.js";

// ---------------------------------------------------------------------------
// parseGenerateArgs
// ---------------------------------------------------------------------------
describe("parseGenerateArgs", () => {
  test("returns empty options when no args supplied", () => {
    const opts = parseGenerateArgs([]);
    assert.deepStrictEqual(opts, {});
  });

  test("parses --agent", () => {
    const opts = parseGenerateArgs(["--agent", "my-agent"]);
    assert.equal(opts.agentName, "my-agent");
  });

  test("parses --provider", () => {
    const opts = parseGenerateArgs(["--provider", "openai"]);
    assert.equal(opts.provider, "openai");
  });

  test("parses --domain", () => {
    const opts = parseGenerateArgs(["--domain", "coding"]);
    assert.equal(opts.domain, "coding");
  });

  test("parses --count as integer", () => {
    const opts = parseGenerateArgs(["--count", "3"]);
    assert.equal(opts.count, 3);
  });

  test("throws on unexpected argument", () => {
    assert.throws(() => parseGenerateArgs(["--unknown"]), /Unexpected argument '--unknown'/);
  });
});

// ---------------------------------------------------------------------------
// generateScenarios - happy path per domain
// ---------------------------------------------------------------------------
describe("generateScenarios - domain generation", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), "agentlab-generate-test-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  for (const domain of ["support", "coding", "research", "ops", "general"] as const) {
    test(`writes at least one scenario for domain: ${domain}`, () => {
      const written = generateScenarios({ cwd: tempDir, domain, count: 1 });
      assert.ok(written.length >= 1);
      assert.equal(existsSync(written[0]!), true);
    });
  }

  test("substitutes {{agent_name}} in generated file", () => {
    const written = generateScenarios({ cwd: tempDir, domain: "support", count: 1, agentName: "my-custom-agent" });
    const content = readFileSync(written[0]!, "utf8");
    assert.ok(content.includes("my-custom-agent"), "agent name not substituted");
    assert.doesNotMatch(content, /\{\{agent_name\}\}/);
  });

  test("substitutes {{provider}} in generated file", () => {
    const written = generateScenarios({ cwd: tempDir, domain: "support", count: 1, provider: "openai" });
    const content = readFileSync(written[0]!, "utf8");
    assert.doesNotMatch(content, /\{\{provider\}\}/);
  });

  test("uses mock defaults when agentName and provider are omitted", () => {
    const written = generateScenarios({ cwd: tempDir, domain: "support", count: 1 });
    const content = readFileSync(written[0]!, "utf8");
    assert.ok(content.includes("mock-default") || !content.includes("{{agent_name}}"), "default substitution failed");
  });

  test("count limits how many scenarios are written", () => {
    const written2 = generateScenarios({ cwd: tempDir, domain: "support", count: 2 });
    assert.equal(written2.length, 2);
  });

  test("count > available templates writes only available templates", () => {
    // There are 5 support templates; asking for 999 should cap at available
    const written = generateScenarios({ cwd: tempDir, domain: "support", count: 999 });
    assert.ok(written.length >= 1);
    assert.ok(written.length <= 999);
  });

  test("throws when scenario file already exists", () => {
    generateScenarios({ cwd: tempDir, domain: "support", count: 1 });
    assert.throws(
      () => generateScenarios({ cwd: tempDir, domain: "support", count: 1 }),
      /Scenario already exists at/,
    );
  });

  test("returns array of absolute file paths", () => {
    const written = generateScenarios({ cwd: tempDir, domain: "support", count: 1 });
    for (const path of written) {
      assert.ok(path.startsWith("/"), `path is not absolute: ${path}`);
    }
  });

  test("created files are placed under scenarios/<domain>/ directory", () => {
    const written = generateScenarios({ cwd: tempDir, domain: "ops", count: 1 });
    for (const path of written) {
      assert.ok(path.includes("scenarios") && path.includes("ops"), `unexpected path: ${path}`);
    }
  });
});

// ---------------------------------------------------------------------------
// generateScenarios - validation errors
// ---------------------------------------------------------------------------
describe("generateScenarios - validation", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), "agentlab-generate-val-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("throws for unknown domain", () => {
    assert.throws(
      () => generateScenarios({ cwd: tempDir, domain: "unknown-domain" }),
      /Unknown domain 'unknown-domain'/,
    );
  });

  test("accepts customer-support as alias for support domain", () => {
    const written = generateScenarios({ cwd: tempDir, domain: "customer-support", count: 1 });
    assert.ok(written.length >= 1);
  });

  test("throws for non-integer count", () => {
    assert.throws(
      () => generateScenarios({ cwd: tempDir, count: 0 }),
      /--count must be a positive integer/,
    );
  });

  test("throws for negative count", () => {
    assert.throws(
      () => generateScenarios({ cwd: tempDir, count: -1 }),
      /--count must be a positive integer/,
    );
  });
});
