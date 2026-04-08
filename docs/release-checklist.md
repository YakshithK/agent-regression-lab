# Release Checklist

Use this before publishing a new npm version or telling users to upgrade.

## Verification

Run the full release gate:

```bash
npm run check
npm test
npm run build
npm run smoke:cli
npm pack --dry-run
```

## Manual CLI Flow

Verify the canonical workflow:

```bash
agentlab list scenarios
agentlab run support.refund-correct-order --agent mock-default
agentlab show <run-id>
agentlab run support.refund-correct-order --agent mock-default
agentlab compare <baseline-run-id> <candidate-run-id>
agentlab run --suite support --agent mock-default
agentlab run --suite support --agent mock-default
agentlab compare --suite <baseline-batch-id> <candidate-batch-id>
agentlab ui
```

## Extension Smoke

Verify at least one extension path:

- run `support.refund-via-config-tool` with `custom-node-agent`, or
- verify a repo-local custom tool still loads from `agentlab.config.yaml`

## Docs Verification

Confirm these files match current behavior:

- `README.md`
- `docs/scenarios.md`
- `docs/tools.md`
- `docs/agents.md`
- `docs/troubleshooting.md`

Requirements:

- every command works as written
- every referenced path exists
- limitations are stated honestly
- `compare --suite` is documented using suite batch ids, not run ids

## Publish Hygiene

Before `npm publish`:

- confirm the package version is correct
- confirm the git tree contains the intended release changes
- confirm packaged UI assets are included in the tarball
- confirm the npm metadata still points at the correct repo, homepage, and issues URL
