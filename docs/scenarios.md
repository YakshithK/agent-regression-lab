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
- `runtime_profile`
- `runtime`
- task `context`
- `setup_script` — pre-run fixture setup
- `normalize` — output normalization rules

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

### Runtime Profiles

Task scenarios can reference a named `runtime_profile` from `agentlab.config.yaml`.

```yaml
runtime_profile: timeout-orders-tool
```

Runtime profiles let you apply reusable degraded-tool conditions without duplicating them across scenarios. Current shipped behavior:

- task scenarios: tool fault injection is active
- conversation scenarios: config reference is allowed for shared authoring, but ARL does not yet inject faults into the HTTP agent's internal tools

### Setup Scripts

Pre-run setup scripts execute TypeScript fixtures before the scenario runs. Use them to seed databases, warm caches, or initialize complex test state.

```yaml
setup_script: ./fixtures/seed-orders.ts
```

Rules:
- Must be a relative path (absolute paths rejected)
- Must point to a `.ts` file (executed via `tsx`)
- Cannot contain parent directory traversal (`..`)
- Executes with a 30-second timeout
- Failures abort the run with stderr output

Example setup script (`fixtures/seed-orders.ts`):

```typescript
// Seed the local fixture database before the scenario runs
import Database from "better-sqlite3";

const db = new Database("artifacts/test.db");
db.exec(`
  INSERT INTO orders (order_id, customer_email, amount, created_at) VALUES
  ('ord_1024', 'alice@example.com', 99.99, '2026-01-15');
`);
db.close();
```

### Output Normalization

When comparing runs, normalize agent output to ignore cosmetic differences and focus on semantic changes.

```yaml
normalize:
  - strip_whitespace
  - lowercase
  - ignore_dates
```

Available rules:

| Rule | Effect |
|------|--------|
| `strip_whitespace` | Remove leading/trailing whitespace and collapse internal whitespace to single spaces |
| `lowercase` | Convert all text to lowercase |
| `ignore_dates` | Replace dates with `[DATE]` placeholder (ISO format: YYYY-MM-DD, natural language: "May 8 2026", "8 May 2026", "May 2026") |

Normalization applies to:
- agent final output
- tool call parameters and results
- comparison diffs

Use normalization to:
- compare prompts that don't affect agent quality (whitespace, capitalization)
- ignore dates that will naturally differ between runs
- reduce false-positive regressions from formatting changes

Rules apply in order. Example:

```yaml
normalize:
  - ignore_dates
  - lowercase
```

This normalizes dates first, then lowercases the result.

### Evaluators

Use deterministic evaluators only.

| Type | Description |
|------|-------------|
| `tool_call_assertion` | Assert a specific tool was called with specific input |
| `forbidden_tool` | Fail if a tool was called that should not have been |
| `final_answer_contains` | Check that the final output contains required substrings |
| `exact_final_answer` | Require an exact match on the final output |
| `step_count_max` | Fail if the agent used more steps than allowed |
| `tool_call_count_max` | Fail if the total number of tool calls exceeds a budget |
| `tool_repeat_max` | Fail if one tool is overused |
| `cost_max` | Fail if the run cost exceeds a configured USD budget |

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

### Budget And Governance Checks

Operational regressions are often just as important as correctness regressions. Use budget evaluators to encode "technically worked, but unacceptable in production":

```yaml
evaluators:
  - id: total-tool-budget
    type: tool_call_count_max
    mode: hard_gate
    config:
      max: 2
  - id: no-repeat-order-list
    type: tool_repeat_max
    mode: hard_gate
    config:
      tool: orders.list
      max: 1
```

Use `cost_max` only where the run records cost metadata.

---

## Conversation Scenarios

Conversation scenarios test HTTP agents through multi-turn dialogs. They require `type: conversation` and work exclusively with `provider: http` agents. The agent is responsible for maintaining its own conversation history.

### Required Shape

```yaml
type: conversation
id: internal-teams.memory-followup-recall
name: Follow-Up Recall Within Conversation
suite: internal-teams
steps:
  - role: user
    message: "I'm traveling next Tuesday and I prefer aisle seats. Please remember that."
  - role: user
    message: "What seat preference did I mention earlier?"
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

### Scenario Quality Rules

- prefer `hard_gate` for business-critical assertions
- use `weighted` checks for quality gradients, not for the single condition that makes the scenario trustworthy
- conversation scenarios must use `config.keywords` for `response_contains` and `response_not_contains`
- stale `config.text` authoring is rejected
- use conversation scenarios when the agent owns memory, tool execution, or conversation history internally
- keep golden suites focused on repeatable workflows, historical regressions, and ugly edge cases rather than one-off demos

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

Conversation scenarios may define `runtime_profile`, but today that is for shared scenario organization and future stateful hooks. ARL does not inject tool faults into HTTP agents.

---

## Suite Definitions

Scenario `suite` still groups related files, but operational launch workflows should use config-level `suite_definitions`.

Example:

```yaml
suite_definitions:
  - name: pre_merge
    include:
      tags:
        - smoke
        - regression
