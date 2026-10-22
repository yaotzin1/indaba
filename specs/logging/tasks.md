# Tasks: Logging

Ordered by dependency. Domain first, infrastructure second, console and documentation last.

## Domain (`@indaba/core`)

- [x] **T-01** `Logger`, `LogLevel`, `LogRecord`, `LogContext`, `LogSink`, `createLogger`, `noopLogger`: injected clock, pid and
  redaction; field cleaning; per-sink level; a failing sink dropped with one warning; `child` context. `packages/core/src/logging/logger.ts`.
- [x] **T-02** The settings, described once: `LOGGING_DEFAULTS`, `LOGGING_SETTINGS`, `resolveLoggingSettings` (unknown key,
  wrong type and a secret given as a value are problems that name the key). `packages/core/src/logging/settings.ts`.
- [x] **T-03** `Plugin.logSinks` and the `PluginHost` method that registers a sink (AC-10): `PluginHost.registerLogSink`,
  `createLogger` returning `addSink` (`LogSinkRegistry`), `CreateEngineOptions.logSinks`.

## Infrastructure

- [x] **T-04** `@indaba/engine`: `FileLogSink` (JSONL, `maxFileBytes`, `maxFiles`, the folder confined to the project unless typed by the person, whole-line appends).
- [x] **T-05** `@indaba/engine`: `GelfLogSink` (HTTP, TCP, UDP) and `HttpJsonLogSink`: bounded queue, timeout, bounded retries, one warning per outage, credential from a named variable (AC-15, AC-16).
- [x] **T-06** The redaction function for `createLogger`, built from the environment's secret values, bearer tokens, API-key shapes and the `#token=` fragment; hostile-input tests built from fragments.

## Console (`indaba`)

- [x] **T-07** The composition root builds the one logger from `indaba.config` (`logging:`), `--log-level`, `--log-dir` and `INDABA_LOG_LEVEL`; `process.start` record (AC-14); flush on exit.
  Done: the options, the variable, `process.start` and `process.end`, flush before the command returns
  (`packages/cli/src/log.ts`, `main.ts`). `indaba.config` (section 8, item 7, confirmed by the maintainer): read by
  `readProjectConfig` in `@indaba/engine`, a problem is a usage error. A second Ctrl+C flushes for at most 2 s (`exit.ts`).
- [x] **T-08** `warn` and above on standard error (AC-08) without changing standard output.
- [ ] **T-09** Pass the logger to the engine, the runners, the server and the plugins; `runId`, `taskId`, `stepId`, `traceId` through `child`.
  Done: the plugins (`host.logger`), the engine's events through the bridge (T-21), with `taskId`, `stepId` and
  `traceId`, and the runners (`RunnerRegistry.withDefaults({ logger })`: processes and HTTP requests). The server: done
  2026-10-21 (`ServerOptions.logger`, `indaba ui` hands it the command's logger).
- [x] **T-21** `logEngineEvents` (AC-22) in `@indaba/engine`, connected by `createEngine`; the logging contract
  re-exported by the engine (AC-23).
- [x] **T-22** `@indaba/tui` takes `logger` in `watch`: opened, closed, a failing source (AC-23).
- [x] **T-10** `indaba ui` logs through it from its first line (specs/web-app, T-11). **Done 2026-10-21:** `process.start`
  and `process.end` as every command, the server's start (its address, never the token) and stop, each refused request
  (method, path without query or fragment, status, reason) at `info`, each stream opening and closing, a not-found at
  `debug`, a failed request at `error`; no body and no `Authorization` header. `--log-level` and `--log-dir` in its help.
  Tests: `packages/server/test/logging.test.ts`, `packages/cli/e2e/ui.e2e.test.ts` (reads the file the built command
  leaves).
- [x] **T-11** `indaba report [run]` (AC-17): a redacted folder under `.indaba/reports/`; nothing is sent.

## Settings screens (with the actions step of `specs/web-app`)

- [x] **T-12** `GET`/`PUT /api/v1/settings/logging` and the Settings screen of the web page (AC-20, AC-21), with
  `POST .../check` (the draft checked by the server as it is typed) and `POST .../test` (one test record). The server
  writes only through `ServerOptions.loggingSettings`, which `indaba ui` gives it for the first root; the token, the
  `Host` check, a same-origin check, JSON only and a 64 KiB body limit guard every write; everything else stays `GET`.
- [x] **T-13** The Settings screen of the terminal dashboard: `editLoggingSettings` in `@indaba/tui`, opened by
  `indaba settings` (which prints the settings without a terminal).

## Tests

- [x] **T-14** Unit coverage of the core: success and failure paths, determinism, redaction, settings problems. `packages/core/test/logging.test.ts`.
- [x] **T-15** Layers test in each package: no `console.*` or direct stdout outside the output module (AC-03). Core,
  engine, runners and tui; the cli rule already existed. The server's: `packages/server/test/layers.test.ts`
  (2026-10-21).
- [x] **T-16** A run with every sink failing ends with the same states, events and traces (AC-11).

## Documentation

- [x] **T-17** `docs/logging.md` on logging and reporting an issue; `README.md`, `getting-started.md`, `extending.md`.
  No package was added, so the `AGENTS.md` map is unchanged.
- [x] **T-18** `CHANGELOG.md` under Unreleased (a minor, below 1.0).
- [x] **T-19** `specs/DEPENDENCY_MAP.md`; no dependency is added.
- [x] **T-20** The architectural rule in `workflow.ai.yml` ("logging is a must"), with a `Workflow-Change:` trailer, then the sync scripts.
