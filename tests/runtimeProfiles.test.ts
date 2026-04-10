import assert from "node:assert";
import test from "node:test";
import { chdir, cwd } from "node:process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runScenario } from "../src/runner.js";
import type { AgentAdapter, AgentEvent, AgentRunInput, AgentSession, AgentVersion, ScenarioDefinition, ToolSpec } from "../src/types.js";

const agentVersion: AgentVersion = {
  id: "agent_runtime_profile_test",
  label: "runtime-profile-test",
  provider: "mock",
  config: {},
};

const toolSpecs: ToolSpec[] = [
  { name: "support.wait" },
  { name: "docs.search" },
];

const timeoutScenario: ScenarioDefinition = {
  id: "support.timeout-profile-test",
  name: "Timeout Profile Test",
  suite: "support",
  runtime_profile: "timeout-tools",
  task: {
    instructions: "wait",
  },
  tools: {
    allowed: ["support.wait"],
  },
  runtime: {
    max_steps: 3,
    timeout_seconds: 10,
  },
  evaluators: [
    {
      id: "final",
      type: "final_answer_contains",
      mode: "weighted",
      weight: 100,
      config: { required_substrings: ["done"] },
    },
  ],
};

const malformedScenario: ScenarioDefinition = {
  id: "support.malformed-profile-test",
  name: "Malformed Profile Test",
  suite: "support",
  runtime_profile: "malformed-tools",
  task: {
    instructions: "search docs",
  },
  tools: {
    allowed: ["docs.search"],
  },
  runtime: {
    max_steps: 3,
  },
  evaluators: [
    {
      id: "final",
      type: "final_answer_contains",
      mode: "weighted",
      weight: 100,
      config: { required_substrings: ["done"] },
    },
  ],
};

class ToolCallingSession implements AgentSession {
  async next(event: AgentEvent) {
    if (event.type === "run_started") {
      return { type: "tool_call", toolName: "support.wait", input: {} } as const;
    }

    if (event.type === "tool_result") {
      return { type: "final", output: "done" } as const;
    }

    return { type: "final", output: "done" } as const;
  }
}

class MalformedOutputSession implements AgentSession {
  async next(event: AgentEvent) {
    if (event.type === "run_started") {
      return { type: "tool_call", toolName: "docs.search", input: { query: "remote work" } } as const;
    }

    if (event.type === "tool_result") {
      return { type: "final", output: "done" } as const;
    }

    return { type: "final", output: "done" } as const;
  }
}

function withTempWorkspace<T>(config: string, fn: () => Promise<T>): Promise<T> {
  const previousCwd = cwd();
  const root = mkdtempSync(join(tmpdir(), "arl-runtime-profile-"));
  writeFileSync(join(root, "agentlab.config.yaml"), config, "utf8");

  chdir(root);
  return fn().finally(() => {
    chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  });
}

test("timeout runtime profile forces a deterministic tool timeout", async () => {
  await withTempWorkspace(
    `
runtime_profiles:
  - name: timeout-tools
    tool_faults:
      - tool: support.wait
        mode: timeout
        timeout_ms: 25
`,
    async () => {
      const bundle = await runScenario({
        agentAdapter: {
          async startRun(_input: AgentRunInput) {
            return new ToolCallingSession();
          },
        },
        agentVersion,
        scenario: timeoutScenario,
        scenarioFileHash: "runtime-profile-hash",
        toolSpecs,
        tools: {
          "support.wait": async () => ({ ok: true }),
        },
      });

      assert.equal(bundle.run.status, "error");
      assert.equal(bundle.run.terminationReason, "timeout_exceeded");
      const timeoutEvent = bundle.traceEvents.find((event) => event.type === "timeout_exceeded");
      assert.ok(timeoutEvent);
      assert.match(String(timeoutEvent?.payload.message), /Injected timeout for support\.wait/);
      assert.ok(bundle.traceEvents.some((event) => event.type === "tool_fault_injected"));
    },
  );
});

test("malformed_output runtime profile changes tool output and records trace event", async () => {
  await withTempWorkspace(
    `
runtime_profiles:
  - name: malformed-tools
    tool_faults:
      - tool: docs.search
        mode: malformed_output
`,
    async () => {
      const bundle = await runScenario({
        agentAdapter: {
          async startRun(_input: AgentRunInput) {
            return new MalformedOutputSession();
          },
        },
        agentVersion,
        scenario: malformedScenario,
        scenarioFileHash: "runtime-profile-hash",
        toolSpecs,
        tools: {
          "docs.search": async () => ({ results: ["policy-doc"] }),
        },
      });

      assert.equal(bundle.run.status, "pass");
      assert.equal(bundle.run.totalSteps, 8);
      assert.equal(bundle.toolCalls[0]?.output, "MALFORMED_OUTPUT");
      assert.ok(bundle.traceEvents.some((event) => event.type === "tool_fault_injected"));
    },
  );
});
