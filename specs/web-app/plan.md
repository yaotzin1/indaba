# Plan: The local web view, delivery step 1 (read-only, over runs)

> Covers the first slice of C-09 only, cut down to what exists today. The registry, health report, run actions,
> questions, change list and editor wait for `workflow-registry`, `agent-sandbox`, `single-step-run`, `ruling-channel`,
> `workspace-without-git` and `workflow-editor`, none of which is implemented; each adds its screens as it lands.
> The assumptions the maintainer has not confirmed yet are listed at the end; the plan changes if they change.

## The slice

A person runs `indaba ui` and sees the runs on this machine and one run live: the graph of its steps animating, the
state and duration of each step, its output, and the cost so far. It reads what `indaba watch` reads (the trace files),
through the same view model, so the page and the dashboard cannot disagree (US-11). It starts nothing and changes
nothing, which also keeps the slice clear of AC-22 (confirmation before running) and of the `Origin` rule for
state-changing requests: those arrive with the first action.

In scope from the spec: AC-01 to AC-05, AC-07 (graph from the run's steps), AC-09 (task list and cost, no actions),
AC-16 to AC-20, and a Runs screen in place of the Workflows screen. Out of scope: AC-06, AC-08, AC-10 (Run), AC-11 to
AC-15, AC-21 (sketches precede the page), AC-22.

## Modules touched

| File | Change |
| :--- | :--- |
| `packages/core/src/web-contract/` (new) | declarations only: the run summary and run view data shapes, `ApiError`, the contract's request and response types for this slice. No function, no `node:` import |
| `packages/core/src/index.ts` | export the new types |
| `packages/engine/src/trace/view.ts`, `trace-reader.ts` | move the pure declarations the page needs (`RunState`, `StepView`, `AttemptView`, `RunnerView`, `RunStatus`, `RunSummary`) to core if T-02 shows they are pure data; the engine re-exports them, so no import path breaks |
| `packages/server/` (new) | `startServer`, token and `Host` checks, `GET /contract`, `GET /runs`, `GET /runs/{id}`, `GET /runs/{id}/events`, `GET /runs/{id}/steps/{step}/log`, `GET /events` (runs only), static serving |
| `packages/web/` (new) | Vite and React; the Runs screen and the Run screen with the graph; contract types from core |
| `packages/cli/src/main.ts`, `ui.ts` (new) | `indaba ui`, loading `@indaba/server` lazily, passing it the roots and `staticDir` |
| `packages/server/test/layers.test.ts`, `packages/web/test/layers.test.ts` (new) | the import rules of AC-01 |
| `packages/cli/test/layers.test.ts`, `scripts/check-workflow.mjs` inputs, `workflow.ai.yml` | the lazy edge; the recorded dependencies (a protected path: needs a `Workflow-Change:` trailer) |
| `README.md`, `CHANGELOG.md`, `AGENTS.md`, `specs/DEPENDENCY_MAP.md`, `docs/` | the documentation that moves with a new package and command |

`RunStarter` and `ServerOptions.runs` of `api-surface.md` are not needed by this slice (nothing starts a run); the type
and the option arrive with the first action. `ServerOptions` here is `{ roots, staticDir, port?, open? }`; adding
`runs` later is an addition with no default change.

## Where the behaviour lives

- **Pure domain (`@indaba/core`):** the data shapes of the contract only. A rule about what is legal does not live in
  the server or the page.
- **Engine:** reading and following the trace files (`TraceReader`, `reduceRun`) is reused unchanged.
- **Server (`@indaba/server`):** HTTP, SSE framing, the token, the `Host` check, static files, confinement of run ids to
  `.indaba/traces`. It decides nothing about runs.
- **Page (`@indaba/web`):** rendering only; it receives data already redacted (AC-17) and shows text inertly (AC-16).
- **CLI:** the composition root: resolves the roots and `staticDir`, loads the server, opens the browser.

## Trade-offs taken

- **A slice with no registry.** The home screen is a list of runs, not workflows, so the table component and its
  decision (C-02) can wait. The cost: the first screen is not the one the spec ends with. The reason: every other piece
  of the final page needs the same server, token, stream and graph, and these exist today.
- **Fetch-streaming SSE with a header** (AC-05) instead of `EventSource`: a little more client code, in exchange for one
  authentication rule for every request.
- **No tailing library.** `TraceReader.follow` already follows a run; `GET /events` polls the trace directory at a fixed
  interval (an injected clock and interval, as the engine does). If that proves slow with many runs, an index is a
  performance change under the same contract (C-06).
- **`dagre` for layout** (C-01), computed in the page from the run's `depends_on` edges, deterministic for a given run.

## Risks

| Risk | Mitigation |
| :--- | :--- |
| the declarations of `view.ts` import record types and `RunStatus`, so they may not be pure data | T-02 checks before anything moves; if one is not, the contract declares its own JSON shape and the server maps to it |
| a run id or step id from the URL reaches a path | ids are matched against `isRunId` and a fixed pattern before any path is built; the trace directory is the only root; hostile-input tests (T-12) |
| the page shows secrets or terminal escape sequences from agent output | the server serialises through the engine's `createSanitizer` and the redaction the traces use; the page renders text only; a test with hostile strings built from fragments |
| the token leaks through the address bar, history or a referrer | fragment removed after load, `Referrer-Policy: no-referrer`, token in memory only (AC-02) |
| two new packages and a build tool grow the install | `@indaba/web` is built in CI and shipped as static files in `@indaba/server`'s package or its own; neither is a dependency of `indaba` (AC-01); the packed-install smoke test checks that `indaba` alone still boots |
| MUI and React Flow weight on a phone (AC-20) | measure the bundle in the plan's first task; this slice may use plain components and add MUI with the table in step 2 |

## T-02 outcome (2026-10-16)

The declarations of `view.ts` and `trace-reader.ts` the page needs are pure data: `RunState`, `StepView`, `AttemptView`, `RunnerView`, `SkippedRunnerView`, `RunStatus` and `RunSummary` import nothing but each other. They moved to `@indaba/core` (`web-contract/run.ts`) and the engine re-exports them, so no import path broke. `RunState.owners` is the reducer's own bookkeeping, so the page receives `RunSnapshot`, which is `RunState` without it. The stream sends a whole `RunSnapshot` per event, built by the reducer the dashboard uses, instead of raw records: the records and their parser stay in the engine, and a repeated or missed event cannot corrupt the page (`RunStreamEvent`).

## Out of scope for this change

Everything not in "The slice": the registry and its table, health, Run and Stop, single-step run, questions and
answers, the change list, the editor, free-form messages, and the three sketches (AC-21; the Run and Runs screens need
the maintainer's review before T-09).

## Assumptions to confirm (the plan stops being valid if these change)

1. C-12, runs ending with `indaba ui`, is irrelevant to this slice (it starts none) and may stay open until step 2.
2. The shared declarations move to `@indaba/core` as types only (decided on 2026-10-16).
3. `@indaba/web` ships built, inside `@indaba/server`'s package or as its own; which one is a packaging decision (T-10).
4. The runtime dependencies named in the spec are recorded in `workflow.ai.yml` in the change that adds them, with the
   licence tree of each checked (the table component's tree is not needed in this slice).
