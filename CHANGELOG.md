# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html).

A changed default is treated as a breaking change even though nothing fails to type-check: the
consumer's code stays green and their runs behave differently, which is exactly what makes it worth
a major. Until 1.0, a breaking change takes the next minor and is labelled as such. The workflow
file schema, the command line, emitted events and span attribute names are part of the public
surface.

The first published version is `0.1.0-alpha.0`, a preview of the packages named under "The TypeScript
port". The PHP prototype that preceded them was never published.

## [Unreleased]

### Added

- **Transport priority: API and ACP first, the CLI as a fallback** (minor; track `feature`; spec
  `specs/transport-priority`).
  - `runner` accepts a name or a list in priority order, on a role and on a step. A runner that could
    not run is passed over for the next; a runner that ran and failed is a failed task and is never
    retried elsewhere. New `RunnerUnavailableError` (a `RunnerError`) marks "nothing was sent to the
    agent"; plugin runners throw it too. `indaba plan` prints the list.
  - `acp` runner: any agent that speaks the Agent Client Protocol (v1) over stdio, started from a preset
    (`claude`, `codex`, `gemini`) or `agent: { command: [...] }`. Indaba answers the agent's permission
    requests and serves its file requests only inside the step's scope; it never selects an "always"
    option and offers no terminal. Tool calls, plans, permission decisions and context use are recorded as
    span events. A cost the agent reports in USD is used; no token counts are invented.
  - `permissions` on a step (`fs.read`, `fs.write` globs, `terminal`) and a `diff_within_scope` guard,
    added automatically, that fails a step which changed anything outside `fs.write`, for every runner.
    `indaba validate` warns about `permissions` without a worktree or without an `acp` runner.
  - `OpenAiCompatibleRunner`: any OpenAI-compatible endpoint (OpenAI, vLLM, Ollama, LM Studio),
    configured with `INDABA_OPENAI_COMPAT_<NAME>_*` environment variables, never from a workflow file.
    `openrouter` is unchanged and still registered.
  - Span events (`Span.addEvent`, written under `events` in the JSONL trace only for spans that have
    them): `indaba.runner.skipped`, `indaba.acp.*`. `RunRequest` gains `permissions`, `agent` and
    `onEvent`; `RunResult` gains `reportedCostUsd`. Through the command line, an unknown runner name is
    now a validation error.
  - Examples `examples/transport-fallback.workflow.ai.yml` and `examples/api-only.workflow.ai.yml`, and a
    guide to this alpha: `docs/using-the-alpha.md`.

### Changed

- When a step sets both a `role` and a `runner`, the step's `runner` is now used (before, the role's
  silently won). The role still supplies the model. `indaba validate` warns when they differ.
- The `openrouter` runner now reports "could not run" (so a fallback list moves on) when there is no key or
  model, when the key is rejected (HTTP 401 or 403), and when the endpoint gives no response at all; it
  used to return a failed result for the last two. Other HTTP errors are still failed results.
- Every runner's "cannot start" error, and an unknown runner name, is now a `RunnerUnavailableError`
  (still a `RunnerError`).

### Fixed

- `indaba run`, `plan` and `validate` without a file now say that `.indaba/workflow.ai.yml` was the default
  they tried and how to name a file, instead of only reporting that the default could not be read.

## [0.1.0-alpha.0] - 2026-10-04

A preview that reserves the package names, published by hand with a security-key login. Because it is
the first version, npm also pointed `latest` at it; from the next prerelease on, prereleases go to
`next`. The API is not stable.

### Added

