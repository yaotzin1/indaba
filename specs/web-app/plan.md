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

In scope from the spec: AC-01 to AC-05, AC-07 (the graph, with every step selectable), AC-09 (step list and cost, no actions),
AC-16 to AC-20, and a Runs screen in place of the Workflows screen. A selected step shows what happened in it and what happens
if it fails (C-13); the tables are `apsw-gridwright` grids (C-02); the graph is built as one component with a view mode now
and an edit mode later (C-13). Out of scope: AC-06, AC-08, AC-10 (Run), AC-11 to
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
and the option arrive with the first action. `ServerOptions` here is `{ roots, staticDir, port?, token?, pollMs?, sleep?, coalesceMs? }`; opening the browser is the CLI's job, so the server has no `open` option (T-03 amendment, 2026-10-16); adding
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
| the trace records neither `depends_on` nor `on_failure`, so the graph has no edges and no failure route (C-14) | T-20 records both, on the run's root span when it starts, on each step's span in the engine before T-08; a run recorded earlier shows its steps in order with a note |
| a debate's messages cannot be tied to one run (C-15) | the page shows the outcome and rounds from the trace and says the messages are unavailable; T-21 decides how a run keeps them |
| a run id or step id from the URL reaches a path | ids are matched against `isRunId` and a fixed pattern before any path is built; the trace directory is the only root; hostile-input tests (T-12) |
| the page shows secrets or terminal escape sequences from agent output | the server serialises through the engine's `createSanitizer` and the redaction the traces use; the page renders text only; a test with hostile strings built from fragments |
| the token leaks through the address bar, history or a referrer | fragment removed after load, `Referrer-Policy: no-referrer`, token in memory only (AC-02) |
| two new packages and a build tool grow the install | `@indaba/web` is built in CI and shipped as static files in `@indaba/server`'s package or its own; neither is a dependency of `indaba` (AC-01); the packed-install smoke test checks that `indaba` alone still boots |
| MUI and React Flow weight on a phone (AC-20) | measure the bundle in the plan's first task; this slice may use plain components and add MUI with the table in step 2 |

## T-02 outcome (2026-10-16)

The declarations of `view.ts` and `trace-reader.ts` the page needs are pure data: `RunState`, `StepView`, `AttemptView`, `RunnerView`, `SkippedRunnerView`, `RunStatus` and `RunSummary` import nothing but each other. They moved to `@indaba/core` (`web-contract/run.ts`) and the engine re-exports them, so no import path broke. `RunState.owners` is the reducer's own bookkeeping, so the page receives `RunSnapshot`, which is `RunState` without it. The stream sends a whole `RunSnapshot` per event, built by the reducer the dashboard uses, instead of raw records: the records and their parser stay in the engine, and a repeated or missed event cannot corrupt the page (`RunStreamEvent`).

## Decisions taken while building the page (2026-10-20)

- **The libraries are bundled, not installed.** `@indaba/web` is a private package; Vite builds it into static files
  that `@indaba/server` serves. React, `apsw-gridwright`, `@xyflow/react`, `@dagrejs/dagre` and the Atkinson
  Hyperlegible fonts are its `devDependencies`, so they reach a consumer as bundled files, never as packages in their
  tree, and `project.runtime_dependencies` does not change. `workflow.ai.yml` says so in `project.architecture`.
  Licences, checked with `npm view` when each was added: React, `apsw-gridwright` (no dependencies), `@xyflow/react`
  (with `@xyflow/system`, `zustand`, `classcat`), `@dagrejs/dagre` (with `@dagrejs/graphlib`) are MIT; the `d3-*`
  modules under `@xyflow/system` are ISC; the fonts are SIL OFL 1.1. Each is pinned to an exact version.
- **`apsw-gridwright` without MUI** (amends C-01 and C-02 for this slice). The grids are `apsw-gridwright` themed
  through its `--gw-*` properties, which map onto the page's own light and dark tokens. MUI and
  `apsw-gridwright-mui` would add weight for nothing this slice draws; they can arrive with the editor if it needs
  form components. The steps of a run use `treeData()` for their tries and `responsive()` on a narrow screen.
- **No router or query library yet** (C-01 named React Router and TanStack Query). Two screens need a path parser of
  forty lines (`ui/router.ts`) and a fetch client; both are tested. Revisit when the registry adds screens.
- **React through `h()` in `.ts` files, as `@indaba/tui` does.** No JSX, so every gate that reads `.ts` (the security
  audit, coverage, the typecheck) covers the page without a change to a gate. `tsconfig.json` leaves `packages/web` to
  its own `tsconfig.json` (DOM types, no Node types), and `pnpm typecheck` runs both.
- **The selection lives in the address** (`?step=`, C-05). The graph is controlled: React Flow reports what the
  person did through `onNodesChange`, and the selection comes back from the address. Reading the canvas's own
  selection back made the two chase each other in a loop, which a test now catches.
- **Reactive** (the maintainer, 2026-10-20): live without a reload, and usable at any width from 320 px. Checked in a
  browser against a real run that retried, and at ten widths from 320 to 1920 px with no sideways scroll of the page.
  The check found that a step's time spanned all its tries and that a long failure reason crushed the tries table on a
  phone: a step now shows its latest try's time (none while it waits), and the tries are a list with the reason under
  each.
- **A wide graph opens readable.** When the graph cannot fit at 0.8 zoom (a phone), it opens at 0.8 from the left
  edge and the reader pans, instead of shrinking every card below reading size.

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
