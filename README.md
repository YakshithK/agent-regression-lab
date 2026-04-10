# Agent Regression Lab

Agent Regression Lab is the local-first regression spine for agent engineering teams.

It gives teams a repeatable way to define expected agent behavior in YAML, replay it against deterministic tool surfaces or live HTTP agents, store traces and scores locally, and compare candidate behavior against known baselines over time.

This is a local-first alpha for early technical teams. It is strongest when used across one workflow spine:

- debug a single scenario while building
- validate a branch with a suite before merge
- run curated golden suites before release
- keep incident-derived scenarios as engineering memory

## Who It Is For

- teams shipping prompt, model, tool, workflow, and memory changes
- engineers who need repeatable before/after evidence instead of vibes
- teams validating live HTTP agents as well as deterministic local scenarios
- researchers and technical operators who want local control before adopting heavier hosted infrastructure

## Why Teams Use It

- catch regressions before merge or release
- debug subtle behavioral changes with full traces
- compare model, prompt, tool, and workflow changes against a known baseline
- build a portfolio of golden workflows, historical regressions, and ugly edge cases
- preserve engineering memory so old failures do not quietly return

## What It Supports Today

- YAML scenarios under `scenarios/`
- deterministic built-in tools plus repo-local custom tools from `agentlab.config.yaml`
- named agents from `agentlab.config.yaml`
- built-in `mock`, `openai`, `external_process`, and `http` agent modes
- `type: conversation` multi-turn dialog scenarios for HTTP agents
- SQLite-backed local run history under `artifacts/agentlab.db`
- CLI commands to list, run, show, compare, and launch the UI
- local web UI for run inspection, run comparison, and suite batch comparison

## Workflow Spine

Use this as the default product story:

1. debug locally with one scenario
2. validate a branch with a suite
3. run curated golden suites before release
4. keep incident-derived scenarios as permanent regression assets

## First 10 Minutes

The fastest path is to run the CLI from a local checkout.

1. Install dependencies and build:

```bash
npm install
npm run check
npm test
npm run build
```

2. Verify the CLI:

```bash
agentlab --help
```

If you have not linked the package locally yet, use:

```bash
npm link
agentlab --help
```

3. List scenarios:

```bash
agentlab list scenarios
```

4. Run a deterministic sample scenario:

```bash
agentlab run support.refund-correct-order --agent mock-default
```

5. Inspect the run:

```bash
agentlab show <run-id>
```

6. Run the same scenario again, then compare the two runs:

```bash
agentlab compare <baseline-run-id> <candidate-run-id>
```

7. Launch the local UI:

```bash
agentlab ui
```

The UI starts on `http://127.0.0.1:4173`.

8. Run a suite and compare two suite batches:

```bash
agentlab run --suite support --agent mock-default
agentlab run --suite support --agent mock-default
agentlab compare --suite <baseline-batch-id> <candidate-batch-id>
```

`run --suite` prints a `Suite batch:` id at the end. That is the id used by `compare --suite`.

## Install

### Installed CLI

After the package is published:

```bash
npm install -g agent-regression-lab
agentlab --help
```

You can also use:

```bash
npx agent-regression-lab --help
```

### Local Development Install

From this repo:

```bash
npm install
npm run build
npm link
agentlab --help
```

### Repo-Local Dev Mode

If you do not want to link the package yet:

```bash
npm run start -- --help
npm run start -- run support.refund-correct-order --agent mock-default
```

## CLI

Supported command surface:

```text
agentlab list scenarios
agentlab run <scenario-id> [--agent <name>]
agentlab run --suite <suite-id> [--agent <name>]
agentlab show <run-id>
agentlab compare <baseline-run-id> <candidate-run-id>
agentlab compare --suite <baseline-batch-id> <candidate-batch-id>
agentlab ui
agentlab version
agentlab help
```

The CLI operates on the current working directory. Run it from the root of a project that contains `scenarios/`, `fixtures/`, and optional `agentlab.config.yaml`.

## Canonical Workflow

Use this as the default mental model:

1. list scenarios
2. run one scenario or one suite
3. note the run id or suite batch id
4. inspect the run in CLI or UI
5. compare two runs or two suite batches
6. extend the setup with a named agent or repo-local tool when needed

## Canonical Live HTTP Fixture

`arl-test/` is the canonical live HTTP regression fixture in this repo.

Use it to verify the production-like HTTP path end to end:

```bash
cd arl-test
npm start
node ../dist/index.js list scenarios
node ../dist/index.js run order-tracking-in-transit --agent support-agent
```

The `arl-test` scenarios are intended to behave like a real internal-team regression fixture, not just a toy demo.

## Config And Extension Points

`agentlab.config.yaml` is the public extension point for:

- named agents
- repo-local custom tools

Supported agent providers:

- `mock`
- `openai`
- `external_process`
- `http` — point at a running HTTP service for multi-turn conversation testing

Working sample assets already live in this repo:

- external agents: `custom_agents/node_agent.mjs`, `custom_agents/python_agent.py`
- custom tool: `user_tools/findDuplicateCharge.ts`
- sample config: `agentlab.config.yaml`

See:

- [docs/scenarios.md](docs/scenarios.md)
- [docs/tools.md](docs/tools.md)
- [docs/agents.md](docs/agents.md)
- [docs/troubleshooting.md](docs/troubleshooting.md)
- [docs/release-checklist.md](docs/release-checklist.md)

## Local Data And Artifacts

By default the product writes local state under `artifacts/`.

Important paths:

- SQLite DB: `artifacts/agentlab.db`
- per-run trace output: `artifacts/<run-id>/trace.json`
- local UI assets at runtime: served from packaged `dist/ui-assets` or built into `artifacts/ui/` in repo mode

If you delete `artifacts/`, you remove stored run history and generated local outputs.

## Determinism

The benchmark is designed to be deterministic enough for repeated local evaluation:

- built-in tools read from local fixtures
- scenarios declare fixed tool allowlists and evaluator rules
- scoring is rule-based
- suite comparison is based on stored local runs and suite batch ids

Agent behavior can still vary depending on the provider path. The built-in `mock` path is the most deterministic path for smoke tests and baseline examples.

## Limitations

- this is a local-first alpha, not a hosted platform
- custom tool loading is limited to repo-local module paths
- external agents integrate through the local stdin/stdout protocol only
- the UI is intentionally minimal and optimized for debugging
- SQLite-backed local storage still makes sequential live verification the safest path when reusing the same local artifacts DB
- the benchmark is broader than before, but still small compared to a mature benchmark product

## Next Docs

- scenario authoring: [docs/scenarios.md](docs/scenarios.md)
- golden suites: [docs/golden-suites.md](docs/golden-suites.md)
- integrations and live services: [docs/integrations-and-live-services.md](docs/integrations-and-live-services.md)
- memory and stateful agents: [docs/memory-and-stateful-agents.md](docs/memory-and-stateful-agents.md)
- custom tools: [docs/tools.md](docs/tools.md)
- named agents and external-process protocol: [docs/agents.md](docs/agents.md)
- common failure modes: [docs/troubleshooting.md](docs/troubleshooting.md)
