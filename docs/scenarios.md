# Scenarios

Scenarios are YAML files under `scenarios/`. They are the core authoring interface for the product.

Each scenario should describe one narrow job for the agent, not a vague capability test.

## Required Shape

Each scenario should define:

- `id`
- `name`
- `suite`
- `task`
- `tools`
- `runtime`
- `evaluators`

Common optional fields already used in this repo:

- `description`
- `difficulty`
- `tags`
- task `context`

## Example

```yaml
id: support.refund-correct-order
name: Refund The Correct Order
suite: support
difficulty: easy
description: Refund only the duplicated charge.
tags:
  - refund
  - support
task:
  instructions: |
    The customer says they were charged twice.
    Find the duplicated charge and refund only that order.
  context:
    customer_email: alice@example.com
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
  - id: mentions-order
    type: final_answer_contains
    mode: weighted
    weight: 1
    config:
      required_substrings:
        - ord_1024
```

## Suites In This Repo

Current benchmark domains:

- `support`
- `coding`
- `research`
- `ops`

Use a suite when scenarios belong to one behavior family and should be runnable together with:

```bash
agentlab run --suite support --agent mock-default
```

`run --suite` creates a suite batch id. That id is later used for:

```bash
agentlab compare --suite <baseline-batch-id> <candidate-batch-id>
```

Suite comparison is strict. Only compare batches from the same suite.

## Tools

Each scenario declares its allowed tools:

```yaml
tools:
  allowed:
    - crm.search_customer
    - orders.list
    - orders.refund
```

Keep the tool allowlist as narrow as possible. A broad allowlist weakens the benchmark and makes regressions harder to interpret.

This repo supports both:

- built-in deterministic tools
- repo-local custom tools registered in `agentlab.config.yaml`

The launch benchmark now includes built-in tools for:

- support
- coding
- research
- ops

See [tools.md](tools.md) for custom tool registration.

## Runtime Limits

Scenarios can enforce:

- `max_steps`
- `timeout_seconds`

Example:

```yaml
runtime:
  max_steps: 8
  timeout_seconds: 60
```

These limits are enforced by the runner. Use them to keep runs bounded and comparisons meaningful.

## Evaluators

Use deterministic evaluators only.

The current evaluator set includes:

- `tool_call_assertion`
- `forbidden_tool`
- `final_answer_contains`
- `exact_final_answer`
- `step_count_max`

Guidance:

- use hard gates for non-negotiable behavior
- use weighted evaluators for softer quality checks
- prefer tool assertions or exact output checks over vague answer checks when possible

## Authoring Conventions

Use these defaults:

- `id` format: `<suite>.<short-name>`
- keep scenario jobs narrow and concrete
- keep fixture-backed context in `task.context`
- prefer deterministic fixture references over open-ended prompts
- include `difficulty`, `description`, and `tags` for every launch scenario

## Current Examples

Useful scenario references in this repo:

- support: `scenarios/support/refund-correct-order.yaml`
- support with config tool: `scenarios/support/refund-via-config-tool.yaml`
- coding: `scenarios/coding/fix-add-function.yaml`
- research: `scenarios/research/remote-work-policy.yaml`
- ops: `scenarios/ops/payments-api-alert.yaml`
