import React, { useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

type RunListItem = {
  id: string;
  scenarioId: string;
  suite: string;
  suiteBatchId?: string;
  variantSetName?: string;
  variantLabel?: string;
  agentVersionId: string;
  agentLabel?: string;
  provider?: string;
  modelId?: string;
  status: "pass" | "fail" | "error";
  score: number;
  durationMs: number;
  totalSteps: number;
  startedAt: string;
};

type RunDetail = {
  run: {
    id: string;
    scenarioId: string;
    status: string;
    score: number;
    durationMs: number;
    totalSteps: number;
    terminationReason: string;
    finalOutput: string;
    startedAt: string;
    variantSetName?: string;
    variantLabel?: string;
    promptVersion?: string;
    modelVersion?: string;
    toolSchemaVersion?: string;
    configLabel?: string;
    configHash?: string;
    runtimeProfileName?: string;
    suiteDefinitionName?: string;
  };
  agentVersion?: {
    provider?: string;
    modelId?: string;
    label: string;
    command?: string;
    args?: string[];
    variantSetName?: string;
    variantLabel?: string;
    promptVersion?: string;
    modelVersion?: string;
    toolSchemaVersion?: string;
    configLabel?: string;
    configHash?: string;
    runtimeProfileName?: string;
    suiteDefinitionName?: string;
  };
  evaluatorResults: Array<{ evaluatorId: string; status: string; message: string }>;
  toolCalls: Array<{ id: string; toolName: string; input: unknown; output?: unknown; status: string }>;
  traceEvents: Array<{ eventId: string; stepIndex: number; source: string; type: string; payload: Record<string, unknown> }>;
  errorDetail?: string;
};

type ComparePayload = {
  baseline: RunDetail;
  candidate: RunDetail;
  classification: string;
  verdictDelta: string;
  terminationDelta?: string;
  outputChanged: boolean;
  notes: string[];
  deltas: {
    score: number;
    runtimeMs: number;
    steps: number;
    runtimePct: number;
  };
  evaluatorDiffs: Array<{
    evaluatorId: string;
    hardGate: boolean;
    weight?: number;
    baselineStatus?: string;
    candidateStatus?: string;
    note: string;
  }>;
  toolDiffs: Array<{
    toolName: string;
    baselineCount: number;
    candidateCount: number;
    risk: string;
    note: string;
  }>;
};

type SuiteComparisonPayload = {
  suite: string;
  baselineBatchId: string;
  candidateBatchId: string;
  classification: string;
  notes: string[];
  deltas: {
    pass: number;
    fail: number;
    error: number;
    averageScore: number;
    averageRuntimeMs: number;
    averageSteps: number;
  };
  regressions: Array<{ scenarioId: string; comparison: ComparePayload }>;
  improvements: Array<{ scenarioId: string; comparison: ComparePayload }>;
  unchanged: Array<{ scenarioId: string; comparison: ComparePayload }>;
  missingFromCandidate: string[];
  missingFromBaseline: string[];
};

type Route =
  | { type: "list" }
  | { type: "detail"; runId: string }
  | { type: "compare"; baseline?: string; candidate?: string }
  | { type: "compare-suite"; baselineBatch?: string; candidateBatch?: string };

// ── Routing ────────────────────────────────────────────────────────────────────

function getRoute(): Route {
  const url = new URL(window.location.href);
  if (url.pathname.startsWith("/runs/")) {
    return { type: "detail", runId: decodeURIComponent(url.pathname.slice("/runs/".length)) };
  }
  if (url.pathname === "/compare-suite") {
    return {
      type: "compare-suite",
      baselineBatch: url.searchParams.get("baselineBatch") ?? undefined,
      candidateBatch: url.searchParams.get("candidateBatch") ?? undefined,
    };
  }
  if (url.pathname === "/compare") {
    return {
      type: "compare",
      baseline: url.searchParams.get("baseline") ?? undefined,
      candidate: url.searchParams.get("candidate") ?? undefined,
    };
  }
  return { type: "list" };
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function sc(status: string): string {
  if (status === "pass") return "p";
  if (status === "fail") return "f";
  return "w";
}

function scColor(status: string): string {
  if (status === "pass") return "var(--pass)";
  if (status === "fail") return "var(--fail)";
  return "var(--warn)";
}

function dur(ms: number): string {
  if (ms >= 10000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function rel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function avgScore(runs: RunListItem[]): string {
  if (runs.length === 0) return "—";
  return (runs.reduce((s, r) => s + r.score, 0) / runs.length).toFixed(2);
}

function riskClass(risk: string): string {
  if (risk === "high") return "miss";
  if (risk === "medium") return "extra";
  return "match";
}

function getEventKind(type: string): string {
  if (type === "tool_call" || type === "tool_result") return "tool";
  if (type.startsWith("assistant")) return "asst";
  if (type.startsWith("eval")) return "eval";
  return "user";
}

function getEventLabel(type: string): string {
  const map: Record<string, string> = {
    tool_call: "Tool",
    tool_result: "Result",
    assistant_turn: "Assistant",
    user_turn: "User",
    evaluator_result: "Eval",
    evaluator_results: "Eval",
  };
  return map[type] ?? type.replace(/_/g, " ");
}

function getEventTitle(event: RunDetail["traceEvents"][0]): string {
  const p = event.payload;
  if (event.type === "tool_call") {
    return String(p.tool_name ?? p.toolName ?? p.name ?? "tool call");
  }
  if (event.type === "tool_result") {
    return `${String(p.tool_name ?? p.toolName ?? "tool")} → ${String(p.status ?? "ok")}`;
  }
  if (event.type === "assistant_turn") {
    const content = String(p.content ?? p.text ?? "");
    return content.slice(0, 80) || "assistant response";
  }
  if (event.type === "user_turn") {
    const content = String(p.content ?? p.text ?? "");
    return content.slice(0, 80) || "user message";
  }
  return event.type.replace(/_/g, " ");
}

function getEventBody(event: RunDetail["traceEvents"][0]): string | null {
  const p = event.payload;
  if (Object.keys(p).length === 0) return null;
  if (event.type === "assistant_turn" || event.type === "user_turn") {
    const content = String(p.content ?? p.text ?? "");
    if (content.length > 80) return content;
    const other = Object.fromEntries(
      Object.entries(p).filter(([k]) => k !== "content" && k !== "text"),
    );
    return Object.keys(other).length > 0 ? JSON.stringify(other, null, 2) : null;
  }
  return JSON.stringify(p, null, 2);
}

// ── App ────────────────────────────────────────────────────────────────────────

export function App(): React.JSX.Element {
  const route = getRoute();

  return (
    <div className="shell">
      <Chrome route={route} />
      {route.type === "list" ? <RunsView /> : null}
      {route.type === "detail" ? <DetailView runId={route.runId} /> : null}
      {route.type === "compare" ? (
        <CompareView baseline={route.baseline} candidate={route.candidate} />
      ) : null}
      {route.type === "compare-suite" ? (
        <SuiteCompareView
          baselineBatch={route.baselineBatch}
          candidateBatch={route.candidateBatch}
        />
      ) : null}
    </div>
  );
}

// ── Chrome ─────────────────────────────────────────────────────────────────────

function Chrome({ route }: { route: Route }): React.JSX.Element {
  return (
    <header className="chrome">
      <a className="brand" href="/">
        ARL
      </a>
      <span className="brand-meta">agentlab v0.4.0</span>
      <nav className="nav">
        <a className={`nv-btn${route.type === "list" ? " on" : ""}`} href="/">
          Runs
        </a>
        {route.type === "detail" ? (
          <span className="nv-btn on">Detail</span>
        ) : null}
        {route.type === "compare" || route.type === "compare-suite" ? (
          <span className="nv-btn on">Compare</span>
        ) : null}
      </nav>
      <div className="live">
        <span className="live-dot" />
        <span>LIVE</span>
      </div>
    </header>
  );
}

// ── RunsView ───────────────────────────────────────────────────────────────────

function RunsView(): React.JSX.Element {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetch("/api/runs")
      .then((r) => r.json())
      .then((data) => setRuns(Array.isArray(data.runs) ? data.runs : []));
  }, []);

  const filtered = filter
    ? runs.filter(
        (r) =>
          r.scenarioId.toLowerCase().includes(filter.toLowerCase()) ||
          r.suite.toLowerCase().includes(filter.toLowerCase()),
      )
    : runs;

  const stats = summarizeRuns(runs);

  return (
    <div className="view-body">
      <aside className="sidebar">
        <div className="sb-head">
          <div className="sb-kicker">Session</div>
          <div className="sb-title">
            Agent <em>Regression</em>
            <br />
            Lab
          </div>
          <div className="tally">
            <div className="t-cell">
              <div className={`t-v${stats.pass > 0 ? " p" : ""}`}>{stats.pass}</div>
              <div className="t-l">Pass</div>
            </div>
            <div className="t-cell">
              <div className={`t-v${stats.fail > 0 ? " f" : ""}`}>{stats.fail}</div>
              <div className="t-l">Fail</div>
            </div>
            <div className="t-cell">
              <div className={`t-v${stats.error > 0 ? " w" : ""}`}>{stats.error}</div>
              <div className="t-l">Error</div>
            </div>
          </div>
        </div>
        <div className="sb-filter">
          <div className="filt">
            <span className="filt-i">/</span>
            <input
              ref={inputRef}
              className="filt-in"
              placeholder="filter scenarios…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>
        <div className="run-list">
          {filtered.length === 0 && runs.length === 0 ? (
            <div className="run-list-empty">No runs yet. Run a scenario from the CLI.</div>
          ) : null}
          {filtered.map((run, i) => (
            <a key={run.id} className={`run ${sc(run.status)}`} href={`/runs/${run.id}`}>
              <div className="run-name">
                <span className={`run-dot ${sc(run.status)}`} />
                <span className="run-name-text">{run.scenarioId}</span>
              </div>
              <div className={`run-score ${sc(run.status)}`}>{run.score.toFixed(1)}</div>
              <div className="run-meta">
                {run.suite}
                <span style={{ color: "var(--ink-lo)", margin: "0 3px" }}>·</span>
                {dur(run.durationMs)}
                {i > 0 && filtered[i - 1].scenarioId === run.scenarioId ? (
                  <span style={{ marginLeft: "6px" }}>
                    <a
                      href={`/compare?baseline=${filtered[i - 1].id}&candidate=${run.id}`}
                      style={{ color: "var(--accent)", fontSize: ".65rem" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      compare prev
                    </a>
                  </span>
                ) : null}
              </div>
            </a>
          ))}
        </div>
      </aside>

      <main className="main">
        <div className="cmd">
          <span className="cmd-p">$</span>
          <span className="cmd-t">
            agentlab <span className="w">list</span>
            <span className="cmd-caret" />
          </span>
          <div className="cmd-r">
            <span>
              <kbd>↵</kbd>open
            </span>
            <span>
              <kbd>c</kbd>compare
            </span>
            <span>
              <kbd>/</kbd>filter
            </span>
          </div>
        </div>
        <div className="scroll">
          {runs.length === 0 ? (
            <EmptyIdle />
          ) : (
            <>
              <div className="ov-hero">
                <div className="oh-eyebrow">Session overview</div>
                <div className="oh-num">
                  {stats.total}
                  <span className="unit">runs</span>
                </div>
                <p className="oh-sub">
                  <span className="hi">{stats.pass} passed</span>, {stats.fail} failed,{" "}
                  {stats.error} {stats.error === 1 ? "error" : "errors"}. Average score{" "}
                  <span className="hi">{avgScore(runs)}</span>.
                </p>
              </div>
              <div className="chart-wrap">
                <div className="chart-h">
                  <span>Score over time</span>
                  <span className="chart-h-r">{runs.length} samples</span>
                </div>
                <ScoreChart runs={runs} />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ── DetailView ─────────────────────────────────────────────────────────────────

function DetailView({ runId }: { runId: string }): React.JSX.Element {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [siblings, setSiblings] = useState<RunListItem[]>([]);

  useEffect(() => {
    void fetch(`/api/runs/${runId}`)
      .then((r) => r.json())
      .then((data: RunDetail) => {
        setDetail(data);
        return fetch("/api/runs")
          .then((r) => r.json())
          .then((all) => {
            const items: RunListItem[] = Array.isArray(all.runs) ? all.runs : [];
            setSiblings(items.filter((r) => r.scenarioId === data.run.scenarioId));
          });
      });
  }, [runId]);

  return (
    <div className="view-body">
      <aside className="sidebar">
        <div className="sb-head">
          <div className="sb-kicker">Run · {runId.slice(0, 8)}</div>
          {detail ? (
            <>
              <div className="sb-title">
                {detail.run.scenarioId.split("-")[0]}
                <br />
                <em>—{detail.run.scenarioId.split("-").slice(1).join("-")}</em>
              </div>
              <div className="tally">
                <div className="t-cell">
                  <div className={`t-v ${sc(detail.run.status)}`}>
                    {detail.run.score.toFixed(1)}
                  </div>
                  <div className="t-l">Score</div>
                </div>
                <div className="t-cell">
                  <div className="t-v">{detail.run.totalSteps}</div>
                  <div className="t-l">Steps</div>
                </div>
                <div className="t-cell">
                  <div className="t-v">{dur(detail.run.durationMs)}</div>
                  <div className="t-l">Time</div>
                </div>
              </div>
            </>
          ) : (
            <div className="sb-title">
              <em>Loading…</em>
            </div>
          )}
        </div>
        <div className="run-list">
          {siblings.map((run) => (
            <a
              key={run.id}
              className={`run ${sc(run.status)}${run.id === runId ? " on" : ""}`}
              href={`/runs/${run.id}`}
            >
              <div className="run-name">
                <span className={`run-dot ${sc(run.status)}`} />
                <span className="run-name-text">{run.id.slice(0, 12)}</span>
              </div>
              <div className={`run-score ${sc(run.status)}`}>{run.score.toFixed(1)}</div>
              <div className="run-meta">
                {run.id === runId ? (
                  <span style={{ color: "var(--accent)" }}>current</span>
                ) : (
                  rel(run.startedAt)
                )}
              </div>
            </a>
          ))}
        </div>
      </aside>

      <main className="main">
        <div className="cmd">
          <span className="cmd-p">$</span>
          <span className="cmd-t">
            agentlab <span className="w">show</span> {runId}
            <span className="cmd-caret" />
          </span>
          <div className="cmd-r">
            <span>
              <kbd>←</kbd>back
            </span>
            <span>
              <kbd>c</kbd>compare
            </span>
          </div>
        </div>
        <div className="scroll">
          {!detail ? (
            <div className="empty">
              <div className="em-title">Loading…</div>
            </div>
          ) : (
            <>
              <div className="dh">
                <div className={`dh-score ${sc(detail.run.status)}`}>
                  {detail.run.score.toFixed(1)}
                </div>
                <div className="dh-meta">
                  <div className="dh-kicker">
                    {detail.agentVersion?.provider ?? "agent"}
                  </div>
                  <div className="dh-title">{detail.run.scenarioId}</div>
                  <div className="dh-row">
                    <span>
                      <span className="d">model</span>{" "}
                      <span className="v">{detail.agentVersion?.modelId ?? "—"}</span>
                    </span>
                    <span>
                      <span className="d">runtime</span>{" "}
                      <span className="v">{dur(detail.run.durationMs)}</span>
                    </span>
                    <span>
                      <span className="d">evals</span>{" "}
                      <span className="v">
                        {detail.evaluatorResults.filter((e) => e.status === "pass").length} /{" "}
                        {detail.evaluatorResults.length}
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {detail.run.status !== "pass" ? <FailureBlock detail={detail} /> : null}

              <div className="trace-section">
                <div className="ts-head">
                  <div className="ts-title">
                    Trace
                    <span
                      className={`ts-badge ts-badge-${detail.run.status === "pass" ? "complete" : "fail"}`}
                    >
                      {detail.run.status === "pass" ? "complete" : "failed"}
                    </span>
                  </div>
                  <div className="ts-stats">
                    <span className="v">{detail.traceEvents.length}</span> steps ·{" "}
                    <span className="v">{dur(detail.run.durationMs)}</span>
                  </div>
                </div>
                <TraceTimeline events={detail.traceEvents} />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ── CompareView ────────────────────────────────────────────────────────────────

function CompareView({
  baseline,
  candidate,
}: {
  baseline?: string;
  candidate?: string;
}): React.JSX.Element {
  const [data, setData] = useState<ComparePayload | null>(null);

  useEffect(() => {
    if (!baseline || !candidate) return;
    const url = new URL("/api/compare", window.location.origin);
    url.searchParams.set("baseline", baseline);
    url.searchParams.set("candidate", candidate);
    void fetch(url)
      .then((r) => r.json())
      .then((p) => setData(p as ComparePayload));
  }, [baseline, candidate]);

  if (!baseline || !candidate) {
    return (
      <div className="view-body">
        <main className="main" style={{ width: "100%" }}>
          <div className="cmd">
            <span className="cmd-p">$</span>
            <span className="cmd-t" style={{ color: "var(--ink-lo)" }}>
              agentlab compare …<span className="cmd-caret" />
            </span>
          </div>
          <EmptyIdle />
        </main>
      </div>
    );
  }

  const tone = data
    ? data.classification.includes("regress")
      ? "fail"
      : data.classification.includes("improv")
        ? "pass"
        : "neutral"
    : "neutral";

  const toneColor =
    tone === "fail" ? "var(--fail)" : tone === "pass" ? "var(--pass)" : "var(--ink-mid)";

  return (
    <div className="view-body">
      <aside className="sidebar">
        <div className="sb-head">
          <div className="sb-kicker" style={{ color: toneColor }}>
            {data?.classification ?? "Comparing…"}
          </div>
          <div className="sb-title" style={{ color: tone === "neutral" ? "var(--ink)" : toneColor }}>
            {data
              ? (data.deltas.score >= 0 ? "+" : "") + data.deltas.score.toFixed(2)
              : "—"}
            <br />
            <em style={{ color: toneColor }}>delta</em>
          </div>
          {data ? (
            <div className="tally">
              <div className="t-cell">
                <div className="t-v p">{data.baseline.run.score.toFixed(1)}</div>
                <div className="t-l">Base</div>
              </div>
              <div className="t-cell">
                <div className={`t-v ${sc(data.candidate.run.status)}`}>
                  {data.candidate.run.score.toFixed(1)}
                </div>
                <div className="t-l">Cand</div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="run-list">
          {data ? (
            <>
              <a className="run p" href={`/runs/${data.baseline.run.id}`}>
                <div className="run-name">
                  <span className="run-dot p" />
                  <span className="run-name-text">{data.baseline.run.id.slice(0, 12)} · base</span>
                </div>
                <div className="run-score p">{data.baseline.run.score.toFixed(1)}</div>
                <div className="run-meta">{data.baseline.run.totalSteps} steps</div>
              </a>
              <a
                className={`run on ${sc(data.candidate.run.status)}`}
                href={`/runs/${data.candidate.run.id}`}
              >
                <div className="run-name">
                  <span className={`run-dot ${sc(data.candidate.run.status)}`} />
                  <span className="run-name-text">
                    {data.candidate.run.id.slice(0, 12)} · cand
                  </span>
                </div>
                <div className={`run-score ${sc(data.candidate.run.status)}`}>
                  {data.candidate.run.score.toFixed(1)}
                </div>
                <div className="run-meta">{data.candidate.run.totalSteps} steps</div>
              </a>
            </>
          ) : null}
        </div>
      </aside>

      <main className="main">
        <div className="cmd">
          <span className="cmd-p">$</span>
          <span className="cmd-t">
            agentlab <span className="w">compare</span> {baseline.slice(0, 8)}{" "}
            <span className="w">→</span> {candidate.slice(0, 8)}
            <span className="cmd-caret" />
          </span>
          <div className="cmd-r">
            <span>
              <kbd>←</kbd>back
            </span>
          </div>
        </div>
        <div className="scroll">
          {!data ? (
            <div className="empty">
              <div className="em-title">Loading comparison…</div>
            </div>
          ) : (
            <>
              <div className="cmp-hero">
                <div className="cmp-eyebrow" style={{ color: toneColor }}>
                  {tone === "fail"
                    ? "Regression detected"
                    : tone === "pass"
                      ? "Improvement"
                      : data.classification}{" "}
                  · {data.baseline.run.scenarioId}
                </div>
                <div className="cmp-grid">
                  <div className="cmp-side">
                    <div className="cmp-side-label">
                      <span className="v">baseline</span> · {baseline.slice(0, 6)}
                    </div>
                    <div className="cmp-side-score" style={{ color: "var(--pass)" }}>
                      {data.baseline.run.score.toFixed(1)}
                    </div>
                  </div>
                  <div>
                    <div className="cmp-arrow" style={{ color: toneColor }}>
                      →
                    </div>
                    <div className="cmp-delta" style={{ color: toneColor }}>
                      {data.deltas.score >= 0 ? "+" : ""}
                      {data.deltas.score.toFixed(2)}
                    </div>
                  </div>
                  <div className="cmp-side r">
                    <div className="cmp-side-label">
                      <span className="v">candidate</span> · {candidate.slice(0, 6)}
                    </div>
                    <div
                      className="cmp-side-score"
                      style={{ color: scColor(data.candidate.run.status) }}
                    >
                      {data.candidate.run.score.toFixed(1)}
                    </div>
                  </div>
                </div>
                {data.notes.length > 0 ? (
                  <>
                    <div className="cmp-verdict">{data.notes[0]}</div>
                    {data.notes.length > 1 ? (
                      <div className="cmp-verdict-sub">{data.notes.slice(1).join(" · ")}</div>
                    ) : null}
                  </>
                ) : null}
              </div>

              {data.toolDiffs.length > 0 ? (
                <div className="diverge">
                  <div className="dv-h">Tool-call timeline</div>
                  {data.toolDiffs.map((diff) => (
                    <div key={diff.toolName} className="dv-track">
                      <div className="dv-label">{diff.toolName}</div>
                      <div className="dv-steps">
                        <div className={`dv-step ${riskClass(diff.risk)}`}>
                          base: {diff.baselineCount}
                        </div>
                        <div className={`dv-step ${riskClass(diff.risk)}`}>
                          cand: {diff.candidateCount}
                        </div>
                        <div className={`dv-step ${riskClass(diff.risk)}`} style={{ flex: 4 }}>
                          {diff.note}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {data.evaluatorDiffs.length > 0 ? (
                <div className="diffs">
                  <div className="diffs-h">Evaluator changes</div>
                  {data.evaluatorDiffs.map((diff) => (
                    <div key={diff.evaluatorId} className="diff-row">
                      <div className="df-label">{diff.evaluatorId}</div>
                      <div className="df-cell base">{diff.baselineStatus ?? "—"}</div>
                      <div className="df-arrow">→</div>
                      <div className="df-cell cand">{diff.candidateStatus ?? "—"}</div>
                    </div>
                  ))}
                </div>
              ) : null}

              {data.outputChanged ? (
                <div className="diffs">
                  <div className="diffs-h">Output diff</div>
                  <div className="diff-row">
                    <div className="df-label">Final output</div>
                    <div className="df-cell base">
                      {data.baseline.run.finalOutput || "(none)"}
                    </div>
                    <div className="df-arrow">→</div>
                    <div className="df-cell cand">
                      {data.candidate.run.finalOutput || "(none)"}
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ── SuiteCompareView ───────────────────────────────────────────────────────────

function SuiteCompareView({
  baselineBatch,
  candidateBatch,
}: {
  baselineBatch?: string;
  candidateBatch?: string;
}): React.JSX.Element {
  const [data, setData] = useState<SuiteComparisonPayload | null>(null);

  useEffect(() => {
    if (!baselineBatch || !candidateBatch) return;
    const url = new URL("/api/compare-suite", window.location.origin);
    url.searchParams.set("baselineBatch", baselineBatch);
    url.searchParams.set("candidateBatch", candidateBatch);
    void fetch(url)
      .then((r) => r.json())
      .then((p) => setData(p as SuiteComparisonPayload));
  }, [baselineBatch, candidateBatch]);

  if (!baselineBatch || !candidateBatch) {
    return (
      <div className="view-body">
        <main className="main" style={{ width: "100%" }}>
          <div className="cmd">
            <span className="cmd-p">$</span>
            <span className="cmd-t" style={{ color: "var(--ink-lo)" }}>
              agentlab compare --suite …<span className="cmd-caret" />
            </span>
          </div>
          <EmptyIdle />
        </main>
      </div>
    );
  }

  return (
    <div className="view-body">
      <aside className="sidebar">
        <div className="sb-head">
          <div className="sb-kicker">Suite Compare</div>
          <div className="sb-title">
            {data?.suite ?? "Loading…"}
            <br />
            <em>{data?.classification ?? ""}</em>
          </div>
          {data ? (
            <div className="tally">
              <div className="t-cell">
                <div className={`t-v${data.regressions.length > 0 ? " f" : ""}`}>
                  {data.regressions.length}
                </div>
                <div className="t-l">Regress</div>
              </div>
              <div className="t-cell">
                <div className={`t-v${data.improvements.length > 0 ? " p" : ""}`}>
                  {data.improvements.length}
                </div>
                <div className="t-l">Improve</div>
              </div>
              <div className="t-cell">
                <div className="t-v">{data.unchanged.length}</div>
                <div className="t-l">Same</div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="run-list">
          {data
            ? [
                ...data.regressions.map((item) => ({
                  ...item,
                  kind: "fail" as const,
                })),
                ...data.improvements.map((item) => ({
                  ...item,
                  kind: "pass" as const,
                })),
              ].map((item) => (
                <a
                  key={item.scenarioId}
                  className={`run ${item.kind}`}
                  href={`/compare?baseline=${item.comparison.baseline.run.id}&candidate=${item.comparison.candidate.run.id}`}
                >
                  <div className="run-name">
                    <span className={`run-dot ${item.kind}`} />
                    <span className="run-name-text">{item.scenarioId}</span>
                  </div>
                  <div className={`run-score ${item.kind}`}>
                    {item.comparison.candidate.run.score.toFixed(1)}
                  </div>
                  <div className="run-meta">{item.comparison.classification}</div>
                </a>
              ))
            : null}
        </div>
      </aside>

      <main className="main">
        <div className="cmd">
          <span className="cmd-p">$</span>
          <span className="cmd-t">
            agentlab <span className="w">compare</span> --suite {baselineBatch.slice(0, 8)}{" "}
            <span className="w">→</span> {candidateBatch.slice(0, 8)}
            <span className="cmd-caret" />
          </span>
          <div className="cmd-r">
            <span>
              <kbd>←</kbd>back
            </span>
          </div>
        </div>
        <div className="scroll">
          {!data ? (
            <div className="empty">
              <div className="em-title">Loading suite comparison…</div>
            </div>
          ) : (
            <>
              <div className="ov-hero">
                <div className="oh-eyebrow">Suite · {data.suite}</div>
                <div className="oh-num">
                  {data.regressions.length + data.improvements.length + data.unchanged.length}
                  <span className="unit">scenarios</span>
                </div>
                <p className="oh-sub">
                  <span className="hi">{data.improvements.length} improved</span>,{" "}
                  {data.regressions.length} regressed, {data.unchanged.length} unchanged. Score
                  delta{" "}
                  <span className="hi">
                    {data.deltas.averageScore >= 0 ? "+" : ""}
                    {data.deltas.averageScore.toFixed(2)}
                  </span>
                  .
                </p>
              </div>

              {data.regressions.length > 0 ? (
                <div className="diffs">
                  <div className="diffs-h">Regressions</div>
                  {data.regressions.map((item) => (
                    <div key={item.scenarioId} className="diff-row">
                      <div className="df-label">{item.scenarioId}</div>
                      <div className="df-cell base">
                        {item.comparison.baseline.run.score.toFixed(1)}
                      </div>
                      <div className="df-arrow">→</div>
                      <div className="df-cell cand">
                        <a
                          href={`/compare?baseline=${item.comparison.baseline.run.id}&candidate=${item.comparison.candidate.run.id}`}
                          style={{ color: "var(--fail)" }}
                        >
                          {item.comparison.candidate.run.score.toFixed(1)} — view
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {data.improvements.length > 0 ? (
                <div className="diffs">
                  <div className="diffs-h">Improvements</div>
                  {data.improvements.map((item) => (
                    <div key={item.scenarioId} className="diff-row">
                      <div className="df-label">{item.scenarioId}</div>
                      <div className="df-cell base">
                        {item.comparison.baseline.run.score.toFixed(1)}
                      </div>
                      <div className="df-arrow">→</div>
                      <div
                        className="df-cell"
                        style={{
                          background: "color-mix(in srgb, var(--pass) 8%, transparent)",
                          border: "1px solid color-mix(in srgb, var(--pass) 25%, transparent)",
                        }}
                      >
                        <a
                          href={`/compare?baseline=${item.comparison.baseline.run.id}&candidate=${item.comparison.candidate.run.id}`}
                          style={{ color: "var(--pass)" }}
                        >
                          {item.comparison.candidate.run.score.toFixed(1)} — view
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {data.missingFromCandidate.length > 0 || data.missingFromBaseline.length > 0 ? (
                <div className="diffs">
                  <div className="diffs-h">Missing scenarios</div>
                  {data.missingFromCandidate.length > 0 ? (
                    <div className="diff-row">
                      <div className="df-label">From candidate</div>
                      <div
                        className="df-cell cand"
                        style={{ gridColumn: "2 / 5" }}
                      >
                        {data.missingFromCandidate.join(", ")}
                      </div>
                    </div>
                  ) : null}
                  {data.missingFromBaseline.length > 0 ? (
                    <div className="diff-row">
                      <div className="df-label">From baseline</div>
                      <div
                        className="df-cell base"
                        style={{ gridColumn: "2 / 5" }}
                      >
                        {data.missingFromBaseline.join(", ")}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ScoreChart({ runs }: { runs: RunListItem[] }): React.JSX.Element {
  const sorted = [...runs].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );
  if (sorted.length < 2) return <></>;

  const points = sorted.map((run, i) => ({
    x: 30 + (i / (sorted.length - 1)) * 900,
    y: 20 + (1 - run.score) * 100,
    status: run.status,
    id: run.id,
  }));

  let linePath = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const c = points[i];
    const cpx = (p.x + c.x) / 2;
    linePath += ` C${cpx},${p.y} ${cpx},${c.y} ${c.x},${c.y}`;
  }
  const last = points[points.length - 1];
  const first = points[0];
  const fillPath = `${linePath} L${last.x},140 L${first.x},140 Z`;
  const failPoints = points.filter((p) => p.status !== "pass");

  return (
    <svg viewBox="0 0 960 140" style={{ width: "100%", display: "block" }}>
      <defs>
        <linearGradient id="hz-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity=".18" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" y1="20" x2="960" y2="20" stroke="var(--line)" strokeDasharray="2 4" />
      <line x1="0" y1="70" x2="960" y2="70" stroke="var(--line)" strokeDasharray="2 4" />
      <line x1="0" y1="120" x2="960" y2="120" stroke="var(--line)" />
      <path d={fillPath} fill="url(#hz-fill)" />
      <path
        d={linePath}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.4"
        strokeLinecap="round"
        style={{
          filter: "drop-shadow(0 0 5px color-mix(in srgb, var(--accent) 50%, transparent))",
        }}
      />
      {failPoints.map((p) => (
        <circle
          key={p.id}
          cx={p.x}
          cy={p.y}
          r="4"
          fill="var(--bg)"
          stroke="var(--fail)"
          strokeWidth="1.5"
        />
      ))}
    </svg>
  );
}

function TraceTimeline({
  events,
}: {
  events: RunDetail["traceEvents"];
}): React.JSX.Element {
  return (
    <div className="trace">
      {events.map((event, i) => {
        const kind = getEventKind(event.type);
        const label = getEventLabel(event.type);
        const title = getEventTitle(event);
        const body = getEventBody(event);
        const isLast = i === events.length - 1;

        return (
          <div
            key={event.eventId}
            className="t-step"
            style={{ animationDelay: `${i * 55}ms` }}
          >
            <div className={`t-node${isLast ? " p" : " active"}`}>{i + 1}</div>
            <div className="t-head">
              <span className={`t-kind ${kind}`}>{label}</span>
              <span className="t-title">{title}</span>
            </div>
            {body ? <div className="t-body">{body}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function FailureBlock({ detail }: { detail: RunDetail }): React.JSX.Element {
  const failed = detail.evaluatorResults.filter((e) => e.status === "fail");
  return (
    <div className="failure-panel-block">
      <div className="fp-label">Failure</div>
      {detail.errorDetail ? (
        <div className="fp-item">{detail.errorDetail}</div>
      ) : null}
      {failed.map((e) => (
        <div key={e.evaluatorId} className="fp-item">
          <span className="fp-x">✗</span> {e.evaluatorId}: {e.message}
        </div>
      ))}
      {!detail.errorDetail && failed.length === 0 ? (
        <div className="fp-item">
          Run did not pass. Inspect the trace for the first divergence.
        </div>
      ) : null}
    </div>
  );
}

function EmptyIdle(): React.JSX.Element {
  return (
    <div className="empty">
      <div className="em-mark">ARL</div>
      <div className="em-title">Awaiting signal</div>
      <div className="em-sub">
        Run a scenario from the CLI and traces will appear here in real time.
      </div>
      <div className="em-cmd">agentlab run --scenario refund-flow</div>
    </div>
  );
}

// ── Legacy exports (kept for test compatibility) ───────────────────────────────

export function summarizeRuns(runs: RunListItem[]): {
  total: number;
  pass: number;
  fail: number;
  error: number;
  latestSuite: string;
  latestProvider: string;
} {
  return {
    total: runs.length,
    pass: runs.filter((r) => r.status === "pass").length,
    fail: runs.filter((r) => r.status === "fail").length,
    error: runs.filter((r) => r.status === "error").length,
    latestSuite: runs[0]?.suite ?? "-",
    latestProvider: runs[0]?.provider ?? "-",
  };
}

export function getFailureSummaryItems(detail: RunDetail): string[] {
  const items: string[] = [];
  if (detail.errorDetail) items.push(`Error: ${detail.errorDetail}`);
  for (const r of detail.evaluatorResults) {
    if (r.status === "fail") items.push(`Evaluator ${r.evaluatorId}: ${r.message}`);
  }
  if (detail.run.status !== "pass" && items.length === 0) {
    items.push("Run did not pass. Inspect evaluator results and trace for the first divergence.");
  }
  return items;
}

export function FailureSummaryPanel(props: { detail: RunDetail }): React.JSX.Element | null {
  const failureItems = getFailureSummaryItems(props.detail);
  if (failureItems.length === 0) return null;
  return (
    <section className="panel failure-panel">
      <h2>Failures First</h2>
      <p>
        <strong>Status:</strong>{" "}
        <span className={`pill ${props.detail.run.status}`}>{props.detail.run.status}</span>
      </p>
      <p>
        <strong>Termination:</strong> {props.detail.run.terminationReason}
      </p>
      <ul className="stack">
        {failureItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function RunIdentitySummary(props: { detail: RunDetail }): React.JSX.Element {
  const run = props.detail.run;
  return (
    <>
      <p>
        <strong>Variant set:</strong> {run.variantSetName ?? "-"}
      </p>
      <p>
        <strong>Variant:</strong> {run.variantLabel ?? "-"}
      </p>
      <p>
        <strong>Prompt version:</strong> {run.promptVersion ?? "-"}
      </p>
      <p>
        <strong>Model version:</strong> {run.modelVersion ?? "-"}
      </p>
      <p>
        <strong>Tool schema version:</strong> {run.toolSchemaVersion ?? "-"}
      </p>
      <p>
        <strong>Config label:</strong> {run.configLabel ?? "-"}
      </p>
      <p>
        <strong>Runtime profile:</strong> {run.runtimeProfileName ?? "-"}
      </p>
      <p>
        <strong>Suite definition:</strong> {run.suiteDefinitionName ?? "-"}
      </p>
    </>
  );
}

function LegacyStat(props: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="stat">
      <div className="muted">{props.label}</div>
      <div className="stat-value">{props.value}</div>
    </div>
  );
}

function mapClassificationToTone(classification: string): "pass" | "fail" | "error" | "neutral" {
  if (classification.includes("regress")) return "fail";
  if (classification.includes("improv")) return "pass";
  if (classification.includes("changed")) return "error";
  return "neutral";
}

export function ComparisonHero(props: { comparison: ComparePayload }): React.JSX.Element {
  const tone = mapClassificationToTone(props.comparison.classification);
  return (
    <section className={`panel compare-hero ${tone}`}>
      <div className="compare-hero-head">
        <h2>{props.comparison.classification}</h2>
        <span className={`pill ${tone}`}>{props.comparison.verdictDelta}</span>
      </div>
      <p className="muted">
        Output changed: {props.comparison.outputChanged ? "yes" : "no"}
        {props.comparison.terminationDelta ? ` • termination: ${props.comparison.terminationDelta}` : ""}
      </p>
    </section>
  );
}

export function SuiteComparisonHero(props: {
  data: SuiteComparisonPayload;
}): React.JSX.Element {
  return (
    <section className="panel compare-hero neutral">
      <div className="compare-hero-head">
        <h2>Suite movement</h2>
        <span className="event-chip">{props.data.classification}</span>
      </div>
      <div className="stats compact-stats">
        <LegacyStat label="Regressions" value={props.data.regressions.length} />
        <LegacyStat label="Improvements" value={props.data.improvements.length} />
        <LegacyStat label="Unchanged" value={props.data.unchanged.length} />
      </div>
    </section>
  );
}
