# Tasks: The local web view, delivery step 2 (Run and Stop)

Ordered by dependency: domain, infrastructure, the command line, the page, documentation. Each task is checkable on its
own and brings its tests. Run `pnpm qa` after each group. Amended after the review of 2026-10-22.

## Domain

- [ ] **T-01** Declare the types of `api-surface.md` in `@indaba/core` `web-contract` (`WorkflowSummary`,
  `WorkflowListResponse`, `RunSummaryOfUse`, `StartRunRequest`/`Response`, `ConfirmationRequired`, `StartStatusResponse`,
  `StopRunResponse`, `canStop` on `RunResponse`). Types only; `architecture.test.ts` stays green and the
  module-exports-no-value test too.

## Server

- [ ] **T-02** `originAllowed` returns false for an undefined `Origin`; the 400/403/413/415 messages no longer say
  "settings". Tests: a write with no `Origin` and a valid token is `403`; a read is unchanged; the existing settings
  tests still pass with their `Origin`. `api-surface.md` already records the tightening.
- [ ] **T-03** `RunControl`, `RunControlError`, `MAX_CONCURRENT_RUNS`, `ServerOptions.runs`. Without `runs`, the three
  resources answer 404 and the server is the read-only one (a test for each).
- [ ] **T-04** `GET /workflows` (AC-01).
- [ ] **T-05** `POST /runs` (AC-03, AC-04, AC-06): body read with `readJson`; `workflowId` and `confirmedHash` checked as
  strings of bounded length; every `RunControlError` code mapped to its status and a plain message.
- [ ] **T-06** `GET /starts/{startId}` (AC-08, AC-15), `POST /runs/{id}/stop` (AC-09) with the `202`/`200` split,
  `canStop` on `GET /runs/{id}` (AC-10). Ids from the path pass `isRunId` first.
- [ ] **T-07** `ServerHandle.close()` calls `stopAll` first (AC-11). `CONTRACT_VERSION` to `1.1.0`.
- [ ] **T-08** Hostile input: a `workflowId` with separators, `..`, a NUL, 10 KiB; a `confirmedHash` that is not hex;
  **a body with `taskId: "../x"` has no effect**; an id in a URL of the wrong shape; wrong `Origin`; no `Origin`; no
  token; wrong `Host`; a body of the wrong type or size. None reaches `RunControl` as anything but a string it matches,
  none appears in a log (AC-16).

## Command line

- [ ] **T-09** `run-control/scan.ts`: the bounded scan (depth, count, size; no `node_modules`, `.git`, links; `.indaba/`
  skipped except the default file), the opaque id, the parse for name and problems. Tests on a temporary tree: nested, a
  link, a huge file, a file that is not YAML, a copy under `.indaba/run-inputs/` that is not listed.
- [ ] **T-10** `createRunStarter`: `kill()` (tree on both platforms) that is a no-op after `close` or `error`; the
  child's `stdin` stays `ignore`. First check `scripts/security-audit.mjs` against `spawn('taskkill', [...])` and
  `process.kill(-pid, ...)`; if it fires, the design changes (no suppression exists). Tests with a fake starter: `kill()`
  after exit does nothing; a child that ignores cancel is killed after the grace.
- [ ] **T-11** `run-control/confirm.ts`: the content hash of one buffer, the summary of use from the parsed definition
  (runners, shell commands, `agent.command`, local MCP commands, permissions with the unrestricted default, `needsPerson`),
  the confirmation store in an injected config folder keyed by realpath (read, atomic write, ten per workflow). Tests:
  confirm then run; change then ask again; an unwritable folder is `not_saved`; a corrupt file is treated as empty; a
  project that carries its own `.indaba/confirmed-*` arrives unconfirmed.
- [ ] **T-12** `run-control/index.ts`: `RunControl` over `createRunStarter`: the map of children, the copy written with
  `wx` only after confirmation and deleted on exit, the sweep of `.indaba/run-inputs/` at construction, the concurrency
  limit, `startStatus` with the task-to-trace correlation from the root `span_started` record (proved against a real
  trace file written by the engine, not a hand-made one), stop, `stopAll`. Tests with a fake `RunStarter` (never a real
  CLI): a child that exits at once, one that ignores cancel, five starts against four, two roots each started in its own
  `cwd`, a start with an existing file at the copy's path. Also confirm, by running the real workflow of T-14, that the
  copy under `.indaba/run-inputs/` changes nothing a workflow does.
- [ ] **T-13** `ui.ts` and `main.ts`: `UiDeps.runControl`, passed to `startServer`; help text; log records. The teardown
  on the command's signal runs `stopAll` through the server's `close()`.
- [ ] **T-14** End to end (`packages/cli/e2e`): the built CLI, `indaba ui`, a `node`-step workflow (no agent, no key):
  list, start, the run appears and finishes, stop a long one, close while one runs and see its worktree removed and no
  process left, start a run whose workflow has `arbiter: human` and see it escalate.

## Page

- [ ] **T-15** `client.ts`, `messages.ts`: the four calls and the strings, with the error map from `code`.
- [ ] **T-16** `RunPanel` (dialog, focus trap, Escape, the invalid disabled with reasons, the once-per-session notice,
  the confirmation view with `needsPerson` and the stated limit, the starting state that polls `starts`) and the **Run a
  workflow** button on `RunsScreen`.
- [ ] **T-17** **Stop** on `RunScreen`, `canStop`, its confirmation, the stopping state, the failed-start message.
- [ ] **T-18** Keyboard, announcements, 320 px, dark and light (AC-14): a test for focus order and for the live region,
  and a check in a real browser at phone width, recorded as step 1 did.

## Documentation and gates

- [ ] **T-19** `docs/web-view.md` (Run and Stop, the confirmation and its stated limit, what closing does, what happens if
  `indaba ui` itself crashes; the "read-only" statements removed), `docs/web-view-development.md`, `README.md`,
  `AGENTS.md` map row for `@indaba/server`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`, `specs/web-app/spec.md` C-09
  (first slice of step 2 delivered).
- [ ] **T-20** `pnpm qa`, `pnpm e2e`, the node gates, `pnpm smoke`; coverage at least 85% on all four metrics.
- [ ] **T-21** Fill `review.md` (the self-review of the seven questions) and add what implementation found to `plan-review.md`.
