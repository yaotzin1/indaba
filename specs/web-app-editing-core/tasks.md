# Tasks: The local web view, step 3a (edit a workflow's source and save it)

Ordered by dependency. Each task brings its tests. Run `pnpm qa` after each group.

## Domain

- [ ] **T-01** The types of `api-surface.md` in `@indaba/core` `web-contract`. Types only; the contract tests stay green.

## Server

- [ ] **T-02** `WorkflowStore`, `WorkflowStoreError`, `MAX_SOURCE_BODY_BYTES`, `MAX_SOURCE_BYTES`, `ServerOptions.workflowStore`;
  without it the three resources answer `404 source_unavailable` and `PUT`/`POST` are not allowed (a test each).
- [ ] **T-03** `GET .../source`, `PUT .../source`, `POST .../check`: body read with its own cap; `text` and `baseHash`
  checked; every store code mapped to a status and plain words; `CONTRACT_VERSION` `1.2.0`.
- [ ] **T-04** Hostile input: an id of the wrong shape or with separators; a body with `path` or `id`; `text` not a string,
  over 1 MiB in UTF-8 (multibyte characters counted as bytes); `baseHash` not hex; no `Origin`; wrong `Origin`; no token;
  wrong `Host`. None reaches the store as anything but checked values; no text in a log.

## Command line

- [ ] **T-05** `run-control/source.ts`: `read` (scan, `readWorkflow`, UTF-8 check, hash, problems), `check` (the parser,
  positions from YAML syntax), `save` (scan, conflict, temporary file with `wx` and the mode, re-check, rename, cleanup on
  failure). Tests on temporary trees: save then read; conflict; a link planted at the temporary name; a target replaced by
  a link after the scan; an unwritable folder leaves the original and no temporary file; permission bits kept (POSIX);
  bytes that are not UTF-8; a save of the same bytes.
- [ ] **T-06** A save invalidates the confirmation (AC-07): confirm and start with the run control, save through the
  store, start again: `confirmation_required` with the new summary.
- [ ] **T-07** `ui.ts` and `main.ts`: `UiDeps.workflowStore`, help text.
- [ ] **T-08** End to end: the built `indaba ui`, read a workflow's source, save a change with the right `baseHash`, a
  stale `baseHash` is `409` with the disk's text, Run asks again after the save.

## Page

- [ ] **T-09** `client.ts` (three calls), `messages.ts` (`editor`), the router's `/workflows/{id}` route.
- [ ] **T-10** Edit in `RunPanel`; `SourceScreen` with the gutter, Tab and Escape, the debounced check (latest answer
  wins), problems with line buttons, status, Save, Run when valid.
- [ ] **T-11** Unsaved changes guard; the conflict view.
- [ ] **T-12** Keyboard, announcements, 320 px, both themes: tests in happy-dom; the real-browser check if the
  environment allows it, otherwise recorded as not done.

## Documentation and gates

- [ ] **T-13** `docs/web-view.md`, `docs/web-view-development.md`, `README.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`,
  `specs/web-app/plan-step-3.md` (3a delivered).
- [ ] **T-14** `pnpm qa`, `pnpm e2e`, the node gates, `pnpm smoke`; CI on the three systems.
- [ ] **T-15** `review.md`.
