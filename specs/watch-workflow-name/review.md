# Self-review: the workflow name in the list of runs

> **Status**: self-review done (stage 8)

## 1. Boundary and layering

The reader change is in `@indaba/engine` (`trace/trace-reader.ts`); the printing is in `indaba` (`watch.ts`). Nothing
under `packages/core/src` changed, and no import was added. The CLI reaches the sanitiser through its existing
`printable.ts` re-export, as the rest of the CLI does.

## 2. Determinism and failure isolation

`summariseRun` is a pure function of the records; no clock, randomness or environment. No process, worktree or retry
is involved. A run that cannot be read is skipped, as before.

## 3. Public surface and semver

Minor, recorded in `api-surface.md` and `CHANGELOG.md`: `RunSummary.workflow` and the same field on the return of
`summariseRun`, and a last column in the `indaba watch` list. No new type appears in a public signature. No default
changes.

## 4. Security

The name is read from a trace file and printed to a terminal, so it goes through `sanitize` (escape and control
characters removed), is collapsed to one line, and is bounded to 60 characters. The tests cover an escape sequence and
a line break. It reaches no shell, path or URL, and is not a secret.

## 5. Observability and honest numbers

No span, attribute or number is added; `indaba.workflow.name` is read, not written. An unknown name shows `-`, not an
empty string or a guess.

## 6. Dependencies and packaging

No dependency added. Nothing new reaches a published package beyond the changed source.

## 7. Verification

`pnpm qa` on Windows 11, Node 22: 65 test files, 1243 tests passed; coverage 97.66% statements, 93.61% branches,
97.72% functions, 97.83% lines. Tests added: five for `summariseRun` and `listRuns` (attribute, span-name fallback,
undefined, root span only, legacy trace file) and one for the printed list (escape, line break, long name, unknown name).
Not run here: macOS and Linux (CI does).

## Known gaps

- The list is not filterable by workflow, and shows no task id or cost; each is its own change (spec section 4).
- A machine-readable list is left to the web view's server.
