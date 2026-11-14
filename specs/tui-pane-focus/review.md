# Review: tui-pane-focus

> **Status**: self-review by the author, then one independent read of the diff by a fresh subagent (a model of the same family, no
> human). It had the code and the spec, not my conclusions. No human has reviewed this.

## Acceptance criteria

| AC | Evidence |
| :--- | :--- |
| AC-01 titles and marker | `pane-focus.test.ts` "marks the focused area", "uses > and plain words in ASCII mode", "says the board replaces the detail"; `dashboard-focus.test.ts` on a real Ink screen |
| AC-02 Tab order, Shift-Tab, board in place | `pane-focus.test.ts` "Tab reaches every area" (four tests), `ui-state.test.ts` (changed on purpose, below), `dashboard-focus.test.ts` sends `ESC [ Z` |
| AC-03 focus is always a visible area | "keeps the focus on an area that is drawn after any key" (every key, depth 3, at 40, 80, 120, 160 columns), "keeps the board and the focus together after a resize" |
| AC-04 footer | "names the focused area...", "keeps the Tab hint on a narrow screen" (40 and 50 columns, Unicode and ASCII) |
| AC-05 pane block | "labels the line under the block, in ASCII too"; `[ ]` shown in the footer only while a step runs |
| AC-06 sizes | "draws no titles under 12 rows", "takes one row for the title of each area", the layout expectations below |
| AC-07 NO_COLOR and ASCII | the marker and the area word are text; the tests read `Row.text`, never a style |
| AC-08 other keys | the rest of `ui-state.test.ts` and the TUI suite pass unchanged |

## Expectations changed on purpose

- `ui-state.test.ts`: from the detail, `tab` now reaches the board (it went to the list); with the board open `tab` now goes list, detail, board (it went list, board).
- `layout.test.ts`, `board-dock.test.ts`: one row less for each area's title from 12 rows up (30 rows split: 27 instead of 28; stacked 24 rows: list 6 instead of 7).

## Found by the independent read, and fixed

1. The footer put `f follow` and `PgUp/PgDn` before `Tab`, so a 40 column screen cut the hint to the next area. `Tab <next>` now comes straight after the area name.
2. After narrow, wide, narrow, `ui.board` and `ui.focus` could disagree. `clampUi` now sets `board` to "focus is the board" when not docked and to false when docked.
3. Home called `computeLayout` and lost a row of its list to titles it never draws. `computeLayout` takes `titles: false` and Home passes it.
4. `b` on a run without a board left the keys on a board `tab` could not visit, so `tab` skipped the steps. A board that is not a stop counts as the last stop. (A no-op `b` was tried and rejected: `board-dashboard.test.ts` documents "There is no board for this run.")

## Not done, and known

- The SVG screenshots in `docs/assets` still show the old key line. They are drawings, not generated; redraw them when the screens are next captured.
- The two inverse things on a screen (the selected step, the focused running-step pane) are unchanged. The area title is told apart by the `▶` and the word.
- Nobody has tried it on a real terminal at 40 or 160 columns except through the fake terminal; the maintainer's own narrow screen is the check.
