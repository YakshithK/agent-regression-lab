# Coding Agents

ARL supports coding-agent regression workflows through deterministic task scenarios.

Use this path when the runner should remain authoritative for:

- file inspection tools
- patch application tools
- step limits
- regression scoring

## Start With The Built-In Coding Scenarios

This repo already includes two coding scenarios:

- `coding.fix-add-function`
- `coding.update-greeting`

Run one directly:

```bash
agentlab run coding.fix-add-function --agent mock-default
```

These scenarios use fixture-backed repo tools, which makes them useful for:

- prompt changes
- model comparisons
- patch-discipline checks
- pre-merge behavioral regression checks

## Why This Matters

Coding agents often regress in subtle ways:

- they inspect too much of the repo
- they patch the wrong file
- they over-edit instead of making a narrow change
- they stop naming the changed file clearly

ARL helps by making those expectations explicit in scenario evaluators.

## Minimal Workflow

1. run one coding scenario locally
2. inspect the run output and trace
3. run it again against a changed prompt/model/agent variant
4. compare the two runs

Example:

```bash
agentlab run coding.fix-add-function --agent mock-default
agentlab run coding.fix-add-function --agent mock-default
agentlab compare <baseline-run-id> <candidate-run-id>
```

## When To Use Task Scenarios Versus HTTP

Use task scenarios for coding agents when:

- you want deterministic fixture-backed tools
- you want ARL to own the tool loop
- you want reproducible patch-evaluator behavior

Use HTTP/conversation scenarios only when the coding agent already exists as a running service and owns its own orchestration internally.

## Next Step

If you want coding-agent checks in team workflows, pair these scenarios with suite definitions and CI:

```bash
agentlab run --suite-def pre_merge --agent mock-default
```
