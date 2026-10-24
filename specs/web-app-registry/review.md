# Review: The registry's screens

> Stage 8, on `feat/web-app-registry-screens`, 2026-10-24. Spec `spec.md`, contract `api-surface.md`.

## Stages run

1 Specify, 2 Clarify (C-01 to C-07; C-01 and C-05 confirmed by the maintainer on 2026-10-24), 3 Plan, 4 Tasks, 5 Analyze,
6 Implement (T-01 to T-12), 7 Verify (below), 8 Review and ship (this file). Stages not run: none. Stage 3 was revisited
once, in stage 6: the server answers a write without a control `405`, as the other optional resources do, and a root's
id hashes the path as the registry holds it (`spec.md` C-04 and `api-surface.md` carry the amendment).

## What was verified

| Gate | Result |
| :--- | :--- |
| `pnpm qa` (Biome, `tsc` strict, Vitest with coverage) | green; 127 test files; coverage above the 85% floor on all four metrics |
| `pnpm e2e` (build, then the built CLI) | green (36 passed, 1 skipped) |
| `node scripts/check-workflow.mjs`, `sync-agent-docs --check`, `validate-skills`, `sync-claude-skills --check`, `security-audit --source`, `node --test scripts/*.test.mjs` | green (83 script tests) |

New tests: server `registry.test.ts` (every resource, every refusal, body validation, no typed text in the log); CLI
`registry-control.test.ts` (a real file registry in temporary folders: list, `removable`, the per-user folders, annotate, copy,
remove, the typed-path cases, add, idempotence, a failed write, two adds at once, the finder following a new folder); web
`registry-model.test.ts`, `registry-client.test.ts`, `workflows.test.ts` (the screen, the four dialogs, the focus trap, the menu
item and the address).

## Acceptance criteria

AC-01 to AC-13 and AC-15 hold and are tested. **AC-14 is not ticked**: keyboard, labels, announcements and the focus trap are
tested under happy-dom, but two checks need a person.

## A real browser

Done 2026-10-24 on Windows in Chrome, desktop width, against the built `indaba ui` over three sample folders (the user's
configuration folder was a temporary one): the Workflows item appears, the table lists the three workflows with their states
(one invalid), a row selects and the actions appear, **Import a folder** resolved a typed path to the folder, showed "2 workflow
files", and added it; the table then listed five workflows and the per-user list held the folder.

**Not done, and not claimed:**

- **320 px.** The browser tool resized the window but not the viewport, so the narrow layout was not seen. The columns have
  `hideBelow` widths and the grid stacks below 560 px; whether it reads well on a phone is unchecked.
- **A keyboard-and-screen-reader pass** by a person, and macOS and Linux.
- Annotate, copy and remove were not exercised by hand (tests only).

## Findings of the check, left as they are

1. A dialog's first focus is its heading, as in the Run panel, so a person who opens **Import a folder** and starts typing types
   into nothing; a click or Tab reaches the field. Focusing the first field would be kinder; it is a choice for the maintainer
   because the Run panel does the same.
2. Selecting a row adds a line above the table (the selected name and actions), which moves the table down by one line.

## Review by the five questions

1. **Boundary.** The server writes and spawns nothing; the control is the command line's. The layers tests are unchanged and green.
2. **Untrusted input.** One path comes from the browser, resolved with `realpath`, shown back, re-resolved and compared on Add;
   ids are matched exactly; names and tags are bounded and cleaned; the typed path and typed text are not logged (tested).
3. **Semver.** Minor below 1.0. One behaviour widens: `indaba ui` covers the per-user folders (C-01, confirmed, in the changelog).
4. **Dependencies.** None added.
5. **Documentation.** `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`, `docs/web-view.md`, `specs/workflow-registry/spec.md` (C-12, C-14),
   `specs/web-app/spec.md` (AC-06) moved with the change.

## Open

- The 320 px check and the keyboard pass (above).
- The two findings.
- Health column, the New workflow button and removing a root are other specs or non-goals (`spec.md` section 4).
