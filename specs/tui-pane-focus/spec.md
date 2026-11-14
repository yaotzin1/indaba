# Feature TUI-3.7: knowing where you are, and Tab reaching every pane (`tui-pane-focus`)

> **Level**: feature of [`tui-epic`](../tui-epic/spec.md), follow-up of [`tui-agent-panes`](../tui-agent-panes/spec.md).
> **Status**: stages 1 and 2 done (the maintainer chose every recommended answer in section 6 on 2026-11-15); implementation on `feat/tui-pane-focus`. **Track**: feature · **Semver impact**: minor below 1.0
> (new visible marks and one changed key behaviour in `@indaba/tui`; nothing in core, engine or the CLI).
> **Audience**: a person who is not a developer and has never seen the dashboard before ([`project_audience-non-developers`]).

---

## 1. The problem

Reported by the maintainer on a real terminal, 2026-11-14:

1. **No sign of where the keys go.** `Tab` moves the arrow keys between the step list, the detail pane and the board
   (`UiState.focus`). Nothing on the screen shows which one has them. The footer says "tab pane", which names no pane.
   The focused running-step pane (`[` `]`) has a mark; the three areas do not.
2. **Tab does not reach every pane on a narrow terminal.** Wide (160 columns or more) the board is docked and Tab visits list,
   detail, board. Narrower, the board is not a pane of its own: `b` swaps it in place of the detail. `nextFocus` then goes
   list → board → list while the board is open and list → detail → list while it is closed, so the detail is unreachable with
   the board open and the board is unreachable with Tab at all. The same key does a different thing at two widths and the
   footer does not say so.
3. The result, in the maintainer's words: "it is hard to navigate". Two focus ideas (`Tab` for the area, `[` `]` for a running
   step's pane) are on screen at once with no way to tell them apart.

## 2. Stories

- **TUI-3.7.1** As a person, I can always see which area has my arrow keys, without colour, in ASCII mode and at 40 columns.
- **TUI-3.7.2** As a person, `Tab` visits the same areas in the same order at every width; a narrow screen shows the area I
  tab to instead of hiding it.
- **TUI-3.7.3** As a person, the bottom line names the area my keys act on and what the keys do there, so I do not need the
  help screen to move.
- **TUI-3.7.4** As a person, the two kinds of focus (area by `Tab`, running step by `[` `]`) look different and each is named.

## 3. Acceptance criteria

- [x] AC-01 Every area drawn (steps, detail, board, and the block of running-step panes) has a one-row **title** that carries its
  name. The focused area's title is drawn inverse and starts with a marker (`▶`, `>` in ASCII); the others are drawn dim with a
  blank where the marker would be. With `NO_COLOR` the marker and the word are enough (inverse alone is not relied on).
- [x] AC-02 Order and reach: `Tab` cycles steps → detail → board → steps at every width (without a board to show, steps ↔ detail).
  `Shift-Tab` goes back. Where there is no room to dock the board, the area tabbed to **replaces the detail pane** and the title
  says so ("Board (replaces Detail)"); leaving it restores the detail.
- [x] AC-03 `b` and `Esc` keep their meaning and agree with `Tab`: they only change which area has the focus (and, narrow, which
  one is shown). A test walks every key from every state at 40, 80, 120 and 160 columns and checks `focus` is a visible area.
- [x] AC-04 The footer is built from the focused area: `Steps  ↑↓ choose   Tab next: Detail …`, `Detail  ↑↓ scroll …`,
  `Board  …`. It names the area, the next stop of `Tab`, and at most the keys that act there; it is clipped, never wrapped.
- [x] AC-05 The running-step pane block shows its own focus apart from the area focus: the block title reads
  `Running 2 of 5 · [ ] move`, the focused pane is inverse with the same marker. The key `[` `]` acts regardless of the area focus
  as today, and the footer mentions it only when there is a running step.
- [x] AC-06 Nothing is added below 40 columns or 8 rows (`too-small` stays a notice). Titles cost one row per area and are drawn
  from 12 rows up (`TITLE_MIN_ROWS`); under 12 rows there are none and the footer alone carries the marker and the area name, so
  the answer to "where are my keys" never disappears. A stacked screen draws the detail title where the separator line was, so
  it costs no row. The layout stays a pure function of the size.
- [x] AC-07 `NO_COLOR` and `--ascii` give the same information (epic R-03); a test strips all styling and still finds the marker,
  the area name and the footer.
- [x] AC-08 Keys keep working as before except the Tab order of AC-02: a regression test per existing key in
  `ui-state.test.ts` stays green or is changed on purpose, listed in `review.md`.

## 4. Out of scope

Mouse, remembering the focus between runs, a command palette, and the chat panel (slice 3b).

## 5. Where it lives

`@indaba/tui`: `ui-state.ts` (`nextFocus`, `Shift-Tab`), `layout.ts` (title rows), `screen.ts` (titles, footer), `ink/view.ts`
(inverse title), `ink/app.ts` (key mapping for `Shift-Tab`), docs (playbook, the TUI page), changelog, dependency map.
No dependency is added.

## 6. Clarifications (answered 2026-11-15: all recommended)

1. **Narrow board.** Recommended: the board **replaces** the detail while it has the focus (title says so). Alternative: a
   third stacked pane, which does not fit in 24 rows.
2. **Shift-Tab.** Recommended: add it. Terminals send it as `ESC [ Z`; Ink reports it as `shift+tab`.
3. **Marker style.** Recommended: inverse title row with `▶`. Alternative: a coloured border, which `NO_COLOR` loses.
4. **Is Tab's changed order a breaking change?** Recommended: no. It is a minor below 1.0: the board and the detail were already
   Tab stops at 160 columns, and a narrow Tab that skipped the detail was the defect.

## 7. Parity

| Capability | Web view | TUI | `--plain` / CLI |
| :--- | :--- | :--- | :--- |
| Which area has the keyboard | the browser's own focus ring | this feature (title row, `▶`, footer) | not applicable: no keyboard, lines only |
| Moving between areas | Tab through the page | this feature (`tab`, `shift-tab`, same order at every width) | not applicable |

## Artifacts not written

- `research.md`: nothing external is relied on.
- `data-model.md`: no data is added; `UiState.focus` keeps its type.
- `events.md`: the feature reads events and emits none.
