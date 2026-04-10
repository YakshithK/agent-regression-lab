# Variant Sets

Variant sets are named comparison groups defined in `agentlab.config.yaml`.

They are the Tier 1 mechanism for prompt, model, tool-schema, and config experiments without turning every comparison into manual CLI bookkeeping.

## Why They Exist

Named agents remain the executable unit.

Variant sets sit on top of named agents so you can run the same scenario or suite against multiple variants and compare the results intentionally.

## Config Shape

```yaml
variant_sets:
  - name: refund-agent-model-comparison
    variants:
      - agent: mock-default
        label: baseline
        prompt_version: prompt-v3
        model_version: mock-model
        tool_schema_version: support-tools-v1
        config_label: baseline-refund-flow
      - agent: mock-compact
        label: concise
        prompt_version: prompt-v4
        model_version: mock-model
        tool_schema_version: support-tools-v1
        config_label: concise-refund-flow
```

## CLI Usage

Run one scenario against all variants:

```bash
agentlab run support.refund-correct-order --variant-set refund-agent-model-comparison
```

Run one suite definition against all variants:

```bash
agentlab run --suite-def pre_merge --variant-set refund-agent-model-comparison
```

## Stored Identity

Each resulting run stores and surfaces:

- `variant_set_name`
- `variant_label`
- `prompt_version`
- `model_version`
- `tool_schema_version`
- `config_label`
- `config_hash`

Those fields appear in CLI run summaries, `agentlab show`, run history, comparisons, and the UI.

## Design Rule

Use variant sets for intentional experiments. Keep named agents stable, and treat the variant set as the comparison layer.
