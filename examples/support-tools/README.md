# Example Support Tools

Minimal package-style tool example for Agent Regression Lab.

Register it in `agentlab.config.yaml` like this:

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
      required:
        - customer_id
```
