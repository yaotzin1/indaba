# Self-review: tui-agent-panes, slice 3a

> **Status**: self-review by the author, then challenged by an Indaba debate (`claude-code` against `antigravity`, trace `c5ad92691fc15ca80ee863403b8074b8`). Both are the same family of models as the author; no human has reviewed this. Slice 3b (stories 3.5 and 3.6) is not part of this review.

See [`.agents/rules/review.md`](../../.agents/rules/review.md).

## 1. Boundary and layering

Everything that decides what is shown is pure (`panes.ts`, `ui-state.ts`, `screen.ts`, `layout.ts`) and imports only `@indaba/engine` and itself; Ink is reached through the adapter. No change in `@indaba/core` or `@indaba/engine`: the view model already carries `thoughts`, `consensus` and `runners[].costUsd`. The block of panes is a function of the run and the layout; the layout gives its rows (`Layout.paneRows`, `paneCap`) and takes them from the detail pane, so no other screen has to know.

## 2. Determinism and failure isolation

`panesFor` is a pure function (tested: same input, same output, the run is not changed). A pane is keyed by the id of its step, never an index, so a retry does not move the focus. When the enlarged step stops running, the next clamp closes the pane, gives the keys back to the list and says so once. A source file that is missing is not a failure of the panes: a pane with no output says `(no data yet)`.

## 3. Public surface and semver

Minor below 1.0, additive (`api-surface.md`). New optional members only where another package builds the type (`Screen.panes`, `Screen.reasoningLines`, `UiContext.reasoningLines|panes|paneCap`); `UiState` and `Layout` gain required members, so a caller that builds one by hand must use `initialUi()` and `computeLayout()`, as every caller in the repository does. With no running step, the list and detail are what they were (tested at 40x8, 80x24 and 160x50).

## 4. Security

Every text a pane or the detail shows (output, the line being written, thoughts, the id, `waitingFor`, the outcome of a debate) passes through `sanitize`, newlines and tabs become spaces, and a test plants an escape sequence in each. Reasoning arrives already redacted in the view model and is shown as given.

## 5. Observability and honest numbers

The cost of a step is the sum of what its agents cost, counted as the plain output counts it. `cost unknown` when no agent has a price, a trailing `+` when only some do, nothing for a step with no agent, and a real zero only when the price was zero. The notice for an enlarged step that stops says `step is no longer running`, not `finished`: the review found that a retrying or waiting step is not finished.

## 6. Dependencies and packaging

None added.

## 7. Verification

`pnpm qa` and the node gates pass (see the pull request for the CI runs on Linux, Windows and macOS). The review found nine problems and the tests for them fail against the unfixed code (checked by running them on the earlier sources).

| AC | Test |
| :--- | :--- |
| AC-01 | `panes.test.ts` (the set, the arrangement, the layout with no change when nothing runs), `screen-panes.test.ts` |
| AC-02 | `screen-panes.test.ts` (reasoning, output, debate outcome and rounds in both), `dashboard-panes.test.ts` |
| AC-03 | `screen-panes.test.ts` (the same sources the web view's run screen reads: thoughts, consensus, runners) |
| AC-04 | `panes.test.ts` (glyph and word in the title, ASCII glyph one column), `screen-panes.test.ts` (the three states differ in their words) |
| AC-05 | `panes.test.ts`, `screen-panes.test.ts` (an escape sequence in each text) |
| AC-06 | `panes.test.ts` (12 running steps, the count of hidden ones kept in sight), `screen-panes.test.ts` (never more rows than the layout gave at 40x8, 80x24, 160x50) |
| AC-07 | blocked: chat waits for `agent-conversation` (slice 3b) |

What the review found, all fixed: help and a board in place of the detail pane lost the rows of the panes (the screen came out short); scrolling counted unwrapped lines, so a long line could not be scrolled (this one was there before the slice); the notice hid the question about a run; keys changed hidden state while a pane was enlarged; a tab was drawn as a tab; `[` `]` reset the place in the output and moved focus where nothing is drawn; the count of hidden panes was clipped off a long title; the notice said finished for a step that merely stopped running.

## Known gaps

- **Wide characters.** Every wrap in the dashboard counts characters, not terminal columns, so a row of CJK text takes twice its width and can run past the edge. This is the dashboard's convention, not new, and a fix belongs to `layout.ts` as a whole (a width function and a test for each caller). `panes.test.ts` documents it.
- **One frame of stale context.** The step that stops running is drawn once more with the layout of the running steps before the clamp takes effect; a gap of a few rows for one frame.
- **`z` from a focused board** enlarges the pane and closes the board, while `Enter` is taken by the board's own keys. Harmless, and arguably what the person wants; not decided in the spec.
- **No real terminal.** The fake terminal is the evidence; a hand run on Windows Terminal and one Linux terminal, with a real run that has several running steps (which needs `parallel-steps` at a limit above 1), is still to do.
- **Slice 3b** (several panes side by side, chat) is unchanged and blocked.
