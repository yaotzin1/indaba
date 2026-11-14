# Plan: tui-pane-focus

1. `ui-state.ts`: `'shift-tab'` key; `areaOrder(context)`; `focusOn` (the board is shown in place of the detail only while it has the
   keys, when not docked); `nextFocus(ui, context, step)` wraps round `list, detail, board`. `UiContext.hasBoard`, absent counts
   as true so callers that never set it keep working.
2. `layout.ts`: `TITLE_MIN_ROWS = 12`, `Layout.titleRows`; one row off each area's rows, none off the stacked detail (its title
   replaces the separator).
3. `screen.ts`: `focusTitle`, `titlesFor`, `Screen.titles`; footer built from the focused area and the next stop of Tab; the line
   under the pane block is labelled. `buildScreen` wraps the old body so no return path can forget the titles.
4. `ink/view.ts` draws the titles; `ink/app.ts` maps Ink's `shift`+`tab` and passes `hasBoard`.
5. Docs (playbook, changelog), dependency map, `review.md`.

Risks: the row counts of `computeLayout` change by one at 12 rows and up (three existing expectations updated on purpose); the
two inverse things on screen (the selected step, the focused pane) stay as they are, the area title is told apart by the `▶`.
