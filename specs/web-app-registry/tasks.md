# Tasks: The registry's screens

Ordered by dependency. Each task brings its tests. Run `pnpm qa` after each group.

## Contract

- [x] **T-01** `@indaba/core` `web-contract/registry.ts`: the types of `api-surface.md`; exported from the contract index and
  the package index; the web-contract layers test (imports only `./`) stays green.

## Server

- [x] **T-02** `packages/server/src/registry-control.ts`: `RegistryControl`, `RegistryControlError`, the limits as named
  constants (spec C-03); exported from the index.
- [x] **T-03** `server.ts`: the seven resources, the `Origin` and exact-id checks, body validation, the status mapping of
  AC-12, `methodsOf`, `CONTRACT_VERSION = '1.6.0'`; log records of AC-15. Tests with a fake control for every row of the
  table and every refusal; a server without the control answers `404`.

## Command line

- [x] **T-04** `run-control/roots.ts`: the per-user roots file moved out of `workflows.ts` (read, write whole, exists check);
  `workflows.ts` uses it; its tests pass unchanged.
- [x] **T-05** `run-control/registry.ts`: `createRegistryHub` (the control: list with `removable`, scan, annotate, copy, remove,
  resolve, add), the swap of registry and finder, root ids. Tests over a real `FileWorkflowRegistry` in temporary folders,
  including the typed-path cases and the swap while a scan runs.
- [x] **T-06** `indaba ui`: pass `registry`; cover `--root` folders then the per-user list (spec C-01); the run control and
  the workflow store read the current finder. A test that a run starts from a folder imported at run time.

## Page

- [x] **T-07** `client.ts`: the seven calls and their tagged results; tests with a fake `fetch`.
- [x] **T-08** `messages.ts` `registry` section (own place), `router.ts` route `workflows` list and the header item.
- [x] **T-09** `ui/WorkflowsScreen.ts`: the grid, search, Show hidden, selection, toolbar, states (loading, empty, failed,
  unavailable, truncated).
- [x] **T-10** `ui/WorkflowDialogs.ts`: Edit details, Copy to another project (with `toReview` and Open the copy), Import a
  folder (resolve, show, confirm), Remove (names and asks), Scan again; focus trap and return, `role="status"` outcomes.
- [x] **T-11** component tests for AC-01 to AC-09 and AC-14 (keyboard, labels, 320 px class, announcements); a layers test
  addition if a new import appears.

Done 2026-10-24: T-01 to T-12. T-13: `pnpm qa` and the node gates are green (see `review.md`); the real-browser check is not done.

## Documentation and verification

- [x] **T-12** `CHANGELOG.md`, `AGENTS.md` server row if it must change, `specs/DEPENDENCY_MAP.md`, `docs/` page for `indaba ui`
  (`docs/web-ui.md` or the page that describes it), `specs/workflow-registry/spec.md` C-12 amended and C-14 pointed here,
  `specs/web-app/spec.md` AC-06 note, `specs/web-app/tasks.md` if it tracks the screen.
- [x] **T-13** `pnpm qa`, the node gates, `pnpm e2e` if the server is covered there; a manual check in a real browser at
  320 px and desktop (the report says if it was not done); `review.md` filled in.
