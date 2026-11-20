# Tasks: run-readiness

PR 1
- [x] T-01 `@indaba/core`: `AttentionKind`, `AttentionState`, `AttentionItem`, `ReadinessProbe`, `ReadinessReport` and the exports.
- [x] T-02 `@indaba/core`: `Requirement`, `WorkflowDefinition.requires`, `defineWorkflow` default.
- [x] T-03 `@indaba/core`: `analyzeReadiness` and its test (AC-01, 02, 04 to 06, 08, 10, 11, 16; `unknown`; order; no secret in the report).
- [x] T-04 `@indaba/engine`: parse and validate `requires` (AC-07, 09), with tests; schema and catalog description.
- [x] T-05 `@indaba/engine`: `createReadinessProbe`, the runner-to-variables table, tests on a temporary folder (spec section 5 rows).
- [x] T-06 `@indaba/engine`: the `indaba.readiness` span event and attributes on the run span (AC-17), with a test that no value is stored.
- [x] T-07 `indaba`: `readiness-report.ts` formatter; `plan` section after the plan (AC-14).
- [x] T-08 `indaba`: `run` prints the report as a warning and starts; `--confirm <id>` (AC-12, 14, 15); exit codes unchanged.
- [x] T-09 Docs (`docs/`, both playbooks, `llms.txt`), changelog, dependency map, `review.md`.
- [x] T-10 `pnpm qa`, the node gates, an independent review, `node scripts/check-track.mjs`.

- [x] T-10a Remediation: the probe required a host execute bit even for an injected `win32`; CI failed on Linux and macOS (`8bd2d0b`).
- [x] T-10b Remediation: `pnpm e2e` was not run; the `plan` e2e test expected output without the report (`6859f40`).

PR 2
- [ ] T-11 `@indaba/tui`: the report in the start confirmation, ready items as a count (AC-13), a key to confirm the selected item (AC-12), tests with a fake terminal.
- [ ] T-12 Docs and `pnpm qa`.

PR 3
- [ ] T-13 `@indaba/core` web contract: `StartRunRequest.confirmed`, readiness view types.
- [ ] T-14 `@indaba/server`: `GET /api/workflows/:id/readiness`, `POST /api/runs/:id/confirm`; token and `Origin` rules as the other routes.
- [ ] T-15 `@indaba/web`: start dialog with the report, confirm buttons; the real-browser check at 320 px.
- [ ] T-16 Docs and `pnpm qa`.

Deferred: AC-03 (input items) until `workflow-inputs` is implemented.
