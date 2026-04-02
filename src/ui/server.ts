import { build } from "esbuild";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, resolve } from "node:path";

import { ensureDir } from "../lib/fs.js";
import { getRunErrorDetail } from "../runOutput.js";
import { Storage } from "../storage.js";

const UI_ROOT = resolve("artifacts", "ui");
const ASSETS_ROOT = resolve(UI_ROOT, "assets");
const PORT = 4173;

export async function startUiServer(): Promise<void> {
  await buildUiAssets();

  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(PORT, "127.0.0.1", () => resolvePromise());
  });

  console.log(`UI available at http://127.0.0.1:${PORT}`);
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `127.0.0.1:${PORT}`}`);

  if (url.pathname.startsWith("/api/")) {
    handleApi(url, response);
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    serveStatic(resolve(UI_ROOT, `.${url.pathname}`), response);
    return;
  }

  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(renderHtml());
}

function handleApi(url: URL, response: ServerResponse): void {
  const storage = new Storage();

  try {
    if (url.pathname === "/api/runs") {
      const payload = storage.listRuns({
        suite: url.searchParams.get("suite") || undefined,
        status: (url.searchParams.get("status") as "pass" | "fail" | "error" | null) ?? undefined,
        provider: url.searchParams.get("provider") || undefined,
      });
      sendJson(response, 200, { runs: payload });
      return;
    }

    if (url.pathname.startsWith("/api/runs/")) {
      const runId = decodeURIComponent(url.pathname.slice("/api/runs/".length));
      const bundle = storage.getRun(runId);
      if (!bundle) {
        sendJson(response, 404, { error: `Run '${runId}' not found.` });
        return;
      }

      sendJson(response, 200, {
        run: bundle.run,
        agentVersion: bundle.agentVersion,
        evaluatorResults: bundle.evaluatorResults,
        toolCalls: bundle.toolCalls,
        traceEvents: bundle.traceEvents,
        errorDetail: getRunErrorDetail(bundle),
      });
      return;
    }

    if (url.pathname === "/api/compare") {
      const baseline = url.searchParams.get("baseline");
      const candidate = url.searchParams.get("candidate");
      if (!baseline || !candidate) {
        sendJson(response, 400, { error: "Both 'baseline' and 'candidate' query params are required." });
        return;
      }

      const comparison = storage.compareRuns(baseline, candidate);
      sendJson(response, 200, {
        baseline: {
          ...comparison.baseline,
          errorDetail: getRunErrorDetail(comparison.baseline),
        },
        candidate: {
          ...comparison.candidate,
          errorDetail: getRunErrorDetail(comparison.candidate),
        },
        notes: comparison.notes,
        deltas: comparison.deltas,
        evaluatorDiffs: comparison.evaluatorDiffs,
        toolDiffs: comparison.toolDiffs,
      });
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function buildUiAssets(): Promise<void> {
  ensureDir(ASSETS_ROOT);
  await build({
    entryPoints: [resolve("src", "ui", "client.tsx")],
    outdir: ASSETS_ROOT,
    bundle: true,
    format: "esm",
    splitting: false,
    platform: "browser",
    sourcemap: false,
    logLevel: "silent",
    loader: {
      ".css": "css",
    },
  });
}

function serveStatic(path: string, response: ServerResponse): void {
  if (!existsSync(path)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const contentType = getContentType(path);
  response.writeHead(200, { "Content-Type": contentType });
  response.end(readFileSync(path));
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function renderHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agent Regression Lab Alpha</title>
    <link rel="stylesheet" href="/assets/client.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/client.js"></script>
  </body>
</html>`;
}

function getContentType(path: string): string {
  switch (extname(path)) {
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    default:
      return "text/plain; charset=utf-8";
  }
}
