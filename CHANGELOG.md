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

- **A debate can have an arbiter** (minor; track `feature`; spec `specs/debate-arbiter`). A debate step may set
  `arbiter: "human"` (or the name of one a plugin registers). When its debate ends `stalled` or
  `max_rounds_exceeded`, the arbiter rules `accept` (the step completes) or `reject` (it escalates, with the note)
  instead of escalating at once. `human` asks in the terminal; with no terminal, `--tui` or a cancel it cannot
  answer, so the step escalates exactly as before. New in `@indaba/core`: `Adjudicator`, `Ruling`, `Verdict`,
  `RulingRequest`, `AdjudicatorRegistry`, the step field `arbiter` and `PluginHost.registerAdjudicator`. New span
  attributes: `indaba.arbiter.kind`, `.verdict`, `.source` and `.memo`. Every debate step now also writes
  `.indaba/artifacts/<step>.transcript.md`; a ruled one writes `<step>.ruling.md`.
- **A decision ledger** in `.indaba-decisions/<workflow>.jsonl`, meant to be committed. Every ruling is appended as
  one JSON line (verdict, redacted note, outcome, rounds, commit, time; never the transcript). Before a debate
  runs, a ruling for the same workflow, step, goal and committed files is reused and the debate is skipped; with
  uncommitted changes, or outside git, nothing is reused. A malformed line fails the step, naming file and line.
- `examples/review-debate.workflow.ai.yml`: `claude-code` and `antigravity` review a project and debate it.
- **OpenCode** (minor; track `feature`; spec `specs/opencode`). `agent: "opencode"` on an `acp` role starts `opencode acp`
  and passes on only `OPENCODE_`, `ANTHROPIC_`, `OPENAI_`, `GOOGLE_`, `GEMINI_` and `OPENROUTER_` variables. A new `opencode`
  runner (`OpenCodeRunner`, `opencode run [--model <m>] <prompt>`) is the last-resort CLI transport, so
  `runner: ["acp", "opencode"]` is the chain; it never adds `--auto`. `ACP_AGENT_PRESETS` gains the key `opencode`.
  No dependency is added, and the flags follow OpenCode's documentation but have not yet been run against an
  installed OpenCode.
- **A run event stream** (minor; track `feature`; spec `specs/tui`). Every `indaba run` now also writes
  `.indaba/traces/<traceId>.events.jsonl` while it runs: one record per line for each span start and end, each
  step status change (`PENDING -> RUNNING -> ...`) and each chunk of output a step streams. It exists so
  something can follow a run live: the trace file only gets a span when the span ends, and records neither
  step states nor output. Output is passed through the same credential redaction the command line uses for its
  own messages (variables named like a key, token, secret, password or credential), cut to 4096 characters a
  record, and capped at 2 MiB a run, after which one `truncated` record is written. It can still hold whatever
  an agent printed, so it stays under `.indaba/` (gitignored, local).
- **`@indaba/tui`**, an optional terminal dashboard for a run (minor; track `feature`; spec `specs/tui`). A new
  package built on Ink 8 and React 19, both MIT and pinned exactly, and used by nothing else: steps on one side,
  the selected step's output on the other, keys for selecting, scrolling, following and help, a stacked layout
  below 80 columns, and a notice below 40x8. Every state is a glyph and a word as well as a colour, text from an
  agent is stripped of terminal control sequences before it is drawn, and the terminal is always given back
  (raw mode off, cursor shown) even when drawing fails. It follows a live run or replays a finished one at 1x or
  10x. `indaba watch` opens it on a terminal when it is installed.
  It always draws interactively on a terminal, even when `CI` is set, instead of leaving Ink to treat that as "no
  screen" and write only the last frame.
- **`indaba watch` opens the dashboard** on a terminal when `@indaba/tui` is installed (minor; track `feature`).
  `--plain` or `--output` print lines as before, `--ascii` draws without box or arrow characters, and with no
  terminal, or with the package absent (it says how to install it), the command prints lines. `indaba` lists
  `@indaba/tui` as an optional peer dependency, so `indaba` alone installs none of Ink or React.
- **`indaba run --tui`** (minor; track `feature`; spec `specs/tui`): starts the run in a process of its own and
  opens the dashboard on it, so closing the screen never decides whether the run lives. Quitting asks to detach (the
  run goes on) or cancel (it stops and removes its worktree); an interrupt on the command line cancels. Cancel is a
  message over the child's channel, not a signal, so it stops the run gracefully on Windows too. It needs a
  terminal and `@indaba/tui`, and starts nothing without them.
- **`indaba watch [run]`**: follow a run from the files it writes, or read a finished one. With no run it lists
  them, newest first; a run is its id, a unique start of it, or `latest`. It prints each step change and runner
  start and end as it happens (`--output` adds the streamed lines), then a final view, and exits the way the run
  did (0 completed, 1 failed, 2 escalated, 130 cancelled, 3 when the files end without a final state or the run
  goes quiet for `--stale` seconds). `--replay [--speed 1|10]` plays a finished run with its original timing. Agent
  text is stripped of terminal control sequences before it is printed. Plain output only for now.