- **The TypeScript port** (major per the semver rules, but nothing was ever published, so no consumer
  is broken; the first npm release is `0.1.0`; track `feature`). Spec: `specs/typescript-port`.
  - Four npm packages in a pnpm workspace, ESM only, types shipped, Node 22 or newer:
    - `@indaba/core`: the pure domain (workflow model, DAG, step state, mesh, `Runner`, `Guard`,
      `Plugin` and `PluginHost` contracts, tracer, typed event dispatcher). No dependencies, no
      `node:` import; a test fails the build otherwise.
    - `@indaba/engine`: the parser and validator, guards, `WorkflowEngine`, git worktrees and the
      JSONL span exporter. Runtime dependency: `yaml`.
    - `@indaba/runners`: `ShellRunner`, `OpenRouterRunner` (SSE over `fetch`), the Claude Code, Codex,
      Cursor and Antigravity CLI runners, `RunnerRegistry`. CLI runners use a pseudo-terminal through
      the optional `node-pty` and fall back to piped stdio.
    - `indaba`: the `validate`, `plan` and `run` commands with the same options as before, and
      `createEngine`.
  - A plugin contract: `Plugin` and `PluginHost` live in `@indaba/core`, guard types are an open string
    validated against the guard registry, and the command line loads plugins with a repeatable
    `--plugin <module-specifier-or-path>` option. Built-ins register through the same host.
  - Behaviour is a port: the workflow format (`version: "1.0"`), the exit codes, the events
    (`StepStatusChanged`, `SpanStarted`, `SpanEnded`), the `gen_ai.*` span attributes and the JSONL
    trace keep their names and shapes. Public names follow `specs/typescript-port/api-surface.md`
    (`RunnerInterface` is `Runner`, `*Exception` is `*Error`).
  - CI runs `pnpm qa` and a packed-install smoke test on Ubuntu, Windows and macOS, a dependency audit,
    and the Node gates. A release workflow publishes with provenance when a maintainer pushes a `v*`
    tag.
  - User documentation: `docs/getting-started.md`, `docs/workflow-format.md`, `docs/extending.md`.

### Changed

- The development governance is retargeted from PHP, Composer and Docker to Node, pnpm and TypeScript:
  `workflow.ai.yml`, `AGENTS.md`, the hooks, the CI jobs, the skills and rules. The quality gate is
  `pnpm qa` (Biome, `tsc` strict, Vitest) on the host, on any OS; TypeScript strictness replaces the
  analyser level, and no suppression comment of any tool is allowed. `scripts/security-audit.mjs` and
  `scripts/check-workflow.mjs` check TypeScript, `package.json`, `tsconfig.base.json` and `biome.json`.
- `docs/vision.md` is unchanged except for a note that its language references are superseded.
- The older feature specs carry a note that the implementation language changed and behaviour did not.

### Removed

- The PHP implementation, `composer.json` and `composer.lock`, the Docker files, and the PHP analyser,
  formatter and test configuration. History keeps them. The PHP prototype was never published, so
  there is no migration.

### History before the port

These entries describe the PHP prototype that existed in this repository before the port. It was never
published, so nothing below was ever released.

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
  - MCP support through agents: `mcp_servers`, role and step `mcp`, and a `required` (default) or
    `optional` policy, set per workflow (`defaults.mcp_policy`) or per step. Claude Code and Codex get
    the servers injected, Antigravity and Cursor are agent-managed, runners without MCP are refused
    before the run under `required`. Specs: `specs/mcp-support`.
  - First-class `CodexRunner` (`codex exec --sandbox workspace-write`) and `AntigravityRunner`
    (`agy -p`), their invocations taken from the vendors' headless-mode documentation, replacing
    the placeholder command templates; both remain overridable through `INDABA_CODEX_CMD` and
    `INDABA_ANTIGRAVITY_CMD`.
- GitHub releases publish through npm trusted publishing (OIDC, no stored token or one-time
  password): the release workflow packs the four packages with pnpm and stages the tarballs with
  `npm stage publish`; the maintainer approves each staged version with 2FA, prereleases under `next`.
- Development governance: `workflow.ai.yml` (the *development* workflow, not the format Indaba
  executes), the agent instruction set, skills, rules, hooks and CI.
