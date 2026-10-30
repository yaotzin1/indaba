# Self-review: Run blackboard

> **Status**: complete, 2026-10-30. Three independent read-only reviews (T11 to T15, T19 to T23, and the whole feature)
> found no high-severity defect; every finding they made that was real was fixed and has a test, listed under
> "What the independent reviews found".

Answered against [`.agents/rules/review.md`](../../.agents/rules/review.md). Stages run: Specify, Clarify, Plan, Tasks,
Analyze (plan section 5b, and again for the AC-34/AC-40 word conflict), Implement (T1 to T26), Verify (T27), Review.
Skills read before each part: `mesh_consensus`, `architect`, `workflow_engine`, `application_security`, `qa`,
`observability`, `api_surface`, `documentation`.

## 1. Boundary and layering

`@indaba/core` gains the board model, the digest and the parser, `BoardRecorded` and `StepDefinition.board`, and imports
no `node:` module and no package (`architecture.test.ts` is green; the code has no `Date`, `Math.random` or `process`: the
clock is injected and the sequence number replaces ids). The engine owns the parts that touch the world: the field's
parser and validator, posting and settling in the step executor, the writer and reader of the file. Neither imports the
runners. The CLI is still the only composition root: it passes the executor's redaction to the board and registers the
writer as an ordinary listener of `BoardRecorded`, through the same event dispatcher a plugin uses, so the built-in has
no access a plugin lacks (a test registers a second listener). `@indaba/tui` imports only the record types, the sanitiser
and `BoardReader` from the engine, and nothing from core (`board-layers.test.ts` pins it, beside the existing
`layers.test.ts`). The plain `watch` section lives in the CLI, not the TUI, so `--plain` needs no UI package.

## 2. Determinism and failure isolation

The board is a pure function of its inputs: the same board and selection give a byte-identical digest, replaying a file
rebuilds the same board, and `seq` is the only ordering. Retries stay bounded and isolated: a failed attempt's entries are
`discarded`, the entries of every step a retry resets are `superseded` before the target runs again, pending entries are
never read, and the retry prompt still carries only the last failure (AC-24 has a test for an agent step and one for a
debate step run through the real engine). A cancelled debate or step settles nothing. The board file is written by one
serialised queue and never throws into the run; a write failure is reported once on the root span and the in-memory board
keeps serving digests, so a run behaves the same with or without the file. No process or worktree is started by this
feature. Every buffer is bounded (2000 entries, 1 MiB, 2000 characters per entry, 10 posts per reply, the digest limit).

## 3. Public surface and semver

All additions, so minor, recorded in `api-surface.md` and the Unreleased section of `CHANGELOG.md`: core exports
(`RunBoard`, `buildDigest`, `parseBoardLines`, `BoardKind`, `BoardRecorded`, the limits), the optional step field `board:`
(`read`, `post`, `digest_chars`), an optional fourth parameter of `ConsensusArbiter.deliberate`, `Tracer.now()`, new span
attributes (`indaba.board.*`) and one span event, engine exports (`BoardWriter`, `BoardReader`, the record parser), the
TUI exports and an optional third parameter of `computeLayout`, and the `board:` line of `indaba plan`. Nothing existing
changed: a workflow without `board` fields runs byte for byte as before (`board-regression.test.ts` compares the trace
file, the event stream and every prompt against files written by the code at the merge base). The one visible difference is
a third file per run in `.indaba/traces`, which changed two existing tests and is in the changelog. Two things are design
choices rather than measurements, and say so: the limits of the board, and `DOCK_COLUMNS` (160).

## 4. Security

Board text is data written by an agent, so it is handled as untrusted at every step. Written: cleaned (control characters
out, one line) and redacted with the function the event stream uses before it becomes an entry, so the file, the digest and
the event carry the same text (a test plants a credential in an environment variable and finds it in no record). Read into a
prompt: every digest line starts with `| `, the section begins with a sentence saying the lines are information and not
instructions, and a board line cannot be read back as a post because a post must start at column 0 (tests feed entries that
look like instructions, board lines and fences). Shown: the TUI and the plain section filter every string again before it
becomes a row (a test removes the filter and fails). The only thing that reaches a path is the trace id, validated as
lowercase hexadecimal by the same function as the other two files; nothing reaches a shell or a URL. The degraded event
carries the class name of the error only, never its message. The fence tracker follows CommonMark (a longer fence is not
closed by a shorter one), so a reply cannot post lines that sit inside its own code block.

## 5. Observability and honest numbers

