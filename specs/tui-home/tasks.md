# Tasks: tui-home

Order: pure, Ink, composition root, script, docs.

- [x] T-01 `keymap.ts` and its test (AC-03).
- [x] T-02 `home-state.ts` and its test: keys, clamping, `?`, quit paths and `confirmQuit` (AC-06), stale and superseded lists (AC-12).
- [x] T-03 `home-screen.ts` and its test: rows, details, layouts, ASCII, sanitising (AC-04, AC-05, AC-07, AC-11).
- [x] T-04 Layers test: the pure files import neither Ink, React nor `node:`.
- [x] T-05 `embedded` prop of the dashboard `App`; its tests unchanged.
- [x] T-06 `ink/home-app.ts`, `home.ts` (`run`) and the fake-terminal test (AC-01, AC-06, AC-11, AC-12; restore on error).
- [x] T-07 `tui-loader.ts` optional `run`, and its test (AC-09).
- [x] T-08 `packages/cli/src/home.ts`, `main()` wiring, and the cli test of every gate row (AC-02, AC-08).
- [x] T-09 e2e case: piped stdin and `INDABA_NO_TUI=1` (AC-02).
- [x] T-10 `checkParity` and its self-test (AC-10; `Workflow-Change:`).
- [x] T-11 Docs: getting-started, both playbooks, CHANGELOG, DEPENDENCY_MAP.
- [x] T-12 `pnpm qa`, the node gates, `review.md`.
