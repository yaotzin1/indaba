# Tasks: The local web view, delivery step 1 (read-only, over runs)

Ordered by dependency. Domain first, infrastructure second, console and documentation last. Each task independently
checkable. The slice and its limits are in `plan.md`.

## Domain

- [x] **T-01** Declare the contract types of this slice in `@indaba/core` (`web-contract/`): run summary, `ApiError`,
  the responses of `GET /contract`, `GET /runs` and `GET /runs/{id}`, and the event envelope. Types only; `architecture.test.ts`
  stays green and a test asserts the module exports no value.
- [x] **T-02** Check whether `RunState`, `StepView`, `AttemptView`, `RunnerView`, `RunStatus` and `RunSummary` are pure
  data, by reading what `view.ts`, `records.ts` and `trace-reader.ts` import. Record the answer in `plan.md`. If yes, move
  the declarations to core and re-export them from `@indaba/engine` (no import path breaks; a test imports each name from
  the engine). If no, keep them and declare the JSON shapes in T-01 instead.

## Infrastructure

- [x] **T-03** `packages/server`: package, `tsconfig`, `startServer({ roots, staticDir, port?, open? })` on `node:http`
  bound to `127.0.0.1` only; a random token per start; `ServerHandle.url` with the token in the fragment; `close()`.
- [x] **T-04** Request checks: `Authorization: Bearer` on every `/api/v1` request, `Host` in `localhost`, `127.0.0.1`,
  `[::1]` with the server's own port, every method but `GET` refused, no CORS header, `Referrer-Policy:
  no-referrer`. The static files are served without the token, with the `Host` check and the Content-Security-Policy of
  AC-16.
- [x] **T-05** `GET /contract`, `GET /runs`, `GET /runs/{id}`: from `TraceReader`, ids matched with `isRunId` before any
  path is built, output through the sanitizer and the redaction the traces use.
- [x] **T-06** `GET /runs/{id}/events` as SSE, resumable with `Last-Event-ID` without a duplicate or a gap (AC-05), built
  on `TraceReader.follow`; `GET /runs/{id}/steps/{step}/log` bounded by a `Range` header; `GET /events` announcing runs
  started and ended, by polling the trace directory with an injected clock and interval.
- [ ] **T-07** `packages/web`: Vite and React with TypeScript; fetch-streaming SSE with the header; the token read from
  the fragment, removed from the address, kept in memory. Imports `@indaba/core` types only and no `node:` module.
- [ ] **T-08** The Runs screen (id, workflow name, status, started, cost) and the Run screen: graph of steps (React Flow
  and `dagre`, left to right, state colour and text label, a loop as a badge), task list with state and duration, output,
  cost with "unknown" and partial marked (AC-19), reduced motion, keyboard and screen reader (AC-20), strings from a
  catalogue.
- [ ] **T-09** The maintainer reviews three sketches (Runs, Run, and the page's empty and failure states) before T-08's
  markup is final (AC-21 for this slice).
- [ ] **T-10** Packaging: where the built page lives (inside `@indaba/server` or its own package), `files` and `exports`
  maps, the published-files audit, and the packed-install smoke test still boots `indaba` without either package.

## Console

- [ ] **T-11** `indaba ui [--port <n>] [--no-open] [--root <dir>...]` in `packages/cli`, loading `@indaba/server`
  lazily through a loader like `tui-loader.ts`, with a plain message when it is not installed; prints the address, opens
  the browser unless `--no-open`, and ends with the command.

## Tests

- [ ] **T-12** Hostile-input tests, with strings built from fragments: a run id or step id with `..`, separators, a drive
  letter, an encoded form and a NUL; a `Host` of another name and of a DNS-rebinding name; a missing and a wrong token; a
  `POST`; agent output with escape sequences, HTML and a `javascript:` link; a secret in the environment of a recorded
  step. Nothing reaches a path, a response or a log.
- [ ] **T-13** Unit coverage for the server (success and failure paths, resume without duplicate or gap, a dropped
  connection, a run that is still being written) and the page (graph from a fixture run, every state and a loop,
  unknown events shown generically); coverage stays at or above 85% on all four metrics.
- [x] **T-14** `layers.test.ts` for `packages/server` (imports itself, `node:*`, `@indaba/engine`, `@indaba/core`; no UI
  package) and `packages/web` (imports itself, `react`, the UI libraries and `import type` from `@indaba/core`; no `node:`);
  the CLI test keeps the lazy edge; `@indaba/core` architecture test green.
- [ ] **T-15** `pnpm e2e`: start the built CLI with `indaba ui --no-open` over a fixture trace, fetch the Runs list and one
  run with the token, and see a refusal without it.

## Documentation

- [ ] **T-16** `README.md`, `docs/` (a page for `indaba ui`) and `AGENTS.md` repository map (two packages).
- [ ] **T-17** `CHANGELOG.md` entry under Unreleased: a minor, below 1.0, with the classification.
- [ ] **T-18** `specs/DEPENDENCY_MAP.md`: the two packages, the core types and their edges, and the row for `web-app`.
- [ ] **T-19** `workflow.ai.yml`: the new runtime dependencies in `project.runtime_dependencies`, each with the package
  that loads it, and `scripts/check-workflow.mjs` passing (a `Workflow-Change:` trailer on the commit).

## Stage 7: Verification

- [ ] `pnpm qa` and the node gates (`node scripts/check-workflow.mjs`) green end to end, output recorded in `review.md`
- [ ] `pnpm e2e` and `pnpm smoke` green, output recorded in `review.md`
- [ ] A manual run on Windows, macOS and Linux, or the report says which was not done
