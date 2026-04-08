import test from "node:test";
import assert from "node:assert";

import { validateHttpAgentConfig } from "../src/config.js";

test("http agent with url passes validation", () => {
  assert.doesNotThrow(() =>
    validateHttpAgentConfig({ name: "my-agent", provider: "http", url: "http://localhost:3000" })
  );
});

test("http agent without url fails validation", () => {
  assert.throws(
    () => validateHttpAgentConfig({ name: "my-agent", provider: "http" }),
    /url/
  );
});

test("http agent with invalid timeout_ms fails validation", () => {
  assert.throws(
    () => validateHttpAgentConfig({ name: "my-agent", provider: "http", url: "http://x", timeout_ms: -1 }),
    /timeout_ms/
  );
});

test("http agent with non-string request_template value fails validation", () => {
  assert.throws(
    () => validateHttpAgentConfig({ name: "my-agent", provider: "http", url: "http://x", request_template: { query: 123 } }),
    /request_template/
  );
});

test("http agent with non-string headers value fails validation", () => {
  assert.throws(
    () => validateHttpAgentConfig({ name: "my-agent", provider: "http", url: "http://x", headers: { Authorization: 42 } }),
    /headers/
  );
});

test("http agent with all optional fields passes validation", () => {
  assert.doesNotThrow(() =>
    validateHttpAgentConfig({
      name: "full-agent",
      provider: "http",
      url: "http://localhost:3000/api/chat",
      request_template: { query: "{{message}}", session: "{{conversation_id}}" },
      response_field: "reply",
      headers: { Authorization: "Bearer {{env.TOKEN}}" },
      timeout_ms: 10000,
    })
  );
});
