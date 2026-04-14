import test from "node:test";
import assert from "node:assert";
import { chdir, cwd } from "node:process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function withTempWorkspace<T>(files: Record<string, string>, fn: () => Promise<T> | T): Promise<T> {
  const previousCwd = cwd();
  const root = join(tmpdir(), `arl_package_tools_${Date.now()}`);
  mkdirSync(root, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(root, relativePath);
    mkdirSync(join(absolutePath, ".."), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }

  try {
    chdir(root);
    return await fn();
  } finally {
    chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
}

async function importFreshToolsModule() {
  return await import(`../src/tools.js?package-tools=${Date.now()}`);
}

test("loadToolRegistry loads a package-backed tool from node_modules", async () => {
  await withTempWorkspace(
    {
      "package.json": JSON.stringify({ name: "tool-workspace", type: "module" }),
      "agentlab.config.yaml": `
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
`,
      "node_modules/@agentlab/example-support-tools/package.json": JSON.stringify({
        name: "@agentlab/example-support-tools",
        type: "module",
        exports: "./index.js",
      }),
      "node_modules/@agentlab/example-support-tools/index.js": `
export async function findDuplicateCharge(input) {
  return { order_id: "dup_" + String(input.customer_id ?? "") };
}
`,
    },
    async () => {
      const { loadToolRegistry, loadToolSpecs } = await importFreshToolsModule();
      const specs = await loadToolSpecs();
      const registry = await loadToolRegistry();
      assert.ok(specs.some((spec: { name: string }) => spec.name === "support.find_duplicate_charge"));
      const result = await registry["support.find_duplicate_charge"]({ customer_id: "cus_100" }, { scenarioId: "test" });
      assert.deepStrictEqual(result, { order_id: "dup_cus_100" });
    },
  );
});

test("loadToolRegistry surfaces a clear error when package import fails", async () => {
  await withTempWorkspace(
    {
      "package.json": JSON.stringify({ name: "tool-workspace", type: "module" }),
      "agentlab.config.yaml": `
tools:
  - name: support.find_duplicate_charge
    package: "@agentlab/missing-tools"
    exportName: findDuplicateCharge
    description: Find the duplicated charge order id for a given customer.
    inputSchema:
      type: object
`,
    },
    async () => {
      const { loadToolRegistry } = await importFreshToolsModule();
      await assert.rejects(
        async () => await loadToolRegistry(),
        /Tool 'support\.find_duplicate_charge' failed to load package '@agentlab\/missing-tools'/,
      );
    },
  );
});

test("loadToolRegistry still loads repo-local modulePath tools", async () => {
  await withTempWorkspace(
    {
      "package.json": JSON.stringify({ name: "tool-workspace", type: "module" }),
      "agentlab.config.yaml": `
tools:
  - name: support.find_duplicate_charge
    modulePath: ./user_tools/findDuplicateCharge.js
    exportName: findDuplicateCharge
    description: Find the duplicated charge order id for a given customer.
    inputSchema:
      type: object
`,
      "user_tools/findDuplicateCharge.js": `
export async function findDuplicateCharge(input) {
  return { order_id: "local_" + String(input.customer_id ?? "") };
}
`,
    },
    async () => {
      const { loadToolRegistry } = await importFreshToolsModule();
      const registry = await loadToolRegistry();
      const result = await registry["support.find_duplicate_charge"]({ customer_id: "cus_200" }, { scenarioId: "test" });
      assert.deepStrictEqual(result, { order_id: "local_cus_200" });
    },
  );
});

test("example support tools package exports the documented function", async () => {
  const mod = await import("../examples/support-tools/index.js");
  assert.equal(typeof mod.findDuplicateCharge, "function");
  const result = await mod.findDuplicateCharge({ customer_id: "cus_123" });
  assert.deepStrictEqual(result, { order_id: "dup_cus_123" });
});
