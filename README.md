# Agent Regression Lab

Agent Regression Lab is a local-first evaluation harness for AI agents.

It lets you define fixed scenarios in YAML, run an agent against them repeatedly, capture a structured trace, score the result, and compare runs over time.

This is an alpha developer tool. It is useful now for local benchmarking and debugging, but it is not yet a polished platform.

## What It Supports Today

- YAML scenarios under `scenarios/`
- Deterministic built-in tools plus repo-local custom tools from `agentlab.config.yaml`
- Named agents from `agentlab.config.yaml`
- Built-in `mock`, `openai`, and `external_process` agent modes
- SQLite-backed local run history under `artifacts/agentlab.db`
- CLI commands to list, run, show, compare, and launch the UI
- Local web UI for run inspection and direct run-to-run comparison

## Quickstart

1. Install dependencies:

```bash
npm install
```

2. Run the typecheck, tests, and build:

```bash
npm run check
npm test
npm run build
```

3. Run a scenario:

```bash
npm run start -- run support.refund-correct-order --agent mock-default
```

4. Inspect a run:

```bash
npm run start -- show <run-id>
```

5. Launch the local UI:

```bash
npm run start -- ui
```

The UI starts on `http://127.0.0.1:4173`.

## Installable CLI

The package can be installed as a Node CLI.

Local development install:

```bash
npm install
npm run build
npm link
agentlab --help
```

Packed or published install:

```bash
npm install -g agent-regression-lab
agentlab --help
```

The CLI operates on the current working directory. Run it from the root of a project that contains `scenarios/`, `fixtures/`, and optional `agentlab.config.yaml`.

## CLI

```text
agentlab list scenarios
agentlab run <scenario-id> [--agent <name>]
agentlab run --suite <suite-id> [--agent <name>]
agentlab show <run-id>
agentlab compare <baseline-run-id> <candidate-run-id>
agentlab ui
```

You can also run these through `npm run start -- ...` during local development.

## Scenarios

Scenarios are YAML files under `scenarios/`.

Current scenario features:

- task instructions
- fixture references
- allowed and forbidden tools
- `max_steps`
- `timeout_seconds`
- evaluator configuration

Example scenario shape:

```yaml
id: support.refund-correct-order
name: Refund The Correct Order
suite: support
task:
  instructions: |
    The customer says they were charged twice.
    Find the duplicated charge and refund only that order.
tools:
  allowed:
    - crm.search_customer
    - orders.list
    - orders.refund
runtime:
  max_steps: 8
  timeout_seconds: 60
evaluators:
  - id: refund-created
    type: tool_call_assertion
    mode: hard_gate
    config:
      tool: orders.refund
      match:
        order_id: ord_1024
```

## Custom Agents And Tools

`agentlab.config.yaml` is the extension point for named agents and repo-local tools.

Supported agent providers:

- `mock`
- `openai`
- `external_process`

Supported custom tool model:

- repo-local JS/TS module path
- named export that resolves to an async function

Example config:

```yaml
agents:
  - name: custom-node-agent
    provider: external_process
    command: node
    args:
      - custom_agents/node_agent.mjs
    label: custom-node-agent

tools:
  - name: support.find_duplicate_charge
    modulePath: user_tools/findDuplicateCharge.ts
    exportName: findDuplicateCharge
    description: Find the duplicated charge order id for a given customer.
    inputSchema:
      type: object
      additionalProperties: false
      properties:
        customer_id:
          type: string
      required:
        - customer_id
```

## External Process Protocol

External agents communicate with the runner over line-delimited JSON on stdin/stdout.

Runner events:

- `run_started`
- `tool_result`
- `runner_error`

Agent responses:

- `tool_call`
- `final`
- `error`

The runner stays in control of the loop. External agents must not execute tools directly.

Minimal flow:

1. runner sends `run_started` with instructions, tool specs, context, and limits
2. agent sends back a `tool_call` or `final`
3. runner executes the tool and sends `tool_result`
4. agent sends the next `tool_call` or `final`

See `custom_agents/node_agent.mjs` and `custom_agents/python_agent.py` for working examples.

## Honest Limitations

- comparison is run-to-run, not full suite regression analysis yet
- tool loading is limited to local repo module paths
- external agents use the local stdin/stdout protocol only
- the UI is intentionally minimal and optimized for debugging, not dashboards
- the benchmark suite is still small
