# Agents

Named agents are configured in `agentlab.config.yaml`.

Agents remain the stable execution unit even when you introduce Tier 1 comparison features. You still run one named agent at a time, but you can now group multiple named agents into a `variant_set` for prompt/model/config comparisons.

This repo supports four provider modes:

- `mock`
- `openai`
- `external_process`
- `http`

Choose the simplest provider that answers the engineering question you actually have:

- `mock` for deterministic harness verification
- `openai` for real model behavior on deterministic tools
- `external_process` for local agents where the runner should still own the tool loop
- `http` for real running services that own their own memory and internal orchestration

## Named Agent Config

Example covering all providers:

```yaml
agents:
  - name: mock-default
    provider: mock
    label: mock-default

  - name: openai-cheap
    provider: openai
    model: gpt-4o-mini
    label: openai-cheap

  - name: custom-node-agent
    provider: external_process
    command: node
    args:
      - custom_agents/node_agent.mjs
    label: custom-node-agent

  - name: my-production-agent
    provider: http
    url: http://localhost:3000/api/chat
    label: my-production-agent
```

Run a named agent with:

```bash
agentlab run support.refund-correct-order --agent mock-default
agentlab run internal-teams.memory-followup-recall --agent my-production-agent
```

Use a named variant set when you want to run one scenario or one suite against multiple agent variants and compare the results later:

```bash
agentlab run support.refund-correct-order --variant-set refund-agent-model-comparison
agentlab run --suite-def pre_merge --variant-set refund-agent-model-comparison
```

Each run records the underlying agent plus richer identity metadata such as `variant_label`, `prompt_version`, `model_version`, `tool_schema_version`, and `config_label`. Those fields appear in CLI summaries, `show`, stored run history, and the UI.

---

## Mock

The built-in mock adapter is the best path for deterministic smoke tests and baseline examples.

Use it when you want:

- fast local verification
- stable docs examples
- predictable benchmark behavior

---

## OpenAI

The OpenAI path uses your API key and a configured model.

Requirements:

- `OPENAI_API_KEY` in the environment
- a named `openai` agent in `agentlab.config.yaml`, or equivalent CLI runtime settings

Example:

```bash
export OPENAI_API_KEY=...
agentlab run support.refund-correct-order --agent openai-cheap
```

The OpenAI path is useful, but less deterministic than the mock path.

---

## External Process

External-process agents communicate with the runner over line-delimited JSON on stdin/stdout.

The runner stays in control of:

- tool execution
- stopping conditions
- runtime limits
- persisted run state

The external agent decides what tool to call next or when to return a final answer.

### Protocol

Runner events:

- `run_started`
- `tool_result`
- `runner_error`

Agent responses:

- `tool_call`
- `final`
- `error`

Minimal flow:

1. the runner sends `run_started`
2. the agent returns `tool_call` or `final`
3. the runner executes the tool and sends `tool_result`
4. the agent continues until it returns `final` or `error`

Working examples:

- `custom_agents/node_agent.mjs`
- `custom_agents/python_agent.py`

Run one of them with:

```bash
agentlab run support.refund-via-config-tool --agent custom-node-agent
```

### Environment Allowlist

External-process agents can optionally define `envAllowlist`.

Use it when a child process needs specific environment variables passed through.

```yaml
agents:
  - name: custom-agent
    provider: external_process
    command: node
    args:
      - custom_agents/node_agent.mjs
    envAllowlist:
      - OPENAI_API_KEY
```

Only allow through what the child actually needs.

---

## HTTP

The `http` provider is for testing real production agents that run as HTTP services — Express, FastAPI, Next.js API routes, or any service that accepts a POST and returns a JSON response.

Unlike the other providers, HTTP agents manage their own conversation history and tool execution internally. agentlab sends the current message and a `conversation_id` each turn, then evaluates the reply.

Use HTTP agents with `type: conversation` scenarios. See [scenarios.md](scenarios.md) for the conversation scenario format.

This is the default choice when validating memoryful or stateful agents that already run as a service.

HTTP agents can be included inside a `variant_set` the same way as other named agents. Runtime-profile fault injection is currently applied only to task/tool-loop runs. Conversation scenarios may still reference a runtime profile for reusable authoring, but ARL does not currently intercept internal HTTP-agent tools.

### Minimal Config

```yaml
agents:
  - name: my-agent
    provider: http
    url: http://localhost:3000/api/chat
```

Default contract: agentlab posts `{ message, conversation_id }` and expects `{ message }` in the response.

### Custom Field Names

If your agent uses different field names:

```yaml
agents:
  - name: my-agent-custom
    provider: http
    url: http://localhost:3000/api/chat
    request_template:
      query: "{{message}}"
      session_id: "{{conversation_id}}"
    response_field: reply
```

`request_template` values support three placeholders:

- `{{message}}` — the current step message
- `{{conversation_id}}` — the UUID generated for this run (consistent across all steps)
- `{{env.VAR_NAME}}` — reads from the environment at runtime

Whitespace inside `{{ }}` is ignored: `{{ message }}` and `{{message}}` are identical.

### Auth and Timeout

```yaml
agents:
  - name: my-agent-auth
    provider: http
    url: http://localhost:3000/api/chat
    headers:
      Authorization: "Bearer {{env.MY_AGENT_TOKEN}}"
    timeout_ms: 10000
```

`timeout_ms` defaults to 30000 (30 seconds) if not set.

Header values also support `{{message}}`, `{{conversation_id}}`, and `{{env.VAR_NAME}}` placeholders.

### Full Config Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `url` | yes | — | HTTP endpoint to POST to |
| `request_template` | no | `{ message, conversation_id }` | Custom request body shape |
| `response_field` | no | `message` | Field to read the reply from |
| `headers` | no | `{}` | Additional HTTP headers |
| `timeout_ms` | no | `30000` | Per-request timeout in milliseconds |
| `label` | no | agent name | Display label in CLI output and run history |

### How It Works

For each step in a conversation scenario:

1. agentlab generates a UUID `conversation_id` once at the start of the run
2. for every step, it POSTs the current message and `conversation_id` to your agent
3. your agent is responsible for maintaining conversation history using that id
4. agentlab reads the reply, measures latency, and runs per-step evaluators
5. if a hard-gate evaluator fails, the run stops immediately

### Error Handling

HTTP provider runs can end with these termination reasons:

| Reason | Cause |
|--------|-------|
| `http_connection_failed` | Could not connect to the URL |
| `http_error` | Agent returned HTTP 4xx or 5xx |
| `timeout_exceeded` | Request exceeded `timeout_ms` |
| `invalid_response_format` | Response is not valid JSON, or the expected field is missing |
| `evaluator_failed` | A per-step hard-gate evaluator failed |

Infrastructure errors (`http_connection_failed`, `http_error`, `timeout_exceeded`, `invalid_response_format`) always produce `status: error` and `score: 0`.

---

## Best Practices

- use named agents instead of ad hoc provider flags
- keep labels stable so compare output stays readable
- prefer the mock path for smoke tests and docs
- use external-process agents when you want to wrap a local Node or Python agent
- use http agents when your agent is already running as a service
- keep the runner authoritative for tools and termination (external_process and mock)
- keep your agent authoritative for tools and history (http)
- choose the simplest provider that answers the engineering question you actually have

## Common Errors

Typical failures:

- missing `OPENAI_API_KEY`
- unsupported provider name
- missing external-process `command`
- invalid `args` or `envAllowlist`
- child process returning invalid JSON
- http agent url not running when the test starts
- http agent returning a field name that doesn't match `response_field`

See [troubleshooting.md](troubleshooting.md) for fixes.
