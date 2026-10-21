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
- [x] **T-07** `packages/web`: Vite and React with TypeScript; fetch-streaming SSE with the header; the token read from
  the fragment, removed from the address, kept in memory. Imports `@indaba/core` types only and no `node:` module.
- [x] **T-08** The Runs screen (id, workflow name, status, started, cost) and the Run screen. Both tables are `apsw-gridwright`
  grids through `apsw-gridwright-mui` (C-02): the steps with their tries as child rows. The graph is one component with a view
  mode and an edit mode (C-13): React Flow and `dagre`, left to right, state colour and text label, the failure route drawn
  as its own edge, every step selectable. A selected step shows what happened (runners, models, tokens, cost, tools,
  permissions, guards, tries, output) and what happens if it fails. Cost with "unknown" and partial marked (AC-19), reduced
  motion, keyboard and screen reader (AC-20), strings from a catalogue.
- [x] **T-09** The maintainer reviews the sketches (Runs, Run, the empty and failure states, a debate's discussion, and the
  Workflows screen and the editor as later views) before T-08's markup is final (AC-21 for this slice). Drafted in `sketches/` (2026-10-16, revised
  2026-10-17, themed 2026-10-20) with questions in its README. The maintainer approved the look on 2026-10-20 and asked for
  the tables on `apsw-gridwright`; the open questions were taken as recommended (no cost column on Runs, a banner and greyed
  `last known` states on a drop, one place for output, left to right with a readable zoom on a phone, "steps" everywhere,
  the structure recorded in the trace, the debate summary only).
- [x] **T-10** Packaging: where the built page lives (inside `@indaba/server` or its own package), `files` and `exports`
  maps, the published-files audit, and the packed-install smoke test still boots `indaba` without either package.
  **Done 2026-10-21:** inside `@indaba/server`, in `page/` (plan, "Packaging"). The server's `prepack` copies
  `packages/web/dist` there with `THIRD-PARTY-LICENSES.txt` (`scripts/stage-page.mjs`) and its `postpack` removes it;
  `files` gains `page`, `exports` is unchanged (the page is read from disk, never imported). `pnpm smoke` packs the six
  published packages (never `@indaba/web`), audits every tarball's files, boots `indaba` with neither optional package
  installed, and checks that an installed server finds its page. Self-tests in `scripts/stage-page.test.mjs` and
  `scripts/smoke-pack.test.mjs`.

## Engine, before T-08

- [x] **T-20** Record a run's structure in its trace (C-14). **Amended 2026-10-20:** a step's span exists only once the step
  runs, so the structure is not on each step's span but on the run's root span when the run starts: one attribute,
  `indaba.workflow.structure`, a JSON list of every step in the order the engine runs them, with `dependsOn` and `onFailure`
  (`action`, `target`, `maxRetries`). The graph can then draw the steps that have not run yet. `RunState` gains
  `structure` (`StepStructure`, `StepFailureRoute` in `@indaba/core`'s `web-contract`), filled by the reducer and left
  `undefined` for a run recorded without it or with a value it cannot trust (all or nothing: a wrong edge is worse than none);
  `steps` and the dashboard are unchanged. Writer and reader are one module, `packages/engine/src/trace/structure.ts`.
  Adding an attribute and a field is a minor. Tests in `packages/engine/test/structure.test.ts`: a retry, an escalation and a
  step with none, the engine's run order, an old trace, and nineteen malformed or hostile values.
- [x] **T-23** (added 2026-10-21, answer 1) `RunSummary.cost` (`RunCost` in `@indaba/core`), filled by
  `listRuns` with the reducer the run's view uses; a Cost column on the Runs screen with a tooltip of the calls and the
  unpriced ones; on the Run screen a table of the cost of each step that called a model, adding up to the total
  (`packages/web/src/cost.ts`, `ui/CostTable.ts`). Tests in `packages/engine/test/trace-reader.test.ts`,
  `packages/web/test/cost.test.ts`, `ui.test.ts` and `client.test.ts` (a cost that is not a real, non-negative sum is
  refused).
- [x] **T-21** (done 2026-10-21: one JSON file per run and step, in a folder the person chooses; see C-15) Decide how a run keeps its debate messages (C-15): the board of `specs/run-blackboard`, or the transcript copied
  under the run's trace id. Not needed for delivery step 1; until then the discussion shows the summary only.

## Console

- [x] **T-11** `indaba ui [--port <n>] [--no-open] [--root <dir>...]` in `packages/cli`, loading `@indaba/server`
  lazily through a loader like `tui-loader.ts`, with a plain message when it is not installed; prints the address, opens
  the browser unless `--no-open`, and ends with the command.

## Tests

- [x] **T-24** (added 2026-10-21, found while writing T-16) Two answers of 2026-10-21 that are not built: answer 3, a
  `last known` label on each state chip when the stream drops (today the chips turn grey and only the banner says it), and
  answer 5, the graph top to bottom below 640 px (today it is left to right everywhere, opening at a readable zoom).
  **Done 2026-10-21:** a `StaleContext` that the app provides from the stream state; `StateChip` and the graph's cards
  add `, last known` while it is set. `buildGraph(run, direction)` lays out `TB` as well as `LR`, the cards' handles
  follow (`handlesOf`), and `useMediaQuery(NARROW)` picks the direction, following a resize. Tests in `logic.test.ts`
  and `ui.test.ts`; `docs/web-view.md` updated.
- [x] **T-25** (added 2026-10-21, after rebasing onto `main` with `specs/logging`) The server and `indaba ui` log through
  the command's logger: AC-09 of `specs/logging`, and its tasks T-09 (the server), T-10 and T-15 (the server's layers
  rule). `ServerOptions.logger` is optional and defaults to a logger that records nothing.
