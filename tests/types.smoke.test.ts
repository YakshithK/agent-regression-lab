import test from "node:test";
import assert from "node:assert";
import type {
  ConversationScenarioDefinition,
  HttpAgentRegistration,
} from "../src/types.js";

test("ConversationScenarioDefinition shape is valid", () => {
  const scenario: ConversationScenarioDefinition = {
    type: "conversation",
    id: "support.order-tracking",
    name: "Order Tracking",
    suite: "support",
    steps: [{ role: "user", message: "Where is my order?" }],
  };
  assert.strictEqual(scenario.type, "conversation");
  assert.strictEqual(scenario.steps.length, 1);
});

test("HttpAgentRegistration shape is valid", () => {
  const reg: HttpAgentRegistration = {
    name: "my-agent",
    provider: "http",
    url: "http://localhost:3000/api/chat",
  };
  assert.strictEqual(reg.provider, "http");
});
