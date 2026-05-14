# Changelog

All notable changes to Agent Regression Lab are documented here.

## [0.7.1] - 2026-05-13

### Changed
- npm package description updated to "Regression testing for AI agents — catch prompt and behavior changes before they ship."
- npm keywords expanded for discoverability (added: pytest, llm, openai, anthropic, claude, prompt-testing, agent-testing, evals).

## [0.7.0] - 2026-05-12

### Added
- **`agentlab generate`** — scaffold scenario YAML files from a built-in template library. Supports 5 domains (support, coding, research, ops, general) with 18 templates. No LLM required, no server needed. Use `--domain`, `--agent`, `--count` to customise.
- **`agentlab init` v2** — fully interactive onboarding powered by `@inquirer/prompts`. Prompts for provider, domain, agent name, base URL, and harness language. Writes ready-to-run scenarios, fixture stubs, and a harness scaffold (Node.js or Python) for external-process agents. Two modes: in-place (`agentlab init`) and subdirectory (`agentlab init my-project`).
- **`@last` and `@prev` run ID shorthands** — use `@last` in any command that accepts a run ID to refer to the most recent run, and `@prev` for the second-most-recent. Both support optional scenario scoping: `@last:scenario-id`.
- **CLI visual overhaul** — rich terminal output via chalk, ora, and boxen. Gradient titles, spinner progress, colour-coded badges (pass/regression/improved), section headers, and a score bar. All colour output respects `NO_COLOR` and `FORCE_COLOR` environment variables and degrades cleanly in non-TTY environments.
- **Rust-style boxed error messages** — all CLI errors render in a red bordered box with a `Run:` suggestion so users always know the next command to try.

### Changed
- `agentlab init` now calls `agentlab generate` internally to write scenarios, keeping both commands consistent.
- Error output in `bin/agentlab.js` is routed through `formatCliErrorMessage` for consistent styled formatting.
- `docs/scenarios.md` updated with `agentlab generate` usage and domain reference.
- README rewritten to lead with the npm install path and interactive `agentlab init`.

### Fixed
- `scoreBar` no longer throws `RangeError` when an agent returns a score outside `[0, 100]`.
- `heroBanner` box borders now align correctly in terminals — ANSI escape sequences no longer corrupt `padEnd` column width calculations.
- `agentlab list` difficulty column now pads correctly before applying colour.
- `.gitignore` no longer accumulates duplicate `artifacts/` entries on repeated `agentlab init` calls.
- `agentlab generate` uses atomic file creation (`wx` flag) to prevent silent overwrites from concurrent invocations.
- Template substitution now throws on unknown `{{variables}}` rather than silently emitting empty strings.
- `agentlab init` rejects project names containing path separators or `..` to prevent directory traversal.
- Agent names containing YAML special characters are sanitised before being written to `agentlab.config.yaml`.

## [0.6.0] - 2026-05-11

### Added
- `agentlab run --demo` — narrative two-phase demo showing baseline pass, auto-approval, simulated regression, and diff output. No config required.
- `agentlab approve <run-id>` — mark a run as the approved baseline for its scenario and agent version.
- `agentlab compare --baseline <scenario-id> <run-id>` — compare a candidate run against the approved baseline automatically.
- `normalize` field in scenario YAML — `strip_whitespace`, `lowercase`, and `ignore_dates` rules to reduce noise in comparisons.
- `setup_script` field in scenario YAML — run a TypeScript fixture script before each scenario execution (30 s timeout, path validation).
- Inline ANSI colour and spinner helpers with TTY and `NO_COLOR` safeguards.
- Win-state messages for pass, no-regression, and improvement outcomes.

### Changed
- Schema migrated to v3 transparently — no data loss, no throw on upgrade.
- `is_baseline` scoped to `(scenario_id, agent_version_id)` pair.
- `normalize_config_json` stored on runs at record time rather than looked up from scenario YAML at compare time.
