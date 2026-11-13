# Tasks: tui-run-control

- [ ] T-01 `@indaba/engine` re-exports the wire types.
- [ ] T-02 `createRunControl().detach()` and the age rule of the sweep, with tests (a fake `RunChild`; `release` not `cancel`; idempotent; the age constant exceeds the start timeout).
- [ ] T-03 `run-flow.ts` and its test (AC-02, AC-10, AC-12, the code-to-screen table).
- [ ] T-04 `run-flow-screen.ts` and its test (AC-13, widths, ASCII).
- [ ] T-05 Home state: keys `n` and `s`, owned runs, quit rules, `quitFailed` (AC-04, AC-11) and its test.
- [ ] T-06 `ink/home-app.ts` runs the effects; the fake-terminal test with a fake control (AC-01, AC-05, AC-06, AC-08, AC-11, AC-12).
- [ ] T-07 `home-control.ts` (redacting adapter) and `runHome` wiring; the cli tests (AC-07, AC-13).
- [ ] T-08 Docs, changelog, dependency map.
- [ ] T-09 `pnpm qa`, the node gates, an Indaba review, `review.md`.