- `@indaba/engine`: a pure run view model (`reduceRun`, `RunState`) and plain formatters (`formatPlain`,
  `formatEvent`) over the event stream, and the terminal-text sanitizer (`sanitize`, `createSanitizer`) the CLI
  used internally, now exported.
- `@indaba/core`: a `StepOutput` event, dispatched for each streamed chunk. `@indaba/engine`: `RunEventWriter`,
  `TraceReader` (read all, follow live, list runs; tolerates half-written and malformed lines, and reads runs
  written before the stream existed from their trace file), `parseRecord` and the record types.

### Changed

- A run now leaves two files in `.indaba/traces/` instead of one. The trace file `<traceId>.jsonl` is
  byte-for-byte what it was; the new `<traceId>.events.jsonl` has its own record format. A script that reads
  every `*.jsonl` there and expects span lines should skip names ending in `.events.jsonl`.

### Fixed

- `indaba` now exits when its work is done (patch; track `fix`). On Windows, a run that used a pseudo-terminal
  (every agent CLI runner by default) printed its result and then never returned the prompt, because the
  terminal's `conhost` outlived its child and kept Node's event loop alive. The command line now flushes
  stdout and stderr and exits with the run's status. A program that embeds `@indaba/runners` and uses the
  pseudo-terminal on Windows is not helped by this and must exit itself; `@indaba/runners` is unchanged.
- A cost an ACP agent reports in USD is now recorded on the step's span as `indaba.cost.usd`. The `acp` runner
  returned it as `RunResult.reportedCostUsd` and the changelog said it was used, but the engine never copied it
  onto a span, so such steps had no cost in the trace. A cost worked out from the pricing table still wins, and
  nothing is recorded when neither exists.

## [0.1.0-alpha.2] - 2026-10-05

The second preview, and the release `0.1.0-alpha.1` was meant to be. It makes the API and ACP the primary
ways to reach an agent, with the agent CLIs as a fallback; the changes are listed under
`0.1.0-alpha.1` below. The API is still not stable. It is published under the `next` tag; `latest` stays on
`0.1.0-alpha.0` until the maintainer decides otherwise.

### Fixed

- The four packages now declare `repository`, `bugs` and `homepage`. npm's trusted publishing with provenance
  requires the repository in `package.json` to match the one that built the package; without it, staging
  failed with `422 ... "repository.url" is ""`.

## [0.1.0-alpha.1] - 2026-10-05

**Never published.** The version was tagged, its verification gate passed, and then npm refused to stage
`@indaba/core` because the manifests had no `repository` field (see `0.1.0-alpha.2`). No package of this
version reached npm, and the tag stays as it is. Its contents are released as `0.1.0-alpha.2`.

### Added

- `pnpm try:agent` (`scripts/try-agent.mjs`): tries a real ACP agent from a clean state (a throwaway project,
  the agent from npm into a cache, no machine-specific paths) with three scenarios, `read`, `edit` and
  `outside` a write scope, and checks the trace and patch. Needs `--yes`; never part of CI.
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
  - Logging in to an ACP agent: `agent: { preset | command, auth }` names the agent's own login method
    (from the `authMethods` it lists), and when it is left out and a person is at a terminal, `indaba run`
    lists the methods and asks, as an editor does. Without a terminal it never asks. A failed login is a
    runner that could not run. Found by a first run against the real Gemini CLI, which accepts a session
    without a login and fails at its first model call.
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

- `indaba run` printed a status line glued to the end of an agent's answer when the answer did not end with a
  newline; it now starts on a fresh line.
- `indaba run -vv` wrote an agent's streamed output to the terminal as it came, so escape sequences in it
  (clear screen, window title, hyperlinks, carriage returns, bidirectional overrides) acted on the
  terminal. It now prints plain text only, newlines and tabs kept, including when a sequence is split
  across two chunks. Applies to every runner.
- ACP tool-call events now carry the kind of the call they belong to (an update repeats only the id).
- `indaba run`, `plan` and `validate` without a file now say that `.indaba/workflow.ai.yml` was the default
  they tried and how to name a file, instead of only reporting that the default could not be read.
- Cancelling a run (Ctrl+C) while a step is running now ends it as `CANCELLED` with exit code 130. The
  process runners report an abort as a failed result rather than an exception, so the engine recorded
  the run as `FAILED`. Found by the new end-to-end test on Linux.
- Giving `indaba` a development workflow (`version: "2.0"` with `stages`, `governance`, `tracks` or
  `quality_gates`, like this repository's own `workflow.ai.yml`) now says it looks like a development
  workflow instead of only reporting an unsupported version.

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
