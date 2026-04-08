import test from "node:test";
import assert from "node:assert";
import { createServer } from "node:http";
import type { Server } from "node:http";

import {
  interpolateTemplate,
  buildRequestBody,
  extractReply,
  callHttpAgent,
} from "../src/agent/httpAdapter.js";

// --- Unit tests for pure functions ---

test("interpolateTemplate substitutes {{message}}", () => {
  const result = interpolateTemplate("{{message}}", "hello", "conv-1");
  assert.strictEqual(result, "hello");
});

test("interpolateTemplate substitutes {{conversation_id}}", () => {
  const result = interpolateTemplate("{{conversation_id}}", "hello", "conv-1");
  assert.strictEqual(result, "conv-1");
});

test("interpolateTemplate substitutes {{env.VAR_NAME}}", () => {
  process.env.ARL_TEST_TOKEN = "secret";
  const result = interpolateTemplate("Bearer {{env.ARL_TEST_TOKEN}}", "hi", "c1");
  assert.strictEqual(result, "Bearer secret");
  delete process.env.ARL_TEST_TOKEN;
});

test("interpolateTemplate leaves unknown placeholders as empty string", () => {
  const result = interpolateTemplate("{{unknown}}", "hi", "c1");
  assert.strictEqual(result, "");
});

test("interpolateTemplate trims whitespace inside placeholders", () => {
  assert.strictEqual(interpolateTemplate("{{ message }}", "hello", "c1"), "hello");
  assert.strictEqual(interpolateTemplate("{{ conversation_id }}", "hello", "c1"), "c1");
  assert.strictEqual(interpolateTemplate("{{  message  }}", "hi", "c2"), "hi");
});

test("buildRequestBody uses default shape when no template", () => {
  const body = buildRequestBody(undefined, "Where is my order?", "conv-abc");
  assert.deepStrictEqual(body, { message: "Where is my order?", conversation_id: "conv-abc" });
});

test("buildRequestBody applies custom template", () => {
  const template = { query: "{{message}}", session: "{{conversation_id}}" };
  const body = buildRequestBody(template, "hello", "s-1");
  assert.deepStrictEqual(body, { query: "hello", session: "s-1" });
});

test("extractReply reads default 'message' field", () => {
  const reply = extractReply({ message: "got it" }, undefined);
  assert.strictEqual(reply, "got it");
});

test("extractReply reads custom response_field", () => {
  const reply = extractReply({ reply: "custom field" }, "reply");
  assert.strictEqual(reply, "custom field");
});

test("extractReply returns null when field missing", () => {
  const reply = extractReply({ other: "value" }, undefined);
  assert.strictEqual(reply, null);
});

// --- Integration tests with real HTTP servers ---

function startMockServer(
  handler: (body: unknown) => { status: number; body: unknown },
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let data = "";
      req.on("data", (chunk) => { data += chunk; });
      req.on("end", () => {
        const parsed = JSON.parse(data);
        const { status, body } = handler(parsed);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      });
    });
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, port });
    });
  });
}

test("callHttpAgent posts message and returns reply with latency", async () => {
  const { server, port } = await startMockServer(() => ({ status: 200, body: { message: "order shipped" } }));
  try {
    const result = await callHttpAgent({
      url: `http://localhost:${port}/chat`,
      message: "where is order",
      conversationId: "conv-1",
      timeout_ms: 5000,
    });
    assert.strictEqual(result.reply, "order shipped");
    assert.ok(result.latencyMs >= 0);
  } finally {
    server.close();
  }
});

test("callHttpAgent uses custom response_field", async () => {
  const { server, port } = await startMockServer(() => ({ status: 200, body: { answer: "it is here" } }));
  try {
    const result = await callHttpAgent({
      url: `http://localhost:${port}/chat`,
      message: "hi",
      conversationId: "c1",
      response_field: "answer",
      timeout_ms: 5000,
    });
    assert.strictEqual(result.reply, "it is here");
  } finally {
    server.close();
  }
});

test("callHttpAgent throws with code http_error on HTTP 500", async () => {
  const { server, port } = await startMockServer(() => ({ status: 500, body: { error: "boom" } }));
  try {
    await assert.rejects(
      () => callHttpAgent({ url: `http://localhost:${port}/chat`, message: "hi", conversationId: "c1", timeout_ms: 5000 }),
      (err: { code?: string }) => err.code === "http_error",
    );
  } finally {
    server.close();
  }
});

test("callHttpAgent throws with code invalid_response_format when field missing", async () => {
  const { server, port } = await startMockServer(() => ({ status: 200, body: { wrong_field: "value" } }));
  try {
    await assert.rejects(
      () => callHttpAgent({ url: `http://localhost:${port}/chat`, message: "hi", conversationId: "c1", timeout_ms: 5000 }),
      (err: { code?: string }) => err.code === "invalid_response_format",
    );
  } finally {
    server.close();
  }
});

test("callHttpAgent throws with code timeout_exceeded on timeout", async () => {
  const server = createServer((_req, _res) => { /* never respond */ });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await assert.rejects(
      () => callHttpAgent({ url: `http://localhost:${port}/chat`, message: "hi", conversationId: "c1", timeout_ms: 100 }),
      (err: { code?: string }) => err.code === "timeout_exceeded",
    );
  } finally {
    server.close();
  }
});
