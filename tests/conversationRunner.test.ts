import test from "node:test";
import assert from "node:assert";
import { createServer } from "node:http";
import type { Server } from "node:http";

import { runConversation } from "../src/conversationRunner.js";
import type { ConversationScenarioDefinition, HttpAgentRegistration, AgentVersion } from "../src/types.js";

function startEchoServer(
  replyFn: (body: unknown, callCount: number) => string,
): Promise<{ server: Server; port: number }> {
  let callCount = 0;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let data = "";
      req.on("data", (chunk) => { data += chunk; });
      req.on("end", () => {
        callCount += 1;
        const body = JSON.parse(data);
        const reply = replyFn(body, callCount);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: reply }));
      });
    });
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, port });
    });
  });
}

const baseScenario: ConversationScenarioDefinition = {
  type: "conversation",
  id: "test.conv",
  name: "Test Conversation",
  suite: "test",
  steps: [
    { role: "user", message: "Step 1" },
    { role: "user", message: "Step 2" },
  ],
};

function makeAgentVersion(url: string): AgentVersion {
  return {
    id: "agent_http_test",
    label: "http-test-agent",
    provider: "http",
    config: { url },
  };
}

test("runConversation produces a passing RunBundle when all steps succeed", async () => {
  const { server, port } = await startEchoServer(() => "ok reply");
  try {
    const httpConfig: HttpAgentRegistration = {
      name: "test-agent",
      provider: "http",
      url: `http://localhost:${port}/chat`,
    };
    const bundle = await runConversation({
      httpConfig,
      agentVersion: makeAgentVersion(httpConfig.url),
      scenario: baseScenario,
      scenarioFileHash: "testhash",
    });
    assert.strictEqual(bundle.run.status, "pass");
    assert.strictEqual(bundle.run.totalSteps, 2);
    assert.strictEqual(bundle.run.finalOutput, "ok reply");
    assert.ok(bundle.run.durationMs >= 0);
    assert.ok(bundle.traceEvents.length > 0);
    assert.strictEqual(bundle.run.totalToolCalls, 0);
  } finally {
    server.close();
  }
});

test("runConversation stops at step with hard_gate evaluator failure", async () => {
  const { server, port } = await startEchoServer((_, count) => (count === 1 ? "sorry I don't know" : "fine"));
  try {
    const scenario: ConversationScenarioDefinition = {
      ...baseScenario,
      steps: [
        {
          role: "user",
          message: "Step 1",
          evaluators: [
            { type: "response_not_contains", mode: "hard_gate", config: { keywords: ["don't know"] } },
          ],
        },
        { role: "user", message: "Step 2" },
      ],
    };
    const httpConfig: HttpAgentRegistration = {
      name: "test-agent",
      provider: "http",
      url: `http://localhost:${port}/chat`,
    };
    const bundle = await runConversation({
      httpConfig,
      agentVersion: makeAgentVersion(httpConfig.url),
      scenario,
      scenarioFileHash: "testhash",
    });
    assert.strictEqual(bundle.run.status, "fail");
    assert.strictEqual(bundle.run.terminationReason, "evaluator_failed");
    assert.strictEqual(bundle.run.totalSteps, 1);
  } finally {
    server.close();
  }
});

test("runConversation produces error status on HTTP 500", async () => {
  const server = createServer((_req, res) => { res.writeHead(500); res.end("error"); });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const httpConfig: HttpAgentRegistration = {
      name: "test-agent",
      provider: "http",
      url: `http://localhost:${port}/chat`,
    };
    const bundle = await runConversation({
      httpConfig,
      agentVersion: makeAgentVersion(httpConfig.url),
      scenario: baseScenario,
      scenarioFileHash: "testhash",
    });
    assert.strictEqual(bundle.run.status, "error");
    assert.strictEqual(bundle.run.terminationReason, "http_error");
    assert.strictEqual(bundle.run.score, 0);
  } finally {
    server.close();
  }
});

test("runConversation sends same conversation_id in every step", async () => {
  const receivedIds: string[] = [];
  const { server, port } = await startEchoServer((body) => {
    receivedIds.push((body as Record<string, string>).conversation_id);
    return "ok";
  });
  try {
    const httpConfig: HttpAgentRegistration = {
      name: "test-agent",
      provider: "http",
      url: `http://localhost:${port}/chat`,
    };
    await runConversation({
      httpConfig,
      agentVersion: makeAgentVersion(httpConfig.url),
      scenario: baseScenario,
      scenarioFileHash: "testhash",
    });
    assert.strictEqual(receivedIds.length, 2);
    assert.strictEqual(receivedIds[0], receivedIds[1]);
    assert.ok(receivedIds[0].length > 0);
  } finally {
    server.close();
  }
});

test("runConversation runs end-of-run evaluators on final reply", async () => {
  const { server, port } = await startEchoServer((_, count) => (count === 2 ? "goodbye" : "ok"));
  try {
    const scenario: ConversationScenarioDefinition = {
      ...baseScenario,
      evaluators: [
        { type: "final_answer_contains", mode: "hard_gate", config: { keywords: ["goodbye"] } },
      ],
    };
    const httpConfig: HttpAgentRegistration = {
      name: "test-agent",
      provider: "http",
      url: `http://localhost:${port}/chat`,
    };
    const bundle = await runConversation({
      httpConfig,
      agentVersion: makeAgentVersion(httpConfig.url),
      scenario,
      scenarioFileHash: "testhash",
    });
    assert.strictEqual(bundle.run.status, "pass");
    assert.strictEqual(bundle.evaluatorResults.length, 1);
    assert.strictEqual(bundle.evaluatorResults[0].status, "pass");
  } finally {
    server.close();
  }
});

test("runConversation trace includes conversation_started and conversation_finished events", async () => {
  const { server, port } = await startEchoServer(() => "ok");
  try {
    const httpConfig: HttpAgentRegistration = {
      name: "test-agent",
      provider: "http",
      url: `http://localhost:${port}/chat`,
    };
    const bundle = await runConversation({
      httpConfig,
      agentVersion: makeAgentVersion(httpConfig.url),
      scenario: baseScenario,
      scenarioFileHash: "testhash",
    });
    const types = bundle.traceEvents.map((e) => e.type);
    assert.ok(types.includes("conversation_started"));
    assert.ok(types.includes("conversation_finished"));
    assert.ok(types.includes("turn_started"));
    assert.ok(types.includes("turn_completed"));
  } finally {
    server.close();
  }
});
