# Plan: tui-agent-panes, slice 3a

> Stage 3. The contract is `api-surface.md`; the decisions are `spec.md` section 8 (an Indaba debate).

Pure first, Ink last.

1. `panes.ts` (pure): `stepCost`, `paneRowsFor`, `panesFor`.
2. `layout.ts`: `computeLayout` takes the number of running steps and gives `paneRows`, taking them from the detail rows; with none, the layout is byte for byte what it was.
3. `ui-state.ts`: the panel, the focus by step id, enlarge, the notice; `reduceUi` and `clampUi` for the new keys and the clamps.
4. `screen.ts`: `reasoningRows`, a detail view that can be the reasoning or an enlarged pane's step, `Screen.panes`, the key line and the help.
5. `ink/view.ts` draws `Screen.panes`; `ink/app.ts` gives the context its running ids and reasoning length.
6. Docs, changelog, dependency map, `review.md`.

## Test layers

| Layer | Where | Covers |
| :--- | :--- | :--- |
| pure | `panes.test.ts`, `ui-state.test.ts`, `layout.test.ts`, `screen.test.ts` | the pane set and its arrangement (AC-01), 12 running steps at 40x8, 80x24, 160x50 (AC-06), cost unknown and partial, glyph widths, NO_COLOR and `--ascii` (AC-04), sanitising (AC-05), reasoning empty, partial, long and redacted, scroll counted in wrapped rows, enlarge and its clamps, key precedence, the layout of no panes equal to today's |
| fake terminal | `dashboard-panes.test.ts` | `r` `o` `[` `]` `Enter` `z` `Esc` and `b` through the real app, a step that finishes while enlarged, a resize while enlarged and docked |

## Risks

- `UiState` is exported: new members are required, so an outside caller that built one by hand breaks. `initialUi()` is the way to build one and is documented as such.
- `▲` is ambiguous in width on some terminals; the ASCII mode and a width-checking test are the guard.
