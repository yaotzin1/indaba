# Tasks: The local web view, step 3b (edit a workflow through forms)

Ordered by dependency. Each task brings its tests. Run `pnpm qa` after each group.

## Domain

- [ ] **T-01** The types of `api-surface.md` in `@indaba/core` `web-contract`, and `path` on `WorkflowProblem`.

## Server

- [ ] **T-02** `workflow-editor.ts`: `WorkflowEditor`, `WorkflowEditorError`, the four limits, `editRequestOf`; tests at
  and past every limit, every malformed edit, extra fields dropped.
- [ ] **T-03** `GET /api/v1/editor`, `POST /api/v1/workflows/edit` in `server.ts`; `404 editor_unavailable`; `Origin`;
  the `422` codes; `CONTRACT_VERSION` `1.3.0`.

## Command line

- [ ] **T-04** One `problemsOf` for the store and the editor, with `path` (AC-04).
- [ ] **T-05** `run-control/editor.ts`: every op, `not_editable`, `edit_refused`, comments kept, `value`.
- [ ] **T-06** `ui.ts`, `main.ts`, `server-loader.ts`: `UiWorkflowEditor`, the catalog with `human`, help text.
- [ ] **T-07** End to end: edit through the built `indaba ui`, comments survive, save.

## Page

- [ ] **T-08** `client.ts` (`editor`, `editWorkflow`), `messages.ts` (`form`).
- [ ] **T-09** `form-model.ts` with its tests.
- [ ] **T-10** `FormView.ts`: header, roles, steps, fields, presets, step actions, problems at fields, the edit queue.
- [ ] **T-11** `SourceScreen.ts`: the switch, the shared draft, the form first when readable, no form without the editor.
- [ ] **T-12** Keyboard, labels, announcements, 320 px, both themes: tests in happy-dom; the real-browser check if the
  environment allows it, otherwise recorded as not done.

## Documentation and gates

- [ ] **T-13** `docs/web-view.md`, `docs/web-view-development.md`, `README.md`, `CHANGELOG.md`,
  `specs/DEPENDENCY_MAP.md`, `specs/web-app/plan-step-3.md` (3b, the order of C-09).
- [ ] **T-14** The gates of `workflow.ai.yml` (`quality_gates`), `pnpm e2e`, `pnpm smoke`; per-file coverage of the new
  code; CI on the three systems.
- [ ] **T-15** `review.md`.