- [x] **T-22** (added 2026-10-21, answer 2) The page stops after repeated failed attempts, shows `Server stopped`, and offers `Check again`.
- [x] **T-12** Hostile-input tests, with strings built from fragments: a run id or step id with `..`, separators, a drive
  letter, an encoded form and a NUL; a `Host` of another name and of a DNS-rebinding name; a missing and a wrong token; a
  `POST`; agent output with escape sequences, HTML and a `javascript:` link; a secret in the environment of a recorded
  step. Nothing reaches a path, a response or a log. **Done 2026-10-21:** `packages/server/test/hostile.test.ts` (fifteen
  ids against every endpoint, eleven `Host` values, ten wrong or misplaced tokens, every writing method with the
  server's own `Origin`, escapes, an OSC 8 link, markup and a script URL in output, and no write to a log),
  `packages/server/test/runs.test.ts`, the page's half in `packages/web/test/ui.test.ts`, and the secret through a real
  `indaba run` in `packages/cli/test/secret-to-page.test.ts`. **Found:** the server cleaned output and reasons but not
  the workflow's name, the task id, runner names, models, states, tool kinds or a debate's outcome, so an escape in a
  workflow name reached the page; `snapshotOf` and the list now clean every text of a run.
- [x] **T-13** Unit coverage for the server (success and failure paths, resume without duplicate or gap, a dropped
  connection, a run that is still being written) and the page (graph from a fixture run, every state and a loop,
  unknown events shown generically); coverage stays at or above 85% on all four metrics. **Done 2026-10-21:**
  `packages/server/test/streams.test.ts` (a half-written line shown once it is finished, a resume after a drop with
  every id above the last seen and the first snapshot holding all that was written meanwhile, a resume with nothing
  new, five dropped streams then a prompt close, a 500 that names no path, a 400, a 404 for bad percent-encoding), and
  in `packages/web/test/ui.test.ts` every state in words including an unknown one, a step that retries itself, the
  notes of unreadable records, and the cost table with calls still running. Coverage after: all files 97.7 / 93.7 /
  97.7 / 97.9; `server/src` 97.3 / 92.0 / 100 / 97.2; `web/src` 100 / 96.6 / 100 / 100; `web/src/ui` 97.0 / 91.9 /
  97.2 / 97.3 (statements, branches, functions, lines).
- [x] **T-14** `layers.test.ts` for `packages/server` (imports itself, `node:*`, `@indaba/engine`, `@indaba/core`; no UI
  package) and `packages/web` (imports itself, `react`, the UI libraries and `import type` from `@indaba/core`; no `node:`);
  the CLI test keeps the lazy edge; `@indaba/core` architecture test green.
- [x] **T-15** `pnpm e2e`: start the built CLI with `indaba ui --no-open` over a fixture trace, fetch the Runs list and one
  run with the token, and see a refusal without it. **Done 2026-10-21:** `packages/cli/e2e/ui.e2e.test.ts`. The fixture is
  a trace the built `indaba run` writes (two shell steps), so the test also proves the run's structure and cost reach the
  page; the list and the run answer with the printed token, three endpoints refuse with none and with a wrong one, the
  page is served without it, and Ctrl+C stops the command (exit 130, checked off Windows, where a signal ends a process at
  once).

## Documentation

- [x] **T-16** `README.md`, `docs/` (a page for `indaba ui`) and `AGENTS.md` repository map (two packages). **Done
  2026-10-21:** `docs/web-view.md` (options, the printed address, what is needed and the two messages when it is not, a
  checkout's `pnpm indaba ui`, the stopped-server banner, licences, an up-to-date "Not there yet"),
  `docs/web-view-development.md` (the CLI piece, `cost.ts`, `CostTable.ts`, `Discussion.ts`, a Packaging section, the
  `BUNDLED`/`TOOLS` rule), `docs/getting-started.md` (`indaba ui`, `.indaba/discussions`), `docs/roadmap.md`, `README.md`
  (`ui` and `@indaba/server` in the package table, how to start it while unpublished) and `AGENTS.md` (`ui`, the page
  inside the server's tarball). Writing it found T-24.
- [x] **T-17** `CHANGELOG.md` entry under Unreleased: a minor, below 1.0, with the classification. **Done 2026-10-21:**
  one entry per part, each classified: `@indaba/server` with its endpoints, its defaults (named as a major to change)
  and the core declarations; `indaba ui` with `--discussion-dir`; the page; the run's structure; the cost on the list;
  the kept discussion; the stopped-server banner.
- [x] **T-18** `specs/DEPENDENCY_MAP.md`: the two packages, the core types and their edges, and the row for `web-app`.
- [x] **T-19** `workflow.ai.yml`: the new runtime dependencies in `project.runtime_dependencies`, each with the package
  that loads it, and `scripts/check-workflow.mjs` passing (a `Workflow-Change:` trailer on the commit). **Done differently (2026-10-20):** the page's libraries are bundled
  build-time dependencies of a private package, so `runtime_dependencies` is unchanged and `project.architecture` records
  why (plan, "Decisions taken while building the page").

## Stage 7: Verification

- [x] `pnpm qa` and the node gates (`node scripts/check-workflow.mjs`) green end to end, output recorded in `review.md`
  (2026-10-21, Linux)
- [x] `pnpm e2e` and `pnpm smoke` green, output recorded in `review.md` (2026-10-21, Linux)
- [ ] A manual run on Windows, macOS and Linux, or the report says which was not done. Linux done 2026-10-21 in Chromium
  (`review.md`, "Browser check"); Windows and macOS not done
