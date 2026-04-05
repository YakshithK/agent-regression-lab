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

## `OPENAI_API_KEY is required`

You used an OpenAI-backed agent without exporting the API key.

Fix:

```bash
export OPENAI_API_KEY=...
agentlab run support.refund-correct-order --agent openai-cheap
```

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

## `Missing baseline or candidate suite batch id`

`compare --suite` does not use run ids. It uses suite batch ids printed by `run --suite`.

Example:

```bash
agentlab run --suite support --agent mock-default
agentlab run --suite support --agent mock-default
agentlab compare --suite <baseline-batch-id> <candidate-batch-id>
```

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

## Config tool or agent not found

Typical reasons:

- `agentlab.config.yaml` is missing
- the configured `name` does not match the CLI `--agent` value
- `modulePath` points outside the repo
- the configured export or command does not exist

Working references in this repo:

- tool config: `agentlab.config.yaml`
- custom tool: `user_tools/findDuplicateCharge.ts`
- external agents: `custom_agents/node_agent.mjs`, `custom_agents/python_agent.py`

## Global install behaves differently from repo mode

That usually means the current working directory is wrong.

The CLI operates on the current working directory and expects:

- `scenarios/`
- `fixtures/`
- optional `agentlab.config.yaml`

Run it from the project root you want to evaluate.

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
