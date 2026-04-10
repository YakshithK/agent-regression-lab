# Integrations And Live Services

Use this guide to choose the right ARL provider path for the engineering question you are trying to answer.

## Provider Matrix

### `mock`

Use when you want:

- deterministic smoke tests
- stable docs examples
- baseline verification while changing the harness itself

### `openai`

Use when you want:

- real model behavior against deterministic tool surfaces
- prompt and model validation before merge
- quick local comparisons where the model is the variable

### `external_process`

Use when you want:

- a local Node or Python agent to participate in the runner-controlled tool loop
- the runner to remain authoritative for tools, step limits, and storage
- a thin adapter around an existing local agent implementation

### `http`

Use when you want:

- production-like multi-turn validation against a running service
- the agent to own memory, conversation history, and internal tool execution
- live verification of a real app instead of a deterministic wrapper

`arl-test/` is the canonical example of this path in this repo.

## Live-Service Verification

Default workflow:

1. start the service
2. run `agentlab` from the project containing the relevant scenarios and `agentlab.config.yaml`
3. run one scenario while debugging
4. run a suite before merge
5. compare candidate runs or suite batches against a known baseline

## Integration Design Rule

Choose the simplest provider that answers the engineering question you have.

- If you only need deterministic regression evidence, prefer `mock`.
- If you need real model behavior but deterministic tools, prefer `openai`.
- If you need a local agent implementation but still want runner-owned tools, prefer `external_process`.
- If you need the real running service with its own memory and orchestration, use `http`.
