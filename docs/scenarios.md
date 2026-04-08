# Scenarios

Scenarios are YAML files under `scenarios/`. They are the core authoring interface for the product.

agentlab supports two scenario types:

- `task` — a single-instruction job for a tool-using agent (default, no `type` field needed)
- `conversation` — a multi-turn dialog with an HTTP agent

---

## Task Scenarios

Task scenarios are the default format. They describe a single job for an agent that uses tools to complete it.

### Required Shape

Each task scenario should define:

- `id`
- `name`
- `suite`
- `task`
- `tools`
- `evaluators`

Common optional fields:

- `description`
- `difficulty`
- `tags`
- `runtime`
- task `context`

### Example

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

### Evaluators

Use deterministic evaluators only.

| Type | Description |
|------|-------------|
| `tool_call_assertion` | Assert a specific tool was called with specific input |
| `forbidden_tool` | Fail if a tool was called that should not have been |
| `final_answer_contains` | Check that the final output contains required substrings |
| `exact_final_answer` | Require an exact match on the final output |
| `step_count_max` | Fail if the agent used more steps than allowed |

Evaluator modes:

- `hard_gate` — failure immediately fails the run, regardless of other evaluators
- `weighted` — contributes to the weighted score (0–100)

### Runtime Limits

```yaml
runtime:
  max_steps: 8
  timeout_seconds: 60
```

Both are optional. `max_steps` defaults to 8. `timeout_seconds` is uncapped if not set.

### Tools

Each task scenario declares its allowed tools:

```yaml
tools:
  allowed:
    - crm.search_customer
    - orders.list
    - orders.refund
  forbidden:
    - orders.delete
```

Keep the allowlist as narrow as possible. Broad allowlists weaken the benchmark.

---

## Conversation Scenarios

Conversation scenarios test HTTP agents through multi-turn dialogs. They require `type: conversation` and work exclusively with `provider: http` agents. The agent is responsible for maintaining its own conversation history.

### Required Shape

```yaml
type: conversation
id: support.order-tracking
name: Order Tracking Multi-Turn
suite: support
steps:
  - role: user
    message: "Where's my order #ORD-001?"
  - role: user
    message: "What's the tracking number?"
```

Each step must have:

- `role: user`
- `message` — the message sent to the agent this turn

### Per-Step Evaluators

Evaluators can be attached to individual steps. They run immediately after the agent replies to that step.

```yaml
steps:
  - role: user
    message: "Where's my order #ORD-001?"
    evaluators:
      - type: response_contains
        mode: hard_gate
        config:
          keywords: [shipped, tracking]
      - type: response_latency_max
        mode: hard_gate
        config:
          ms: 3000
  - role: user
    message: "What's the tracking number?"
    evaluators:
      - type: response_not_contains
        mode: weighted
        weight: 1
        config:
          keywords: ["don't know", error]
```

If a `hard_gate` per-step evaluator fails, the run stops immediately and remaining steps are skipped.

### Per-Step Evaluator Types

| Type | Config | Behavior |
|------|--------|----------|
| `response_contains` | `keywords: string[]` | Passes if ALL keywords appear in the reply (case-insensitive) |
| `response_not_contains` | `keywords: string[]` | Passes if NONE of the keywords appear in the reply (case-insensitive) |
| `response_matches_regex` | `pattern: string` | Passes if the reply matches the regex pattern (case-insensitive) |
| `response_latency_max` | `ms: number` | Passes if the HTTP response arrived within the time limit |

### End-of-Run Evaluators

End-of-run evaluators run after all steps complete. They apply to the final reply.

```yaml
evaluators:
  - type: step_count_max
    mode: hard_gate
    config:
      max: 10
  - type: final_answer_contains
    mode: weighted
    weight: 1
    config:
      keywords: [resolved, confirmed]
```

End-of-run evaluator types:

| Type | Config | Behavior |
|------|--------|----------|
| `step_count_max` | `max: number` | Passes if the number of completed turns is within the limit |
| `final_answer_contains` | `keywords: string[]` | Passes if ALL keywords appear in the final reply |
| `exact_final_answer` | `expected: string` | Passes if the final reply exactly matches the expected string |

### Conversation State

agentlab auto-generates a UUID `conversation_id` for each run. It is sent in every step request. The agent uses it to look up and maintain its own conversation history.

The `state` block is optional:

```yaml
state:
  conversation_id: auto
```

`auto` is the only supported value. The UUID is always generated regardless of whether the `state` block is present.

### Restrictions

Conversation scenarios must not define a `tools:` field. HTTP agents manage their own tools internally. If `tools:` is present, validation will fail with a clear error.

### Full Example

```yaml
type: conversation
id: support.order-tracking
name: Order Tracking Multi-Turn
suite: support
description: Multi-turn order status inquiry.
difficulty: medium
tags:
  - support
  - conversation

state:
  conversation_id: auto

steps:
  - role: user
    message: "Where's my order #ORD-001?"
    evaluators:
      - type: response_contains
        mode: hard_gate
        config:
          keywords: [shipped, tracking]
      - type: response_latency_max
        mode: hard_gate
        config:
          ms: 3000

  - role: user
    message: "What's the tracking number?"
    evaluators:
      - type: response_not_contains
        mode: weighted
        weight: 1
        config:
          keywords: ["don't know", error]

evaluators:
  - type: step_count_max
    mode: hard_gate
    config:
      max: 10
```

Run it with:

```bash
agentlab run support.order-tracking --agent my-production-agent
```

Where `my-production-agent` is a named `http` agent in `agentlab.config.yaml`. See [agents.md](agents.md) for HTTP agent config.

### CLI Output

Conversation runs print a different output format from task runs:

```
run support.order-tracking — PASS
  agent: my-production-agent (http://localhost:3000/api/chat)
  turns completed: 2/2
  step 1: pass (response_contains ✓, latency 240ms ✓)
  step 2: pass (response_not_contains ✓)
  run id: run_20260407_001234
```

If a hard-gate fails mid-run:

```
run support.order-tracking — FAIL
  agent: my-production-agent (http://localhost:3000/api/chat)
  turns completed: 1/2
  step 1: FAIL (response_contains ✗)
  run stopped (evaluator_failed)
  run id: run_20260407_001235
```

---

## Suites

Both task and conversation scenarios can belong to a suite.

```yaml
suite: support
```

Run an entire suite:

```bash
agentlab run --suite support --agent mock-default
```

`run --suite` skips conversation scenarios when using non-HTTP agents (conversation scenarios require `provider: http`). Task scenarios and conversation scenarios can coexist in the same suite directory.

`run --suite` prints a suite batch id at the end. That id is used for suite comparison:

```bash
agentlab compare --suite <baseline-batch-id> <candidate-batch-id>
```

---

## Authoring Conventions

- `id` format: `<suite>.<short-name>`
- keep scenario jobs narrow and concrete
- keep fixture-backed context in `task.context` (task scenarios)
- prefer deterministic fixture references over open-ended prompts
- include `difficulty`, `description`, and `tags` for every launch scenario
- for conversation scenarios, keep step count low (2–5) and evaluators specific

## Current Examples

Task scenario references in this repo:

- support: `scenarios/support/refund-correct-order.yaml`
- support with config tool: `scenarios/support/refund-via-config-tool.yaml`
- coding: `scenarios/coding/fix-add-function.yaml`
- research: `scenarios/research/remote-work-policy.yaml`
- ops: `scenarios/ops/payments-api-alert.yaml`
