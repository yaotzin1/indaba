# API surface: tui-home (provisional)

> **Status**: provisional, written at stage 1 and revised 2026-11-06. Stage 3 replaces it with signatures before any code.

## Semver classification

**Minor below 1.0, labelled as a changed default; a major from 1.0.** No export changes incompatibly. What changes is the behaviour of the
command `indaba` with no arguments **on a terminal**: today a usage error (stderr, exit 2), after this a full-screen application.
`AGENTS.md` section 4 classes a changed default or CLI behaviour as a major, and below 1.0 a major takes the next minor and says so.
Without a terminal, or with `INDABA_NO_TUI=1`, the behaviour is byte-for-byte unchanged and `main.test.ts` and `basics.e2e.test.ts` stay as they are.

## Surface

| Surface | Name | Change |
| :--- | :--- | :--- |
| CLI | bare `indaba` | opens the application on a terminal |
| Environment | `INDABA_NO_TUI=1` | keeps today's behaviour |
| Environment | `INDABA_ASCII=1` | ASCII glyphs in bare `indaba` (it has no option parser); `NO_COLOR` already applies |
| `@indaba/tui` | `TuiModule.run?(options)` | new, **optional**, checked by `tui-loader.ts` like `editLoggingSettings` |
| `scripts/check-workflow.mjs` | parity check for `tui-*` specs | new (protected file) |

## Checks

- [ ] An older installed `@indaba/tui` without `run` leaves bare `indaba` as today
- [ ] Every type in a new public signature is public or marked `@internal`