```

Run one with:

```bash
agentlab run --suite-def pre_merge --agent mock-default
agentlab run --suite-def pre_merge --variant-set refund-agent-model-comparison
```

Use suite definitions for stable workflow units like:

- `smoke`
- `pre_merge`
- `release`
- `incident_regressions`

### Full Example

```yaml
type: conversation
id: internal-teams.memory-followup-recall
name: Follow-Up Recall Within Conversation
suite: internal-teams
description: Memoryful agent should recall a user-provided fact later in the same conversation.
difficulty: medium
tags:
  - internal-teams
  - conversation

steps:
  - role: user
    message: "I'm traveling next Tuesday and I prefer aisle seats. Please remember that."
    evaluators:
      - type: response_contains
        mode: weighted
        config:
          keywords:
            - aisle

  - role: user
    message: "What seat preference did I mention earlier?"
    evaluators:
      - type: response_contains
        mode: hard_gate
        config:
          keywords:
            - aisle

evaluators:
  - type: step_count_max
    mode: hard_gate
    config:
      max: 2
```

Run it with:

```bash
agentlab run internal-teams.memory-followup-recall --agent my-production-agent
```

Where `my-production-agent` is a named `http` agent in `agentlab.config.yaml`. See [agents.md](agents.md) for HTTP agent config.

### CLI Output

Conversation runs print a different output format from task runs:

```
run internal-teams.memory-followup-recall — PASS
  agent: my-production-agent (http://localhost:3000/api/chat)
  turns completed: 2/2
  step 1: pass (response_contains ✓)
  step 2: pass (response_contains ✓)
  run id: run_20260407_001234
```

If a hard-gate fails mid-run:

```
run internal-teams.memory-followup-recall — FAIL
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

## Baseline Approval Workflow

Snapshot the behavior of your agent when it's working correctly. Then, when you change a prompt or model, compare new runs against that snapshot to catch regressions.

### Approve a Baseline

Run a scenario and get a run ID:

```bash
agentlab run support.refund-correct-order --agent my-agent
# Output: Run: run_1778520123456
```

Approve that run as the baseline:

```bash
agentlab approve run_1778520123456
# Output: Approved baseline for scenario support.refund-correct-order
```

Baselines are scoped per `(scenario, agent_version)` pair. Approving a new baseline clears the old one for that scenario+agent.

### Compare Against Baseline

After changing your prompt or model, run the same scenario:

```bash
agentlab run support.refund-correct-order --agent my-agent
# Output: Run: run_1778520234567
```

Compare the new run against the approved baseline:

```bash
agentlab compare --baseline support.refund-correct-order run_1778520234567
```

The output shows:
- Baseline run ID and score
- Candidate run ID and score
- Classification: PASS, REGRESSED, or IMPROVED
- Per-evaluator changes
- Output diffs (if any)

Example output:

```
Scenario: support.refund-correct-order
Baseline: run_1778520123456 (PASS 100/100)
Candidate: run_1778520234567 (PASS 100/100)
Classification: PASS
No regressions detected.
```

### Workflow

1. Run and approve a baseline when agent behavior is correct
2. Change your prompt, model, or tools
3. Run the scenario again
4. Compare against the baseline
5. If regressed, fix and iterate
6. When ready, approve the new run as the baseline

This workflow replaces manual run-ID tracking. Use it for:
- pre-merge validation
- iterating on prompts
- A/B testing model or tool changes
- building historical regression suites

---

## Generated Scenarios

Use `agentlab generate` to bootstrap scenario YAML from the built-in template catalog:

```bash
agentlab generate --domain support --count 5 --agent mock-default
```

Generated scenarios are written to `scenarios/<domain>/generated-*.yaml`. The catalog covers `support`, `coding`, `research`, `ops`, and `general`.

Generated files include `# TODO` markers in evaluator comments. The scenarios are runnable immediately with the mock agent, but before using them with a real agent you should replace the expected substrings with phrases your agent should always include.

The templates default to `final_answer_contains` because it is a substring match. That is usually better than exact output matching for non-deterministic agents.

Recommended flow:

```bash
agentlab generate --domain support --count 5 --agent my-agent
# edit TODO expectations
agentlab run support.generated-happy-path --agent my-agent
agentlab approve @last
agentlab compare @prev @last
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
