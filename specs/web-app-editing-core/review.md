# Self-review: The local web view, step 3a (edit a workflow's source and save it)

> **Status**: done, 2026-10-22, on `feat/web-app-source-edit` (pull request #60). Stages 1 to 7 ran; stage 8 is the
> maintainer's merge.

Answers to [`.agents/rules/review.md`](../../.agents/rules/review.md).

## 1. Boundary and layering

`@indaba/core` gained declarations only; its contract tests pass unchanged. `@indaba/server` reads and writes no
workflow file: it defines `WorkflowStore` and calls it, and its `layers.test.ts` is untouched and green (AC-14). The
store is in `packages/cli/src/run-control/source.ts` and reuses step 2's `scanRoots` and `readWorkflow`, so "a workflow
of this root" and its confinement have one definition. The server recognises a `WorkflowStoreError` by name and `code`,
as it does `RunControlError`, because the CLI does not import the optional `@indaba/server`. No runner is named.

## 2. Determinism and failure isolation

The store takes the parser, the pid and the logger by injection; it reads no clock, randomness or environment. A save
writes `<file>.<pid>.<n>.indaba-save` with `wx` and the target's mode, re-reads the target, and renames over it; every
failure removes the temporary file, and the original is untouched (tests: unwritable folder, a link planted at the
temporary name). No process is started (AC-08). The window between the last re-read and the rename is a `stat`, a
read of at most 1 MiB and a rename, as the plan says; a write by another program inside it is lost.

## 3. Public surface and semver

Minor, as `api-surface.md` classified it: the core types, `WorkflowStore`, `WorkflowStoreError`, `MAX_SOURCE_BYTES`,
`MAX_SOURCE_BODY_BYTES`, `ServerOptions.workflowStore`, three resources; `CONTRACT_VERSION` 1.2.0; `indaba ui`'s help
mentions editing. Recorded in `CHANGELOG.md`. Internal: `readJson` takes its size limit as a parameter (default
unchanged).

## 4. Security

- **Ids** from the address match `^[0-9a-f]{32}$` and are looked up in a fresh scan; nothing is opened by a path the
  request names. Only `text` and `baseHash` are read from a body (test with `path` and `id` in it).
- **Size**: the body is capped at 2 MiB before it is parsed, the text at 1 MiB counted in UTF-8 bytes (test with a
  three-byte character).
- **Paths**: the target is the scan's, re-checked as a regular file inside its root by realpath at read and again
  before the rename; a target replaced by a link is `workflow_not_found` and the link's target is untouched (test).
- **Writes** need the token, the `Host` and the page's own `Origin` (tests for none, a wrong one, no token).
- **The text** is never logged (a test with a marker string over every resource) and is shown as text only; the page
  renders it in a `textarea`.

## 5. Observability and honest numbers

No span or attribute. Log records: `cli.ui` `workflow saved` (relative path, new hash, problem count) and `a workflow
could not be saved` (path, reason), `server.workflows` `save refused` (code, method). The limits are labelled starting
values. A problem's position is shown only when the parser gave one; nothing is guessed.

## 6. Dependencies and packaging

No dependency added; the editor is a `textarea` (spec, non-goals). `pnpm smoke` boots the packed install.

## 7. Verification

```
$ pnpm qa
Checked 304 files in 584ms. No fixes applied.
 Test Files  102 passed (102)
      Tests  1849 passed | 2 skipped (1851)
Statements   : 96.55% ( 7409/7673 )
Branches     : 91.84% ( 5440/5923 )
Functions    : 95.95% ( 1636/1705 )
Lines        : 96.87% ( 7134/7364 )

$ pnpm e2e
 Test Files  11 passed (11)
      Tests  34 passed (34)

$ pnpm smoke
smoke-pack: 6 packages packed and audited; indaba 0.1.0-alpha.2 boots without @indaba/tui and @indaba/server, and the installed server finds its page

$ node scripts/check-workflow.mjs
workflow.ai.yml matches the repository

$ node scripts/security-audit.mjs --source
security audit: no findings (source, manifests, tsconfig, biome.json)

$ node --test scripts/*.test.mjs
# pass 83
# fail 0
```

Tests that fail without the change: `server/test/workflow-store.test.ts` (over HTTP, hostile inputs),
`cli/test/workflow-store.test.ts` (real files, the conflict, the confirmation invalidated by a save),
`web/test/ui.test.ts` (the source view), `web/test/client.test.ts`, `web/test/logic.test.ts`, and
`cli/e2e/ui-edit.e2e.test.ts` against the built CLI. Linux here; CI runs Windows and macOS. The unwritable-folder test
is skipped here because this environment runs as root; CI runs it.

## Known gaps

- **The real-browser check** (320 px, both themes) was not done, for the reason step 2 gives: the environment cannot
  download a browser.
- **Positions only for YAML syntax**, and no underlining (C-02); both come with `workflow-editor`.
- **The browser's own Back button** with unsaved changes leaves without asking; the page's Back, its header links and
  closing the tab ask. Asking on the browser's Back needs the router to hold history entries, worth doing with 3b.
- **A refusal to open a file** is shown in the server's words (plain and catalogued there), not the page's catalogue:
  the client's failure carries the message, not the code.
- **`AGENTS.md`** describes the server as starting and stopping runs through the CLI and does not mention saving
  workflows: the file is at the 12000 characters one agent reads, so its row cannot grow.