Five span attributes (counts only: no text, no sender, no key) on the step that read or posted, and one span event on the
root span, in `events.md`; none appears on a step without a `board` field. Nothing here shows a token count or a cost. Where
a number would be false it is not shown: the "N older entries are not shown" line counts what was left out, and a board that
could not be saved says "The board is incomplete" instead of looking complete. Every message a person reads is a sentence
they can act on and uses plain words (no `digest`, `settle`, `supersede`, `degraded` or `jsonl`; tests list the messages of
the parser, the validator, `plan`, `watch --plain` and the pane and check them). That check made AC-34 and AC-40 disagree
(`superseded` contains `supersede`), so AC-34 now says "replaced".

## 6. Dependencies and packaging

No dependency added, runtime or optional, and none changed (`package.json` and the lockfile are untouched); `pnpm audit
--prod` reports no known vulnerabilities. The new files are in `src/` of packages that already publish their `dist/`; the
docs, the example and the SVG pictures are not in any npm package. The packed install boots (`pnpm smoke`: six packages packed
and audited, `indaba` boots without `@indaba/tui` and `@indaba/server`).

## 7. Verification

Run on one operating system, Windows 11 with Node 22.20, pnpm 9. macOS and Linux run in CI after the push, and nothing here
claims them. Actual results at the last commit:

```
pnpm qa            exit 0   Test Files 148 passed   Tests 2682 passed | 2 skipped
                   coverage All files: statements 96.95, branches 92.22, functions 96.51, lines 97.2  (floor 85)
pnpm e2e           exit 0   Test Files 13 passed | 1 skipped   Tests 37 passed | 1 skipped
pnpm smoke         exit 0   6 packages packed and audited; indaba boots without @indaba/tui and @indaba/server
pnpm audit --prod  No known vulnerabilities found
node gates         skills valid, skill pointers in sync, agent docs in sync, workflow claims match the repository,
                   security audit no findings, docs site check (14 pages), script self-tests 94 passed,
                   check-track: every commit of the branch matches the track it declares
```

Tests that would have caught the absence of each part: the pure board and digest tests in core, the golden comparison for
AC-27/AC-31, the retry-isolation tests, the debate tests (including a cancelled and a retried debate), the file
writer and reader tests (partial line, replaced file, unknown record, hostile id), the end-to-end test through the built CLI
(a note reaches a later step's prompt, a debate lands on the board, a replayed board equals the live one), and the TUI state,
pane, key, dock and layers tests. Several were checked by breaking the code and watching them fail (the settlement rule, the
sanitiser, the cancelled-debate settlement, the digest preamble length).

Timing-based tests in other packages (`logging-config`, the server `logging` test, `remote-log-sink`) failed on some full runs
under load and passed alone and on re-run; none touches this feature, and they are not fixed here.

## What the independent reviews found

Review 1 (T11 to T15) and review 2 (T19 to T23) and review 3 (the whole feature) were read-only agents given the code and not
my conclusions. Real findings, all fixed with a test: a cancelled debate settled `accepted`; reply scanning ignored embedder
limits; a debate's `result` and `decision` named a role as sender where the data model says the step; `BoardReader.follow` dropped
the last records on abort; a long entry was cut silently in the detail view; an opened entry changed when a newer one
arrived; a key press could overwrite records read since the last draw; the whole list was sanitised on every key; tabs were
not filtered; unreadable lines were not shown; `b` worked behind the help screen; the digest could exceed `digest_chars` at the
200 minimum; the fence tracker closed a fence with a shorter one; a bare `read:` silently meant "read nothing". Two statements in
the docs were false (a 2000-character agent line is ignored, not cut) and are corrected.

## Known gaps

- Not run on macOS or Linux, nor on Windows Terminal by hand; the TUI is tested on the Ink test renderer and rendered by hand to
  SVG pictures, not looked at in a real terminal.
- `DOCK_COLUMNS` (160) is a first choice from rendering 120, 140 and 160 columns, to be moved when people have used real
  terminals. The limits of the board are unmeasured design choices (AC-10, AC-29).
- During `watch --replay` the board pane holds the whole board from the start, because the file is read whole while the run is
  replayed at speed; it does not follow the replay's clock.
- The golden test for AC-31 has no debate step; AC-19 excludes a debate's own entries, but a debate run is not pinned for "no
  change to prompts or spans".
- `indaba report` does not yet include the board file.
- The web view does not show the board yet (the file is the contract it will read).
- No mutation run (`pnpm mutation`, tens of minutes, weekly in CI) was made for this feature.
- Not run against real Claude Code, Codex, Antigravity or Cursor installations: the tests use scripted runners.
