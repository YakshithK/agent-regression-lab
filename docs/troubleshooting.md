# Troubleshooting

This page covers the main failure modes users hit during install, first run, and comparison.

## `agentlab: command not found`

You are probably in one of these states:

- the package is not installed globally
- you have not run `npm link` from the repo
- your shell path does not include npm global bins

Fast fixes:

```bash
npm install
npm run build
npm link
agentlab --help
```

Or skip linking and use:

```bash
npm run start -- --help
```

---

## `OPENAI_API_KEY is required`

You used an OpenAI-backed agent without exporting the API key.

Fix:

```bash
export OPENAI_API_KEY=...
agentlab run support.refund-correct-order --agent openai-cheap
```

---

## `No scenarios found for suite ...`

The suite id must match a suite under `scenarios/`.

List valid options:

```bash
agentlab list scenarios
```

Current built-in suites in this repo include:

- `support`
- `coding`
- `research`
- `ops`
- `internal-teams`

---

## `Run '<id>' not found`

`show` and run-to-run `compare` require run ids from completed runs.

Get a fresh run id by executing a scenario:

```bash
agentlab run support.refund-correct-order --agent mock-default
```

Then use:

```bash
agentlab show <run-id>
agentlab compare <baseline-run-id> <candidate-run-id>
```

---

## `Missing baseline or candidate suite batch id`

`compare --suite` does not use run ids. It uses suite batch ids printed by `run --suite`.

Example:

```bash
agentlab run --suite support --agent mock-default
agentlab run --suite support --agent mock-default
agentlab compare --suite <baseline-batch-id> <candidate-batch-id>
```

---

## Cross-suite suite comparison errors

Suite batch comparison is strict. Compare batches from the same suite only.

This is valid:

```bash
agentlab compare --suite suite_...support_batch_a suite_...support_batch_b
```

This is not valid:

- a `support` batch compared against an `ops` batch
- mixed or malformed suite batch selections

If you are unsure which batch came from which suite, rerun the suite and record the printed batch ids.

---

## `agentlab ui` fails to load assets

Installed packages should already include the built UI assets.

If you are running from a repo checkout, build first:

```bash
npm install
npm run build
agentlab ui
```

If the problem persists, verify that these files exist:

- `dist/ui-assets/client.js`
- `dist/ui-assets/client.css`

---

## Config tool or agent not found

Typical reasons:

- `agentlab.config.yaml` is missing
- the configured `name` does not match the CLI `--agent` value
- `modulePath` points outside the repo
- both `modulePath` and `package` were provided for the same tool
- the configured npm package is not installed
- the configured export or command does not exist

Working references in this repo:

- tool config: `agentlab.config.yaml`
- custom tool: `user_tools/findDuplicateCharge.ts`
- package-style tools: `examples/support-tools`, `examples/coding-tools`
- external agents: `custom_agents/node_agent.mjs`, `custom_agents/python_agent.py`

### `Tool '<name>' must define exactly one of 'modulePath' or 'package'`

Your tool registration is ambiguous or incomplete.

Valid:

```yaml
tools:
  - name: support.find_duplicate_charge
    modulePath: ./user_tools/findDuplicateCharge.ts
    exportName: findDuplicateCharge
```

Also valid:

```yaml
tools:
  - name: support.find_duplicate_charge
    package: "@agentlab/example-support-tools"
    exportName: findDuplicateCharge
```

Invalid:

- setting both `modulePath` and `package`
- setting neither of them

### `Tool '<name>' failed to load package '<pkg>'`

The package-backed tool could not be resolved from the current project.

Check:

- the package is installed in the current project
- the package name is correct
- the package exports the named function you configured

Typical fix:

```bash
npm install @agentlab/example-support-tools
```

### `Tool '<name>' export '<export>' is not a function`

The module loaded successfully, but the named export does not exist or is not callable.

Check:

- `exportName` matches the actual exported function name
- the package or local module uses ESM exports as expected

---

## HTTP agent errors

### `HTTP agents require a configured url`

You ran a conversation scenario with `--provider http` but no HTTP agent config was found.

Fix: define a named http agent in `agentlab.config.yaml`:

```yaml
agents:
  - name: my-agent
    provider: http
    url: http://localhost:3000/api/chat
```

Then run with:

```bash
agentlab run internal-teams.memory-followup-recall --agent my-agent
```

### `termination_reason: http_connection_failed`

agentlab could not connect to your agent's URL. The most common cause is that the agent service is not running.

Check:

- is the service running on the configured port?
- is the URL in `agentlab.config.yaml` correct?
- is there a firewall or proxy blocking the connection?

### `termination_reason: http_error`

Your agent returned an HTTP 4xx or 5xx response.

Check:

- is the route path correct?
- does your agent expect a different request shape? Use `request_template` if so.
- are there auth errors? Check `headers` config.

### `termination_reason: timeout_exceeded`

Your agent did not respond within `timeout_ms` (default 30 seconds).

Fix options:

- increase `timeout_ms` in the agent config
- investigate why the agent is slow for the given input

### `termination_reason: invalid_response_format`

Your agent either returned non-JSON or did not include the expected field.

Defaults: agentlab reads the `message` field from the JSON response. Override with `response_field` if your agent uses a different name:

```yaml
agents:
  - name: my-agent
    provider: http
    url: http://localhost:3000/api/chat
    response_field: reply
```

---

## `database is locked`

You hit SQLite write contention on the local artifacts DB.

Most common cause:

- multiple `agentlab` runs writing to the same `artifacts/agentlab.db` at the same time

Fix:

- wait for the current run to finish
- rerun sequentially instead of in parallel
- keep live HTTP fixture verification serialized when using the same local project directory

The product now uses a busy timeout, but sequential execution is still the safest path for local live verification.

---

## Conversation scenario errors

### `Scenario '...' is a conversation scenario and requires provider: http`

You tried to run a `type: conversation` scenario with a non-HTTP agent (`mock`, `openai`, or `external_process`).

Conversation scenarios only work with `provider: http`. Configure an HTTP agent in `agentlab.config.yaml` and use `--agent <name>`.

### `Conversation scenario '...' must not define 'tools'`

Your conversation scenario YAML has a `tools:` field. HTTP agents manage their own tools internally — remove the `tools:` block.

### `Conversation scenario '...' must define at least one step`

The `steps:` list is empty or missing. Add at least one step:

```yaml
steps:
  - role: user
    message: "Hello"
```

### Per-step evaluator type rejected

Only these evaluator types are valid inside `steps[].evaluators`:

- `response_contains`
- `response_not_contains`
- `response_matches_regex`
- `response_latency_max`

End-of-run types (`step_count_max`, `final_answer_contains`, `exact_final_answer`) belong at the top-level `evaluators:` block, not inside individual steps.

---

## Global install behaves differently from repo mode

That usually means the current working directory is wrong.

The CLI operates on the current working directory and expects:

- `scenarios/`
- `fixtures/`
- optional `agentlab.config.yaml`

Run it from the project root you want to evaluate.

---

## Release Verification

Before publishing or cutting a release, run:

```bash
npm run check
npm test
npm run build
npm run smoke:cli
npm pack --dry-run
```

For the full pre-launch checklist, see [release-checklist.md](release-checklist.md).
