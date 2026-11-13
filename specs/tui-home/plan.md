# Plan: tui-home

> Stage 3. The contract is `api-surface.md`; the decisions are `spec.md` section 9 (an Indaba debate).

## Approach

Pure first, Ink last, as `ui-state.ts` and `screen.ts` already are.

1. **`@indaba/tui`, pure** (no Ink, no `node:`): `keymap.ts` (the one key table), `home-state.ts` (the reducer; a refresh carries a generation so an older answer cannot overwrite a newer one), `home-screen.ts` (a `Screen` from the state and a `Layout`; a run row is a mark and a word, sanitised, ASCII-safe).
2. **`@indaba/tui`, Ink**: `ink/home-app.ts` renders `ScreenView` for Home and, for an opened run, the existing dashboard `App` with a new `embedded` prop that keeps it from ending the whole Ink instance; `home.ts` is `run()` (render options as `runDashboard`; terminal restored in `finally`; an abort unmounts and returns 130).
3. **`indaba`**: `tui-loader.ts` gains the optional `run`; `home.ts` holds the gate; `main()` calls it for the empty command; `INDABA_ASCII` and `NO_COLOR` are read there.
4. **`scripts/check-workflow.mjs`**: `checkParity` for TUI feature specs (protected; `Workflow-Change:` trailer).
5. **Docs**: `docs/getting-started.md`, both playbooks, `llms.txt` through the site build, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`.

## Test layers

| Layer | Where | Covers |
| :--- | :--- | :--- |
| pure | `packages/tui/test/home-state.test.ts`, `keymap.test.ts`, `home-screen.test.ts` | every key, clamping, stale and superseded lists, quit paths, key table equals `?` rows and docs, layout at 40, 80, 160 columns and 24 rows, ASCII and `NO_COLOR`, sanitising |
| fake terminal | `packages/tui/test/home.test.ts` | `run()` end to end with `FakeStdin` and `FakeStdout`: open a run and come back, resize, `?`, `r`, quit codes, abort, terminal restored when `listRuns` or the app throws |
| layers | `packages/tui/test/layers.test.ts` (extended) | the pure files import neither Ink nor React nor `node:` |
| cli | `packages/cli/test/home.test.ts` | every gate row through `main()` with injected `io`, `loadTui` never called by `--help`, `--version` or `watch`, a thrown `run` redacted |
| e2e | `packages/cli/e2e/home.e2e.test.ts` | the built CLI with piped stdin, and with `INDABA_NO_TUI=1`: exit 2 and today's stderr |
| script | `scripts/check-workflow.test.mjs` | `checkParity` |

## Risks

- The dashboard `App` ends Ink with `exit()`. The `embedded` prop is the only change to it, and its existing tests must stay green.
- Windows cannot be tested for a real PTY here; the fake terminal is the evidence, and a manual run is named in `review.md`.
