import test from "node:test";
import assert from "node:assert";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { chdir, cwd } from "node:process";

async function withTempWorkspace<T>(files: Record<string, string>, fn: () => Promise<T> | T): Promise<T> {
  const previousCwd = cwd();
  const root = join(tmpdir(), `arl_suite_${Date.now()}`);
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

test("loadScenariosBySuiteDefinition resolves include and exclude selectors", () => {
  return withTempWorkspace(
    {
      "agentlab.config.yaml": `
suite_definitions:
  - name: pre_merge
    include:
      scenarios:
        - support.refund-correct-order
      tags:
        - regression
      suites:
        - internal-teams
    exclude:
      scenarios:
        - internal-teams.tool-timeout-profile
`,
      "scenarios/support/refund-correct-order.yaml": `
id: support.refund-correct-order
name: Refund The Correct Order
suite: support
tags:
  - support
  - regression
task:
  instructions: "Refund the duplicated order."
tools:
  allowed:
    - crm.search_customer
evaluators:
  - id: final-answer
    type: final_answer_contains
    mode: weighted
    config:
      required_substrings:
        - refunded
`,
      "scenarios/support/refund-bob-order.yaml": `
id: support.refund-bob-order
name: Refund Bob's Order
suite: support
tags:
  - support
  - regression
task:
  instructions: "Refund the duplicated order."
tools:
  allowed:
    - crm.search_customer
evaluators:
  - id: final-answer
    type: final_answer_contains
    mode: weighted
    config:
      required_substrings:
        - refunded
`,
      "scenarios/internal-teams/tool-timeout-profile.yaml": `
id: internal-teams.tool-timeout-profile
name: Tool Timeout Profile
suite: internal-teams
tags:
  - smoke
task:
  instructions: "Inspect the order state."
tools:
  allowed:
    - crm.search_customer
evaluators:
  - id: final-answer
    type: final_answer_contains
    mode: weighted
    config:
      required_substrings:
        - order
`,
      "scenarios/internal-teams/memory-followup-recall.yaml": `
type: conversation
id: internal-teams.memory-followup-recall
name: Follow-Up Recall Within Conversation
suite: internal-teams
steps:
  - role: user
    message: "I'm traveling next Tuesday and I prefer aisle seats."
  - role: user
    message: "What seat preference did I mention earlier?"
`,
    },
    async () => {
      const { loadScenariosBySuiteDefinition } = await importFreshScenariosModule();
      const scenarios = loadScenariosBySuiteDefinition("pre_merge");
      assert.deepStrictEqual(
        scenarios.map((scenario) => scenario.definition.id),
        [
          "internal-teams.memory-followup-recall",
          "support.refund-bob-order",
          "support.refund-correct-order",
        ],
      );
      assert.ok(scenarios.some((scenario) => "type" in scenario.definition && scenario.definition.type === "conversation"));
    },
  );
});

test("run against a variant set produces one run per variant with variant metadata", async () => {
  await withTempWorkspace(
    {
      "agentlab.config.yaml": `
agents:
  - name: mock-baseline
    provider: mock
    label: mock-baseline
  - name: mock-candidate
    provider: mock
    label: mock-candidate
variant_sets:
  - name: refund-agent-model-comparison
    variants:
      - agent: mock-baseline
        label: baseline
        prompt_version: prompt-v3
        model_version: mock-model-a
        tool_schema_version: refunds-v1
        config_label: baseline-config
      - agent: mock-candidate
        label: candidate
        prompt_version: prompt-v4
        model_version: mock-model-b
        tool_schema_version: refunds-v2
        config_label: candidate-config
`,
      "scenarios/support/refund-correct-order.yaml": `
id: support.refund-correct-order
name: Refund The Correct Order
suite: support
task:
  instructions: "Refund the duplicated order."
context:
  variables:
    customer_email: alice@example.com
tools:
  allowed:
    - crm.search_customer
    - orders.list
    - orders.refund
evaluators:
  - id: refunded-order
    type: tool_call_assertion
    mode: hard_gate
    config:
      tool: orders.refund
      match:
        order_id: ord_1024
  - id: final-answer
    type: final_answer_contains
    mode: weighted
    config:
      required_substrings:
        - Refunded
        - ord_1024
`,
      "fixtures/support/customers.json": `[
  {
    "id": "cus_100",
    "email": "alice@example.com",
    "name": "Alice Example"
  }
]`,
      "fixtures/support/orders.json": `[
  {
    "id": "ord_1023",
    "customer_id": "cus_100",
    "amount": 49,
    "currency": "USD",
    "status": "paid",
    "duplicate_group": "dup_1"
  },
  {
    "id": "ord_1024",
    "customer_id": "cus_100",
    "amount": 49,
    "currency": "USD",
    "status": "paid",
    "duplicate_group": "dup_1"
  }
]`,
    },
    async () => {
      const { executeVariantSetScenario } = await importFreshIndexModule();
      const runs = await executeVariantSetScenario("support.refund-correct-order", "refund-agent-model-comparison");
      assert.equal(runs.length, 2);
      assert.equal(runs[0]?.run.status, "pass");
      assert.equal(runs[0]?.run.variantLabel, "baseline");
      assert.equal(runs[0]?.run.variantSetName, "refund-agent-model-comparison");
      assert.equal(runs[0]?.run.promptVersion, "prompt-v3");
      assert.equal(runs[1]?.run.variantLabel, "candidate");
      assert.equal(runs[1]?.run.toolSchemaVersion, "refunds-v2");
      assert.equal(runs[0]?.agentVersion?.configLabel, "baseline-config");
    },
  );
});

async function importFreshIndexModule(): Promise<typeof import("../src/index.js")> {
  return await import(`../src/index.js?workspace=${Date.now()}`);
}

async function importFreshScenariosModule(): Promise<typeof import("../src/scenarios.js")> {
  return await import(`../src/scenarios.js?workspace=${Date.now()}`);
}
