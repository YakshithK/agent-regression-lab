# Runtime Profiles

Runtime profiles are reusable test-environment overlays defined in `agentlab.config.yaml`.

They let you keep degraded-tool conditions and state-related authoring metadata out of individual scenarios.

## Why They Exist

Use a runtime profile when multiple scenarios should run under the same bad condition or seeded state instead of repeating that setup inline.

Typical uses:

- force one tool to time out
- return malformed or partial tool output
- keep a named profile for memory-related scenario setup

## Config Shape

```yaml
runtime_profiles:
  - name: timeout-orders-tool
    tool_faults:
      - tool: orders.list
        mode: timeout
        timeout_ms: 1500

  - name: malformed-docs-read
    tool_faults:
      - tool: docs.read
        mode: malformed_output
```

Supported tool fault modes:

- `timeout`
- `error`
- `malformed_output`
- `partial_output`

## Scenario Usage

Reference the profile from the scenario:

```yaml
runtime_profile: timeout-orders-tool
```

Example command:

```bash
agentlab run internal-teams.tool-timeout-profile --agent mock-default
```

## Current Execution Scope

Today, runtime-profile fault injection is active only for task scenarios where ARL owns the tool loop.

That means:

- task scenarios: tool faults are injected deterministically by the runner
- conversation scenarios: the reference is allowed, but ARL does not intercept the HTTP agent's internal tools

The `state` block is available in config for reusable authoring metadata, but automatic seeded-state execution is not yet applied by the runner.

## Design Rule

Use runtime profiles for reusable conditions, not one-off scenario-specific quirks.
