# Tasks: Debate arbiter

Each task is checkable on its own; tests come with the code. Run `pnpm qa` after each group.

## `@indaba/core`

- [x] T1. `Verdict`, `Ruling` (with `source`), `RulingRequest`, `Adjudicator`, `AdjudicatorRegistry`; export from `index.ts`. Test: `Ruling.accepted()`.
- [x] T2. `arbiter?: string` on `StepDefinition`; `PluginHost.registerAdjudicator`. Test: absent by default.
- [x] T3. `architecture.test.ts` still passes (no `node:` import).

## `@indaba/engine`

- [x] T4. Parse `arbiter`; validator errors for a non-debate step and a non-string value (AC-01).
- [x] T5. `DecisionLedger`: append one line, lookup by key, newest wins, a malformed line throws with file and line (AC-11, AC-14, AC-15). Tests: hit, miss, supersede, malformed, torn line.
- [x] T6. Memo key and repository state through `Git`: `HEAD`, dirty ignoring `.indaba/` and `.indaba-decisions/`, not a repository (AC-12, AC-13). Tests in a temporary git repository.
- [x] T7. Transcript and ruling writers: confined paths, redacted, control characters removed (AC-08).
- [x] T8. `StepExecutorOptions` additions and the `runConsensus` flow: memo hit, accept, reject, unavailable, throw, cancel (AC-02 to AC-04, AC-06, AC-07, AC-09). Fake adjudicator, fake runners, fake clock.
- [x] T9. Negative test: no span attribute, event or log line contains transcript or note text (AC-09).

## `indaba` (CLI)

- [x] T10. `TerminalAdjudicator` with injected streams; three bad answers return `null`; non-TTY returns `null`; terminal output truncated at a fixed length (AC-05, AC-06).
- [x] T11. `RegistryPluginHost.registerAdjudicator`; register `human`; build the ledger at `<projectDir>/.indaba-decisions`; pass `redact` and `clock`. `--tui` registers no human arbiter (AC-06).
- [x] T12. A plugin registers an adjudicator end to end (AC-10); `layers.test.ts` still passes.

## Documentation and gates

- [x] T13. `docs/workflow-format.md` (the field, the ledger, why it is committed), `README.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`; add `arbiter: "human"` to `examples/review-debate.workflow.ai.yml`.
- [x] T14. `pnpm qa`, `pnpm e2e`, the node gates; coverage at least 85% on all four metrics (AC-16).
- [x] T15. Fill `review.md`.

## Follow-up (added with `specs/workflow-editor`)

- [ ] T16. `Adjudicator.description?`, `AdjudicatorRegistry.describe()` returning `{ name, description }[]`, the terminal arbiter described (AC-17). Done on the branch that implements `workflow-editor`.
