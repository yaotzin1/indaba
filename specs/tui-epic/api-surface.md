# API surface: TUI epic (index)

> **Semver impact**: none at the epic level. Each feature classifies itself. Provisional until each feature's stage 3.

The epic adds no symbol of its own. Where each shape lives (epic rule R-02): the wire types are defined in `@indaba/core`, **re-exported by
`@indaba/engine`** (as the logging types are in `packages/engine/src/index.ts`), declared nowhere in `@indaba/tui`, and satisfied by
controls the CLI builds and injects.

| Feature | Expected surface |
| :--- | :--- |
| `tui-home` | bare `indaba` on a terminal opens the application (a changed default, see its file); optional `TuiModule.run`; `INDABA_NO_TUI`, `INDABA_ASCII` |
| `tui-run-control` | engine re-exports of the run-control wire types; a detached mode of the CLI's run control; an injected run control and workflow list |
| `tui-agent-panes` | none expected in core or engine; screens in `@indaba/tui` |
| `tui-questions` | an injected answer control over the channel the question specs define (blocked) |
| `tui-workflows` | engine re-exports of the registry wire types; an injected registry control |
| `tui-editing` | engine re-exports of the source and editor wire types; an injected editor control; a start of the user's editor |

## Checks

- [ ] `@indaba/tui` redeclares no wire type and imports only `@indaba/engine` (`packages/tui/test/layers.test.ts` unchanged)
- [ ] The only protected-file changes the features need are the parity check in `scripts/check-workflow.mjs` (a `Workflow-Change:` trailer)
