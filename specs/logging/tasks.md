# Tasks: Logging

Ordered by dependency. Domain first, infrastructure second, console and documentation last.

## Domain (`@indaba/core`)

- [x] **T-01** `Logger`, `LogLevel`, `LogRecord`, `LogContext`, `LogSink`, `createLogger`, `noopLogger`: injected clock, pid and
  redaction; field cleaning; per-sink level; a failing sink dropped with one warning; `child` context. `packages/core/src/logging/logger.ts`.
- [x] **T-02** The settings, described once: `LOGGING_DEFAULTS`, `LOGGING_SETTINGS`, `resolveLoggingSettings` (unknown key,
  wrong type and a secret given as a value are problems that name the key). `packages/core/src/logging/settings.ts`.
- [ ] **T-03** `Plugin.logSinks` and the `PluginHost` method that registers a sink (AC-10).

## Infrastructure

- [ ] **T-04** `@indaba/engine`: `FileLogSink` (JSONL, `maxFileBytes`, `maxFiles`, the folder confined to the project unless typed by the person, whole-line appends).
- [ ] **T-05** `@indaba/engine`: `GelfLogSink` (HTTP, TCP, UDP) and `HttpJsonLogSink`: bounded queue, timeout, bounded retries, one warning per outage, credential from a named variable (AC-15, AC-16).
- [ ] **T-06** The redaction function for `createLogger`, built from the environment's secret values, bearer tokens, API-key shapes and the `#token=` fragment; hostile-input tests built from fragments.

## Console (`indaba`)

- [ ] **T-07** The composition root builds the one logger from `indaba.config` (`logging:`), `--log-level`, `--log-dir` and `INDABA_LOG_LEVEL`; `process.start` record (AC-14); flush on exit.
- [ ] **T-08** `warn` and above on standard error (AC-08) without changing standard output.
- [ ] **T-09** Pass the logger to the engine, the runners, the server and the plugins; `runId`, `taskId`, `stepId`, `traceId` through `child`.
- [ ] **T-10** `indaba ui` logs through it from its first line (specs/web-app, T-11).
- [ ] **T-11** `indaba report [run]` (AC-17), a second step.

## Settings screens (with the actions step of `specs/web-app`)

- [ ] **T-12** `GET`/`PUT /api/v1/settings/logging` and the Settings screen of the web page (AC-20, AC-21).
- [ ] **T-13** The Settings screen of the terminal dashboard.

## Tests

- [x] **T-14** Unit coverage of the core: success and failure paths, determinism, redaction, settings problems. `packages/core/test/logging.test.ts`.
- [ ] **T-15** Layers test in each package: no `console.*` or direct stdout outside the output module (AC-03).
- [ ] **T-16** A run with every sink failing ends with the same states, events and traces (AC-11).

## Documentation

- [ ] **T-17** `docs/` page on logging and reporting an issue; `README.md`, `AGENTS.md` map if a package changes.
- [ ] **T-18** `CHANGELOG.md` under Unreleased (a minor, below 1.0).
- [ ] **T-19** `specs/DEPENDENCY_MAP.md`; no dependency is added.
- [ ] **T-20** The architectural rule in `workflow.ai.yml` ("logging is a must"), with a `Workflow-Change:` trailer, then the sync scripts.
