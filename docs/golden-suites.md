# Golden Suites

Golden suites are the scenario portfolio internal engineering teams should keep as long-lived regression assets.

They are not just demos. They are engineering memory for the behaviors that matter before merge and before release.

## Required Launch Categories

- coding agent regressions
- support and policy agents
- incident / ops agents
- memoryful multi-turn agents
- tool-failure recovery
- ambiguity and escalation
- adversarial or malformed tool output
- cost / latency / step-discipline checks

## Recommended Portfolio Composition

- 5 golden workflows
- 5 historical regressions
- 5 ugly edge failures
- 3 degraded-tool scenarios
- 2 policy or escalation scenarios

## How To Use Golden Suites

1. Keep one or two scenarios for the happy path that must always work.
2. Add scenarios from real incidents as soon as a failure is understood.
3. Add edge-case scenarios for ambiguity, degraded tools, malformed outputs, and multi-turn drift.
4. Group launch-critical workflows into config-level `suite_definitions`.
5. Run one scenario while debugging locally.
6. Run a `pre_merge` suite definition before merge.
7. Run curated `release` and `incident_regressions` suite definitions before release.

## Suggested Initial Internal-Team Scenarios

- coding destructive edit guardrails
- incident triage under noisy alerts
- escalation on ambiguity instead of guessing
- malformed tool output or partial tool output
- cross-session memory leakage
- follow-up recall across turns

## Design Rule

Treat suite composition as a product artifact.

The suite is part of the system design, not a disposable test folder.

## Recommended Suite Definitions

Use first-class `suite_definitions` instead of ad hoc tags alone:

```yaml
suite_definitions:
  - name: smoke
    include:
      tags: [smoke]

  - name: pre_merge
    include:
      tags: [smoke, regression]

  - name: release
    include:
      suites: [support, internal-teams]

  - name: incident_regressions
    include:
      tags: [incident, regression]
```

These become the operational units you wire into local verification, pre-merge checks, and release readiness.
