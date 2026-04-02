import assert from "node:assert";
import test from "node:test";

import { runScenario } from "../src/runner.js";
import type { AgentAdapter, AgentEvent, AgentRunInput, AgentSession, AgentVersion, ScenarioDefinition, ToolSpec } from "../src/types.js";

const agentVersion: AgentVersion = {
  id: "agent_test",
  label: "test-agent",
  provider: "mock",
  config: {},
};

const toolSpecs: ToolSpec[] = [{ name: "support.wait" }];

const baseScenario: ScenarioDefinition = {
  id: "support.timeout-test",
  name: "Timeout test",
  suite: "support",
  task: {
    instructions: "wait",
    success_hint: "finish quickly",
  },
  tools: {
    allowed: ["support.wait"],
  },
  runtime: {
    max_steps: 3,
    timeout_seconds: 1,
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
    return { type: "final", output: "done" } as const;
  }
}

class ForbiddenToolSession implements AgentSession {
  async next() {
    return { type: "tool_call", toolName: "orders.refund_all", input: {} } as const;
  }
}

const noopAdapter: AgentAdapter = {
  async startRun(_input: AgentRunInput) {
    return new ToolCallingSession();
  },
};

test("runner marks timeout_exceeded when a tool exceeds timeout_seconds", async () => {
  const bundle = await runScenario({
    agentAdapter: noopAdapter,
    agentVersion,
    scenario: baseScenario,
    scenarioFileHash: "hash_1",
    toolSpecs,
    tools: {
      "support.wait": async () => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return { ok: true };
      },
    },
  });

  assert.equal(bundle.run.status, "error");
  assert.equal(bundle.run.terminationReason, "timeout_exceeded");
  assert.ok(bundle.traceEvents.some((event) => event.type === "timeout_exceeded"));
});

test("runner fails on forbidden tool attempts", async () => {
  const bundle = await runScenario({
    agentAdapter: {
      async startRun() {
        return new ForbiddenToolSession();
      },
    },
    agentVersion,
    scenario: {
      ...baseScenario,
      tools: {
        allowed: ["support.wait"],
        forbidden: ["orders.refund_all"],
      },
    },
    scenarioFileHash: "hash_1",
    toolSpecs,
    tools: {
      "support.wait": async () => ({ ok: true }),
    },
  });

  assert.equal(bundle.run.status, "fail");
  assert.equal(bundle.run.terminationReason, "forbidden_tool_used");
});
