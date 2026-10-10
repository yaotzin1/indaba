# Tasks: Ruling channel

Each task is checkable on its own; tests come with the code. Run `pnpm qa` after each group.

## `@indaba/core`

- [ ] T1. `RulingRequested` and `RulingAnswered`; export. `architecture.test.ts` still passes.

## `@indaba/engine`

- [ ] T2. `RulingFile` and `RulingAnswer` shapes with strict readers. Tests: missing fields, wrong types, a note over 2,000, an unknown verdict, extra fields ignored.
- [ ] T3. `answerRuling` and `listPendingRulings`: atomic write, id validation (`../`, empty, long), no such request, dead `pid` removed, `EPERM` treated as alive, a request that does not parse removed.
- [ ] T4. `FileRulingAdjudicator`: request written whole, answer picked up, malformed answer ignored and counted, files removed afterwards, abort removes the request and returns `null`, a throw removes the request, request cannot be written fails with the path. Fake `sleep`, fake ids and clock.
- [ ] T5. The two event-stream records and the writer methods; a reader that predates them skips them (AC-10).
- [ ] T6. The attribute `indaba.arbiter.invalid_answers`; the request and the answer are redacted and cleaned (AC-04, AC-06).

## `indaba` (CLI)

- [ ] T7. `--rulings terminal|files|none`: parsing, the default by terminal, the usage error; `terminal` without a terminal is an error.
- [ ] T8. `run --tui` starts its child with `--rulings files` (AC-03).
- [ ] T9. `indaba rule list`, `rule <id> accept|reject [--note]`, `rule <id> show`; exit codes `0`, `1`, `2`.
- [ ] T10. End to end: a run waits on a failed debate; `indaba rule` answers from a second invocation; the run completes and the ledger holds the ruling; cancel while waiting leaves no request file.

## Documentation and gates

- [ ] T11. `docs/workflow-format.md` (arbiter), `docs/getting-started.md` (the directory, the command, the option), `README.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`.
- [ ] T12. `pnpm qa`, `pnpm e2e`, the node gates; coverage at least 85% on all four metrics.
- [ ] T13. Fill `review.md`.
