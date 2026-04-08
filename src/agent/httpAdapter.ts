import { performance } from "node:perf_hooks";

export function interpolateTemplate(template: string, message: string, conversationId: string): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
    const k = key.trim();
    if (k === "message") return message;
    if (k === "conversation_id") return conversationId;
    if (k.startsWith("env.")) return process.env[k.slice(4)] ?? "";
    return "";
  });
}

export function buildRequestBody(
  template: Record<string, string> | undefined,
  message: string,
  conversationId: string,
): Record<string, string> {
  if (!template) {
    return { message, conversation_id: conversationId };
  }
  const result: Record<string, string> = {};
  for (const [field, valueTemplate] of Object.entries(template)) {
    result[field] = interpolateTemplate(valueTemplate, message, conversationId);
  }
  return result;
}

export function extractReply(body: unknown, responseField: string | undefined): string | null {
  const field = responseField ?? "message";
  if (typeof body === "object" && body !== null && field in body) {
    const value = (body as Record<string, unknown>)[field];
    return typeof value === "string" ? value : null;
  }
  return null;
}

type CallHttpAgentInput = {
  url: string;
  message: string;
  conversationId: string;
  request_template?: Record<string, string>;
  response_field?: string;
  headers?: Record<string, string>;
  timeout_ms?: number;
};

export async function callHttpAgent(
  input: CallHttpAgentInput,
): Promise<{ reply: string; latencyMs: number }> {
  const { url, message, conversationId, request_template, response_field, headers = {}, timeout_ms = 30000 } = input;
  const body = buildRequestBody(request_template, message, conversationId);

  const interpolatedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    interpolatedHeaders[key] = interpolateTemplate(value, message, conversationId);
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeout_ms);
  const start = performance.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...interpolatedHeaders },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutHandle);
    if (error instanceof Error && error.name === "AbortError") {
      throw Object.assign(new Error(`Request to ${url} timed out after ${timeout_ms}ms`), { code: "timeout_exceeded" });
    }
    throw Object.assign(
      new Error(`Connection to ${url} failed: ${error instanceof Error ? error.message : String(error)}`),
      { code: "http_connection_failed" },
    );
  }
  clearTimeout(timeoutHandle);

  const latencyMs = Math.round(performance.now() - start);

  if (!response.ok) {
    throw Object.assign(new Error(`HTTP ${response.status} from ${url}`), {
      code: "http_error",
      httpStatus: response.status,
    });
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw Object.assign(new Error(`Response from ${url} is not valid JSON`), { code: "invalid_response_format" });
  }

  const reply = extractReply(parsed, response_field);
  if (reply === null) {
    const field = response_field ?? "message";
    throw Object.assign(
      new Error(`Response from ${url} missing expected field '${field}'`),
      { code: "invalid_response_format" },
    );
  }

  return { reply, latencyMs };
}
