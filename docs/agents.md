# Agents

Named agents are configured in `agentlab.config.yaml`.

This repo currently supports three provider modes:

- `mock`
- `openai`
- `external_process`

## Named Agent Config

Example:

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
```

Run a named agent with:

```bash
agentlab run support.refund-correct-order --agent mock-default
```

## Mock

The built-in mock adapter is the best path for deterministic smoke tests and baseline examples.

Use it when you want:

- fast local verification
- stable docs examples
- predictable benchmark behavior

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

## Environment Allowlist

External-process agents can optionally define `envAllowlist`.

Use it when a child process needs specific environment variables passed through.

Example shape:

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

## Best Practices

- use named agents instead of ad hoc local command strings
- keep labels stable so compare output stays readable
- prefer the mock path for smoke tests and docs
- use external-process agents when you want to wrap a local Node or Python agent implementation
- keep the runner authoritative for tools and termination

## Common Errors

Typical failures:

- missing `OPENAI_API_KEY`
- unsupported provider name
- missing external-process `command`
- invalid `args` or `envAllowlist`
- child process returning invalid JSON

See [troubleshooting.md](troubleshooting.md) for fixes.
