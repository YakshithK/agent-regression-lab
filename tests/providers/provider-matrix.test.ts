import test from "node:test";
import assert from "node:assert";

import { loadAgentLabConfig } from "../../src/config.js";

test("root config includes representative shipped providers", () => {
  const config = loadAgentLabConfig();
  const providers = new Set((config.agents ?? []).map((agent) => agent.provider));

  assert.ok(providers.has("mock"));
  assert.ok(providers.has("openai"));
  assert.ok(providers.has("external_process"));
});
