# Example Coding Tools

Minimal package-style coding-tool example for Agent Regression Lab.

Register it in `agentlab.config.yaml` like this:

```yaml
tools:
  - name: coding.read_repo_hint
    package: "@agentlab/example-coding-tools"
    exportName: readRepoHint
    description: Return a small repo hint for the target path.
    inputSchema:
      type: object
      additionalProperties: false
      properties:
        path:
          type: string
      required:
        - path
```
