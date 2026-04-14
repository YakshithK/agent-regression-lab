# Custom Tools

Custom tools are registered in `agentlab.config.yaml` and can be loaded from repo-local JS/TS modules or installed npm packages.

This is the main extension point when built-in tools are not enough.

## What A Tool Registration Needs

Each tool entry must define:

- `name`
- exactly one source:
  - `modulePath`, or
  - `package`
- `exportName`
- `description`
- `inputSchema`

Repo-local example:

```yaml
tools:
  - name: support.find_duplicate_charge
    modulePath: user_tools/findDuplicateCharge.ts
    exportName: findDuplicateCharge
    description: Find the duplicated charge order id for a given customer.
    inputSchema:
      type: object
      additionalProperties: false
      properties:
        customer_id:
          type: string
          description: Customer id to inspect for duplicated charges.
      required:
        - customer_id
```

Installed package example:

```yaml
tools:
  - name: support.find_duplicate_charge
    package: "@agentlab/example-support-tools"
    exportName: findDuplicateCharge
    description: Find the duplicated charge order id for a given customer.
    inputSchema:
      type: object
      additionalProperties: false
      properties:
        customer_id:
          type: string
          description: Customer id to inspect for duplicated charges.
      required:
        - customer_id
```

## Tool Module Shape

The exported function should be async and should return JSON-serializable output.

Minimal example:

```ts
export async function myTool(input: unknown): Promise<{ ok: boolean }> {
  return { ok: true };
}
```

The existing working example is:

- `user_tools/findDuplicateCharge.ts`
- `examples/support-tools`
- `examples/coding-tools`

## Important Constraints

- each tool must define exactly one of `modulePath` or `package`
- `modulePath` must stay within the repo
- the module must exist at load time
- installed packages must be resolvable from the current project
- the named export must exist
- tool input should be validated defensively inside the tool
- tool output should be deterministic and JSON-serializable

For launch usage, treat tools as fixture-backed local functions, not live integrations.

## Recommended Pattern

Use this approach:

1. read fixture data from `fixtures/`
2. validate the input shape
3. return a small structured result
4. throw a clear error for missing fixture state or invalid input

The current `findDuplicateCharge` tool shows that pattern.

## Wiring A Tool Into A Scenario

1. register the tool in `agentlab.config.yaml`
2. add the tool name to the scenario allowlist
3. add an evaluator that confirms the tool was used correctly if the behavior is important

Example scenario:

- `scenarios/support/refund-via-config-tool.yaml`

## Best Practices

- keep tool names stable and descriptive
- keep tools scenario-agnostic where possible
- prefer read-only or sandboxed behavior
- do not mutate global machine state
- do not call live external systems in benchmark paths
- keep schemas narrow so agent tool calls are easy to validate and compare

## Common Errors

Typical config failures:

- duplicate tool names
- repo-external module paths
- missing module files
- missing exports
- invalid `inputSchema` shape

See [troubleshooting.md](troubleshooting.md) for failure examples and fixes.

For installed-package workflows, a good local path is:

```bash
npm install @agentlab/example-support-tools
```
