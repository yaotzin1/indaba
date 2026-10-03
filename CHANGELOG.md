# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html).

A changed default is treated as a breaking change even though nothing fails to type-check: the
consumer's code stays green and their runs behave differently, which is exactly what makes it worth
a major. Until 1.0, a breaking change takes the next minor and is labelled as such. The workflow
file schema, the command line, emitted events and span attribute names are part of the public
surface.

## [Unreleased]

### Added

- **The initial engine** (minor; track `feature`). Specs: `specs/workflow-engine`,
  `specs/agent-mesh`, `specs/runner-adapters`, `specs/git-workspace`, `specs/observability` and
  `specs/cli`.
  - A workflow engine: a YAML parser with parse-time validation, DAG ordering, a step state machine,
    guards and bounded, isolated retries.
  - An agent mesh: immutable messages, a blackboard, a consensus arbiter and ping-pong detection.
  - Runners behind one `RunnerInterface`: shell, Claude Code and Cursor CLIs, and OpenRouter over
    Server-Sent Events.
  - Git worktree isolation per task, with diff and patch handling.
  - Tracing aligned with the OpenTelemetry GenAI conventions, token usage and cost accounting, and
    PSR-14 span events.
  - A `bin/indaba` command line with `validate`, `plan` and `run`.
  - First-class `CodexRunner` (`codex exec --sandbox workspace-write`) and `AntigravityRunner`
    (`agy -p`), their invocations taken from the vendors' headless-mode documentation, replacing
    the placeholder command templates; both remain overridable through `INDABA_CODEX_CMD` and
    `INDABA_ANTIGRAVITY_CMD`.
- Development governance: `workflow.ai.yml` (the *development* workflow, not the format Indaba
  executes), the agent instruction set, skills, rules, hooks and CI.
