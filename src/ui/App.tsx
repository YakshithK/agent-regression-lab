import React, { useEffect, useState } from "react";

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
  evaluatorDiffs: Array<{ evaluatorId: string; hardGate: boolean; weight?: number; baselineStatus?: string; candidateStatus?: string; note: string }>;
  toolDiffs: Array<{ toolName: string; baselineCount: number; candidateCount: number; risk: string; note: string }>;
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

export function App(): React.JSX.Element {
  const route = getRoute();

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/">
          Agent Regression Lab Alpha
        </a>
      </header>
      <main className="page">
        {route.type === "list" ? <RunListPage /> : null}
        {route.type === "detail" ? <RunDetailPage runId={route.runId} /> : null}
        {route.type === "compare" ? <ComparePage baseline={route.baseline} candidate={route.candidate} /> : null}
        {route.type === "compare-suite" ? <SuiteComparePage baselineBatch={route.baselineBatch} candidateBatch={route.candidateBatch} /> : null}
      </main>
    </div>
  );
}

function RunListPage(): React.JSX.Element {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [suite, setSuite] = useState("");
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");

  useEffect(() => {
    const url = new URL("/api/runs", window.location.origin);
    if (suite) url.searchParams.set("suite", suite);
    if (status) url.searchParams.set("status", status);
    if (provider) url.searchParams.set("provider", provider);

    void fetch(url)
      .then((response) => response.json())
      .then((data) => setRuns(Array.isArray(data.runs) ? data.runs : []));
  }, [suite, status, provider]);

  const stats = summarizeRuns(runs);

  return (
    <section>
      <div className="hero">
        <h1>Runs</h1>
        <p>Inspect local alpha runs, filter failures, and compare behavior changes.</p>
      </div>
      {runs.length > 0 ? (
        <div className="stats dashboard-stats">
          <Stat label="Runs shown" value={stats.total} />
          <Stat label="Passing" value={<span className="pass-text">{stats.pass}</span>} />
          <Stat label="Failing" value={<span className="fail-text">{stats.fail}</span>} />
          <Stat label="Errors" value={<span className="error-text">{stats.error}</span>} />
          <Stat label="Latest suite" value={stats.latestSuite} />
          <Stat label="Latest provider" value={stats.latestProvider} />
        </div>
      ) : null}
      <div className="filters">
        <input value={suite} onChange={(event) => setSuite(event.target.value)} placeholder="Suite" />
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
          <option value="error">Error</option>
        </select>
        <select value={provider} onChange={(event) => setProvider(event.target.value)}>
          <option value="">All providers</option>
          <option value="mock">Mock</option>
          <option value="openai">OpenAI</option>
          <option value="external_process">External process</option>
        </select>
      </div>
      {runs.length === 0 ? <EmptyState title="No runs yet" description="Run a scenario from the CLI to populate the lab." /> : null}
      {runs.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Scenario</th>
              <th>Provider</th>
              <th>Status</th>
              <th>Score</th>
              <th>Runtime</th>
              <th>Steps</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run, index) => (
              <tr key={run.id}>
                <td>
                  <a href={`/runs/${run.id}`}>{run.id}</a>
                </td>
                <td>{run.scenarioId}</td>
                <td>
                  {run.provider ?? "-"}
                  <div className="muted">{run.modelId ?? run.agentLabel ?? ""}</div>
                </td>
                <td>
                  <span className={`pill ${run.status}`}>{run.status}</span>
                </td>
                <td>{run.score}</td>
                <td>{run.durationMs}ms</td>
                <td>{run.totalSteps}</td>
                <td>
                  {new Date(run.startedAt).toLocaleString()}
                  {index > 0 && runs[index - 1].scenarioId === run.scenarioId ? (
                    <div className="muted">
                      <a href={`/compare?baseline=${runs[index - 1].id}&candidate=${run.id}`}>compare previous</a>
                    </div>
                  ) : null}
                  {index > 0 &&
                  runs[index - 1].suite === run.suite &&
                  runs[index - 1].suiteBatchId &&
                  run.suiteBatchId &&
                  runs[index - 1].suiteBatchId !== run.suiteBatchId ? (
                    <div className="muted">
                      <a href={`/compare-suite?baselineBatch=${runs[index - 1].suiteBatchId}&candidateBatch=${run.suiteBatchId}`}>compare suite batch</a>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

function RunDetailPage(props: { runId: string }): React.JSX.Element {
  const [detail, setDetail] = useState<RunDetail | null>(null);

  useEffect(() => {
    void fetch(`/api/runs/${props.runId}`)
      .then((response) => response.json())
      .then((data) => setDetail(data as RunDetail));
  }, [props.runId]);

  if (!detail) {
    return <EmptyState title="Loading run" description="Fetching run detail from the local lab." />;
  }

  return (
    <section>
      <div className="hero">
        <h1>{detail.run.id}</h1>
        <p>{detail.run.scenarioId}</p>
      </div>
      <FailureSummaryPanel detail={detail} />
      <div className="stats">
        <Stat label="Status" value={<span className={`pill ${detail.run.status}`}>{detail.run.status}</span>} />
        <Stat label="Score" value={detail.run.score} />
        <Stat label="Runtime" value={`${detail.run.durationMs}ms`} />
        <Stat label="Steps" value={detail.run.totalSteps} />
      </div>
      <div className="panel-grid">
        <section className="panel">
          <h2>Summary</h2>
          <p><strong>Provider:</strong> {detail.agentVersion?.provider ?? "-"}</p>
          <p><strong>Model:</strong> {detail.agentVersion?.modelId ?? "-"}</p>
          <RunIdentitySummary detail={detail} />
          {detail.agentVersion?.command ? (
            <p><strong>Command:</strong> {detail.agentVersion.command} {(detail.agentVersion.args ?? []).join(" ")}</p>
          ) : null}
          <p><strong>Termination:</strong> {detail.run.terminationReason}</p>
          {detail.errorDetail ? <p><strong>Error:</strong> {detail.errorDetail}</p> : null}
          <p><strong>Final output:</strong></p>
          <pre>{detail.run.finalOutput || "(none)"}</pre>
        </section>
        <section className="panel">
          <h2>Evaluators</h2>
          <ul className="stack">
            {detail.evaluatorResults.map((result) => (
              <li key={result.evaluatorId}>
                <span className={`pill ${result.status}`}>{result.status}</span> {result.evaluatorId}
                <div className="muted">{result.message}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="panel">
        <h2>Tool Calls</h2>
        {detail.toolCalls.length === 0 ? <p className="muted">No tool calls recorded.</p> : null}
        <ul className="stack">
          {detail.toolCalls.map((call) => (
            <li key={call.id}>
              <strong>{call.toolName}</strong> <span className={`pill ${call.status}`}>{call.status}</span>
              <pre>{JSON.stringify({ input: call.input, output: call.output }, null, 2)}</pre>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>Trace</h2>
        <ol className="timeline timeline-detailed">
          {detail.traceEvents.map((event) => (
            <li key={event.eventId} className="timeline-item">
              <div className="timeline-head">
                <span className="timeline-step">Step {event.stepIndex}</span>
                <span className="event-chip">{formatEventLabel(event.type)}</span>
                <span className="muted">{event.source}</span>
              </div>
              <pre>{JSON.stringify(event.payload, null, 2)}</pre>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}

export function FailureSummaryPanel(props: { detail: RunDetail }): React.JSX.Element | null {
  const failureItems = getFailureSummaryItems(props.detail);
  if (failureItems.length === 0) {
    return null;
  }

  return (
    <section className="panel failure-panel">
      <h2>Failures First</h2>
      <p><strong>Status:</strong> <span className={`pill ${props.detail.run.status}`}>{props.detail.run.status}</span></p>
      <p><strong>Termination:</strong> {props.detail.run.terminationReason}</p>
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
      <p><strong>Variant set:</strong> {run.variantSetName ?? "-"}</p>
      <p><strong>Variant:</strong> {run.variantLabel ?? "-"}</p>
      <p><strong>Prompt version:</strong> {run.promptVersion ?? "-"}</p>
      <p><strong>Model version:</strong> {run.modelVersion ?? "-"}</p>
      <p><strong>Tool schema version:</strong> {run.toolSchemaVersion ?? "-"}</p>
      <p><strong>Config label:</strong> {run.configLabel ?? "-"}</p>
      <p><strong>Runtime profile:</strong> {run.runtimeProfileName ?? "-"}</p>
      <p><strong>Suite definition:</strong> {run.suiteDefinitionName ?? "-"}</p>
    </>
  );
}

function ComparePage(props: { baseline?: string; candidate?: string }): React.JSX.Element {
  const [data, setData] = useState<ComparePayload | null>(null);

  useEffect(() => {
    if (!props.baseline || !props.candidate) {
      setData(null);
      return;
    }
    const url = new URL("/api/compare", window.location.origin);
    url.searchParams.set("baseline", props.baseline);
    url.searchParams.set("candidate", props.candidate);
    void fetch(url)
      .then((response) => response.json())
      .then((payload) => setData(payload as ComparePayload));
  }, [props.baseline, props.candidate]);

  if (!props.baseline || !props.candidate) {
    return <EmptyState title="No comparison selected" description="Open the compare page with baseline and candidate run ids." />;
  }

  if (!data) {
    return <EmptyState title="Loading comparison" description="Fetching both runs and computing deltas." />;
  }

  return (
    <section>
      <div className="hero">
        <h1>Compare</h1>
        <p>{data.baseline.run.scenarioId}</p>
      </div>
      <ComparisonHero comparison={data} />
      <div className="stats">
        <Stat label="Classification" value={data.classification} />
        <Stat label="Score delta" value={signed(data.deltas.score)} />
        <Stat label="Runtime delta" value={`${signed(data.deltas.runtimeMs)}ms`} />
        <Stat label="Step delta" value={signed(data.deltas.steps)} />
      </div>
      <section className="panel emphasis-panel">
        <h2>Notes</h2>
        {data.notes.length === 0 ? <p className="muted">No material differences recorded.</p> : null}
        <ul className="stack">
          {data.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
      <div className="panel-grid">
        <section className="panel">
          <h2>Evaluator diffs</h2>
          {data.evaluatorDiffs.length === 0 ? <p className="muted">No evaluator changes.</p> : null}
          <ul className="stack diff-list">
            {data.evaluatorDiffs.map((diff) => (
              <li key={diff.evaluatorId} className="diff-card">
                <div className="diff-card-head">
                  <strong>{diff.evaluatorId}</strong>
                  {diff.hardGate ? <span className="event-chip">hard gate</span> : null}
                </div>
                <div className="muted">{diff.note}</div>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2>Tool diffs</h2>
          {data.toolDiffs.length === 0 ? <p className="muted">No tool usage changes.</p> : null}
          <ul className="stack diff-list">
            {data.toolDiffs.map((diff) => (
              <li key={diff.toolName} className="diff-card">
                <div className="diff-card-head">
                  <strong>{diff.toolName}</strong>
                  <span className={`pill ${mapRiskToPill(diff.risk)}`}>{diff.risk}</span>
                </div>
                <div className="muted">{diff.note}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="compare-grid">
        <RunSide title="Baseline" detail={data.baseline} />
        <RunSide title="Candidate" detail={data.candidate} />
      </div>
    </section>
  );
}

function RunSide(props: { title: string; detail: RunDetail }): React.JSX.Element {
  return (
    <section className={`panel compare-side ${props.title === "Candidate" ? "candidate-side" : "baseline-side"}`}>
      <h2>{props.title}</h2>
      <p><strong>Run:</strong> <a href={`/runs/${props.detail.run.id}`}>{props.detail.run.id}</a></p>
      <p><strong>Status:</strong> <span className={`pill ${props.detail.run.status}`}>{props.detail.run.status}</span></p>
      <p><strong>Score:</strong> {props.detail.run.score}</p>
      <p><strong>Runtime:</strong> {props.detail.run.durationMs}ms</p>
      <p><strong>Termination:</strong> {props.detail.run.terminationReason}</p>
      <p><strong>Agent:</strong> {props.detail.agentVersion?.label ?? "-"}</p>
      <p><strong>Provider:</strong> {props.detail.agentVersion?.provider ?? "-"}</p>
      {props.detail.agentVersion?.modelId ? <p><strong>Model:</strong> {props.detail.agentVersion.modelId}</p> : null}
      {props.detail.agentVersion?.command ? (
        <p><strong>Command:</strong> {props.detail.agentVersion.command} {(props.detail.agentVersion.args ?? []).join(" ")}</p>
      ) : null}
      {props.detail.errorDetail ? <p><strong>Error:</strong> {props.detail.errorDetail}</p> : null}
      <p><strong>Final output:</strong></p>
      <pre>{props.detail.run.finalOutput || "(none)"}</pre>
      <h3>Trace</h3>
      <ol className="timeline compact">
        {props.detail.traceEvents.map((event) => (
          <li key={event.eventId} className="timeline-item compact-item">
            <strong>{event.stepIndex}. {formatEventLabel(event.type)}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SuiteComparePage(props: { baselineBatch?: string; candidateBatch?: string }): React.JSX.Element {
  const [data, setData] = useState<SuiteComparisonPayload | null>(null);

  useEffect(() => {
    if (!props.baselineBatch || !props.candidateBatch) {
      setData(null);
      return;
    }
    const url = new URL("/api/compare-suite", window.location.origin);
    url.searchParams.set("baselineBatch", props.baselineBatch);
    url.searchParams.set("candidateBatch", props.candidateBatch);
    void fetch(url)
      .then((response) => response.json())
      .then((payload) => setData(payload as SuiteComparisonPayload));
  }, [props.baselineBatch, props.candidateBatch]);

  if (!props.baselineBatch || !props.candidateBatch) {
    return <EmptyState title="No suite comparison selected" description="Open the suite compare page with baseline and candidate batch ids." />;
  }

  if (!data) {
    return <EmptyState title="Loading suite comparison" description="Fetching suite batches and computing regressions." />;
  }

  return (
    <section>
      <div className="hero">
        <h1>Suite Compare</h1>
        <p>{data.suite}</p>
      </div>
      <SuiteComparisonHero data={data} />
      <div className="stats">
        <Stat label="Classification" value={data.classification} />
        <Stat label="Pass delta" value={signed(data.deltas.pass)} />
        <Stat label="Fail delta" value={signed(data.deltas.fail)} />
        <Stat label="Score delta" value={signed(data.deltas.averageScore)} />
        <Stat label="Runtime delta" value={`${signed(data.deltas.averageRuntimeMs)}ms`} />
        <Stat label="Step delta" value={signed(data.deltas.averageSteps)} />
      </div>
      <section className="panel">
        <h2>Notes</h2>
        {data.notes.length === 0 ? <p className="muted">No suite-level notes recorded.</p> : null}
        <ul className="stack">
          {data.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
      <div className="panel-grid">
        <ScenarioList title="Regressions" items={data.regressions} />
        <ScenarioList title="Improvements" items={data.improvements} />
      </div>
      <section className="panel">
        <h2>Missing scenarios</h2>
        <p><strong>Missing from candidate:</strong> {data.missingFromCandidate.join(", ") || "None"}</p>
        <p><strong>Missing from baseline:</strong> {data.missingFromBaseline.join(", ") || "None"}</p>
      </section>
    </section>
  );
}

function ScenarioList(props: { title: string; items: Array<{ scenarioId: string; comparison: ComparePayload }> }): React.JSX.Element {
  return (
    <section className="panel">
      <h2>{props.title}</h2>
      {props.items.length === 0 ? <p className="muted">None.</p> : null}
      <ul className="stack diff-list">
        {props.items.map((item) => (
          <li key={item.scenarioId} className="diff-card">
            <div className="diff-card-head">
              <strong>{item.scenarioId}</strong> <span className="muted">{item.comparison.classification}</span>
            </div>
            <div>
              <a href={`/compare?baseline=${item.comparison.baseline.run.id}&candidate=${item.comparison.candidate.run.id}`}>open run compare</a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat(props: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="stat">
      <div className="muted">{props.label}</div>
      <div className="stat-value">{props.value}</div>
    </div>
  );
}

function EmptyState(props: { title: string; description: string }): React.JSX.Element {
  return (
    <section className="empty">
      <h1>{props.title}</h1>
      <p>{props.description}</p>
    </section>
  );
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

export function SuiteComparisonHero(props: { data: SuiteComparisonPayload }): React.JSX.Element {
  return (
    <section className="panel compare-hero neutral">
      <div className="compare-hero-head">
        <h2>Suite movement</h2>
        <span className="event-chip">{props.data.classification}</span>
      </div>
      <div className="stats compact-stats">
        <Stat label="Regressions" value={props.data.regressions.length} />
        <Stat label="Improvements" value={props.data.improvements.length} />
        <Stat label="Unchanged" value={props.data.unchanged.length} />
      </div>
    </section>
  );
}

export function getFailureSummaryItems(detail: RunDetail): string[] {
  const items: string[] = [];
  if (detail.errorDetail) {
    items.push(`Error: ${detail.errorDetail}`);
  }

  for (const result of detail.evaluatorResults) {
    if (result.status === "fail") {
      items.push(`Evaluator ${result.evaluatorId}: ${result.message}`);
    }
  }

  if (detail.run.status !== "pass" && items.length === 0) {
    items.push("Run did not pass. Inspect evaluator results and trace for the first divergence.");
  }

  return items;
}

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
    pass: runs.filter((run) => run.status === "pass").length,
    fail: runs.filter((run) => run.status === "fail").length,
    error: runs.filter((run) => run.status === "error").length,
    latestSuite: runs[0]?.suite ?? "-",
    latestProvider: runs[0]?.provider ?? "-",
  };
}

function formatEventLabel(type: string): string {
  return type.replaceAll("_", " ");
}

function mapRiskToPill(risk: string): "pass" | "fail" | "error" {
  if (risk === "high") {
    return "fail";
  }
  if (risk === "medium") {
    return "error";
  }
  return "pass";
}

function mapClassificationToTone(classification: string): "pass" | "fail" | "error" | "neutral" {
  if (classification.includes("regress")) {
    return "fail";
  }
  if (classification.includes("improv")) {
    return "pass";
  }
  if (classification.includes("changed")) {
    return "error";
  }
  return "neutral";
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function getRoute():
  | { type: "list" }
  | { type: "detail"; runId: string }
  | { type: "compare"; baseline?: string; candidate?: string }
  | { type: "compare-suite"; baselineBatch?: string; candidateBatch?: string } {
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
