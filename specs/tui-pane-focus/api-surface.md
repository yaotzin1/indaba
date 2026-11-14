# API surface: tui-pane-focus

> **Status**: stage 3 draft; completes once the answers of `spec.md` section 6 are in.
> **Semver impact**: minor below 1.0. Additions to `@indaba/tui`; the Tab order and the footer text change on purpose.

| Surface | Name | Change |
| :--- | :--- | :--- |
| `@indaba/tui` | `KeyName` `'shift-tab'` | new member of an exported union |
| `@indaba/tui` | `UiState.focus` | unchanged type; at a narrow width `'board'` now also means "the board replaces the detail" |
| `@indaba/tui` | `Screen.titles` | new **optional** member: the title row of each area |
| `@indaba/tui` | `Layout.titleRows` | new member: 1 per drawn area, 0 where AC-06 drops it |
| `@indaba/tui` | `areaOrder(ui, context)`, `focusTitle(area, focused, ascii)` | new pure exports |
| `@indaba/tui` | footer text, Tab order | changed behaviour (documented in the changelog) |

Not changed: `@indaba/core`, `@indaba/engine`, the CLI, events, span attributes, workflow format.
