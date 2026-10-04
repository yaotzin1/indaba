# Specification: TypeScript port (npm distribution)

> **Status**: Accepted (stages 1-5 done together; the maintainer waived the review pause)
> **Stage entry**: 1
> **Semver impact**: major (a different language and package manager). Nothing was ever published, so no consumer is broken; the first npm release is `0.1.0`.

---

## 1. The problem

Indaba exists only as PHP 8.4. PHP is not installed on the maintainer's Windows host, the PTY runners
cannot run there, and every command goes through Docker. Nobody can try Indaba with one command, and
the people who run agent CLIs (Claude Code, Codex, Gemini, Cursor) already have Node. The goal is
`npx indaba` on Windows, macOS and Linux, with no Docker, WSL or PHP, and a core that a CLI, a
desktop app, a web app and a cloud service can all import.

Indaba is also meant for work that is not programming: several models and tools driven through a
workflow DAG, for example building a DaVinci Resolve timeline with the `shell`, `mcp` and agent
runners. That needs no new engine feature, only a runtime that runs where the user already is.

## 2. User stories

- **US-01.** As a person who runs workflows, I run `npx indaba run workflow.ai.yml` on Windows, with
  Node as the only prerequisite.
- **US-02.** As a workflow author, my existing `workflow.ai.yml` (format version `1.0`) parses and
  behaves exactly as documented; only the verify commands in examples change from `composer` to `npm`.
- **US-03.** As a developer embedding the engine, I `npm install @indaba/core @indaba/engine` and import
  typed ESM modules, in Node or (for `@indaba/core`) a browser.
- **US-04.** As a maintainer, one command (`pnpm qa`) runs every gate on the host, on any OS.

## 3. Acceptance criteria

- [ ] AC-01: `@indaba/core` has zero runtime dependencies and imports no `node:` module (an architecture test fails otherwise).
- [ ] AC-02: every behaviour covered by the 14 PHP test files is covered by an equivalent Vitest test, ported before the code it covers.
- [ ] AC-03: both example workflows parse and plan; invalid files produce the same error messages as the PHP `ErrorBag`.
- [ ] AC-04: the JSONL trace and every event and span attribute keep their names and shapes (`specs/observability`).
- [ ] AC-05: `ShellRunner`, `OpenRouterRunner` (SSE) and the CLI runners (Claude, Codex, Cursor, Antigravity) implement one `Runner` contract; a CLI runner falls back to piped stdio when no PTY is available.
- [ ] AC-06: `indaba run|plan|validate` exist with the same options as the PHP CLI.
- [ ] AC-07: `workflow.ai.yml`, `AGENTS.md`, hooks and CI are retargeted: no Docker, no PHP, TypeScript strict with no `any`, no `@ts-ignore`, no lint suppression.
- [ ] AC-08: every PHP file, `composer.*`, `Dockerfile`, `docker-compose.yml`, `phpstan.neon`, `phpunit.xml.dist` and `vendor/` is gone from the repository.
- [ ] AC-09: the CI matrix runs `pnpm qa` and the node gates on Windows, Linux and macOS.
- [ ] AC-10: `npm pack` of the `indaba` package installs and boots `indaba --version` in a clean directory (smoke test).
- [ ] AC-11: a test registers a runner, a guard type and a listener from outside the core, engine and runners packages, and runs a workflow using all three without editing any of them (see `api-surface.md`, "extension without touching core").

## 4. Non-goals

- No new workflow field, guard type, event or runner in this change. Behavioural parity first.
- No parallel step execution. Steps still run sequentially in topological order, ties by declaration order.
- No Resolve integration, desktop shell, web UI or TUI here. They get their own specs; the existing
  `desktop-app`, `web-app` and `tui` specs assume PHP and are retargeted in follow-up changes.
- No PHP compatibility layer and no `php-legacy/` directory; git history keeps the PHP.
- No publish to npm and no tag. The maintainer asks for that separately.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| a runner exits non-zero | same as PHP: `RunResult.exitCode` carries it, the engine's `on_failure` decides |
| the timeout elapses | the child process tree is killed, the result reports failure; the deadline is honoured through `AbortSignal` |
| the run is cancelled | an `AbortSignal` aborts the runner, worktrees are removed in `finally` |
| `node-pty` is missing or fails to load | CLI runners use piped stdio and report the mode on the result (`ProcessRunResult.mode`); they never crash on import. Recording the mode as a span attribute is a follow-up |
| the workflow file is invalid | `WorkflowValidationError` listing every problem, exit code unchanged |

## 6. Security and data handling

The rules in `AGENTS.md` carry over unchanged. Spawning uses argument arrays only (`spawn` with
`shell: false`); `exec`, `execSync`, `shell: true`, `eval`, `new Function` and `vm` are banned and
`scripts/security-audit.mjs` is extended to scan TypeScript. Paths are resolved and confined with
`path.relative` checks (including symlink resolution for artifacts). Secrets (`OPENROUTER_API_KEY` and
any `*_KEY`, `*_TOKEN`) are redacted before anything reaches a span, event, error or artifact. YAML is
parsed with the `yaml` package in core-schema mode (no custom tags).

## 7. Where it lives

A pnpm monorepo. Pure domain in `@indaba/core`; everything with I/O in `@indaba/engine`,
`@indaba/runners` and the `indaba` CLI. See `plan.md` and `api-surface.md`.

## 8. Clarifications

- **Layout**: pnpm monorepo (`packages/core`, `engine`, `runners`, `cli`); `apps/` reserved for later.
- **Toolchain**: TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), Vitest, Biome. Suppression comments are banned the way `ignoreErrors` was.
- **PHP code**: deleted in this change, last.
- **Runtime**: Node >= 22, ESM only. Package manager pnpm 9.
- **Names**: npm `indaba` (CLI, `bin: indaba`), `@indaba/core`, `@indaba/engine`, `@indaba/runners`. The scope's availability is unverified; if taken, it is renamed in one commit.
- **Naming map**: PHP classes keep their names (`WorkflowEngine`, `ConsensusArbiter`, ...); methods and fields become camelCase; PHP enums become string-literal unions plus a frozen const object; interfaces drop the `Interface` suffix (`RunnerInterface` becomes `Runner`).
- **Events**: PSR-14 dispatching becomes a typed `EventDispatcher` defined in core (listeners may be async, a failing listener is isolated); event class names are kept.
- **Clock and ids**: injected `Clock` and `IdGenerator` interfaces replace `psr/clock`; decision logic reads neither `Date.now()` nor `crypto` directly.
- **Async**: runners and the engine are `async`; ordering stays deterministic because steps are awaited in sequence.
- **Dependencies recorded**: runtime `yaml`; optional `node-pty` (CLI runners only). CLI parsing uses `node:util` `parseArgs`, HTTP uses global `fetch`. Dev: `typescript`, `vitest`, `@biomejs/biome`, `@types/node`.
- **Vision document**: stays verbatim; a note at the top says its PHP references are superseded by this spec.
- **Order of work**: strangler. The TypeScript is ported with the PHP still present and green; the PHP, Docker and PHP gates are removed in the last commits.

## Artifacts not written

- `data-model.md`: no persistent data model changes; the domain model is ported one to one.
- `events.md`: no event or span attribute is added or renamed; `specs/observability` still describes them.
