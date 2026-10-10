# Tasks: Run blackboard

Each task is checkable on its own; tests come with the code. Run `pnpm qa` after each group.

## `@indaba/core`

- [ ] T1. `BoardKind`, `AGENT_POSTABLE_KINDS`, `DEFAULT_READ_KINDS`, `BoardEntry`, the four record types,
  `BoardLimits`, `DEFAULT_BOARD_LIMITS`; export. Test: the kind sets, that no engine-only kind is postable.
- [ ] T2. `RunBoard.post`: cleaning (newlines, tabs, controls, spaces), redaction (a throw stores nothing), cut and
  `cut` flag, `seq`, the entry and character allowance and the single `truncated` record, `isFull`.
- [ ] T3. `RunBoard.settle`, `supersede`, `stateOf`, `entries(view)`, `facts`: pending to accepted, discarded,
  superseded; the latest settlement wins; a settle covers only earlier entries; scopes; a fact replaced by a newer
  value keeps the older in the log.
- [ ] T4. `RunBoard.replay`: a board rebuilt from its own records gives equal `entries`, `facts` and next `seq`.
  Same inputs and clock give identical records (determinism test).
- [ ] T5. `buildDigest`: selection (steps, kinds, accepted only, not the step itself), facts first, newest-first
  within `maxChars` shown oldest-first, the omitted line, an empty board, nothing fits, byte-identical for the
  same input. Hostile entries (instruction-like text, `BOARD note:` lines, fences, `| ` prefixes) cannot form a
  line without the prefix (AC-16).
- [ ] T6. `parseBoardLines`: each kind and the fact key grammar; case; first-column rule; indented, bulleted and
  quoted lines ignored; fenced blocks skipped; the limit of 10; text over the limit; empty text; not allowed
  kinds; an input of 1 MiB scanned without a slow path (a timing bound in the test, not a number in the spec).
- [ ] T7. `StepBoard` and `StepDefinition.board`; `BoardRecorded`. `ConsensusArbiter.deliberate` observer: called
  once per message, in order, not called when absent; the result is unchanged. `architecture.test.ts` still
  passes.

## `@indaba/engine`

- [ ] T8. Parse and validate `board`: every rule and error path of the field table (shell step, debate step with
  `post`, unknown step, non-ancestor, unknown and not postable kinds, `digest_chars` range, unknown key); a
  workflow without `board` parses to the same definition as before.
- [ ] T9. Run wiring: the run's `RunBoard`, the sink dispatching `BoardRecorded`, `attempt` in `StepRunOptions`.
  Settlement after `execute` (ok, failed, escalated, cancelled) and `supersede` in the retry reset loop.
- [ ] T10. Digest in prompts: `PromptBuilder.build` with and without a digest (the latter byte-identical to
  today); `runAgent` and the debate topic use it; the three span attributes.
- [ ] T11. Posting from replies: only with `board.post`, only a successful result, only the runner's output;
  counts on the span; a failing step's posts are `discarded`; a completed step's are `accepted`.
- [ ] T12. Retry isolation (AC-24): a step fails once, is retried; the second prompt holds the last failure and no
  entry of the first attempt; entries of reset steps are `superseded` and absent from digests.
- [ ] T13. Debates: the observer mirrors every message, the outcome `result` and the ruling `decision`; the
  entries are `accepted` whatever the outcome; the ledger-skipped debate; a test compares the debate's own board
  with its copy. The transcript, ruling artifacts and ledger are unchanged (existing tests stay green).
- [ ] T14. `board-records.ts` (`serializeBoardRecord`, `parseBoardRecord`, `BOARD_FILE_SUFFIX`) and
  `BoardWriter`: whole lines in order, one queue, run-id validation, the first failure reported once and the
  run unaffected. Tests with a temporary directory and an unwritable one.
- [ ] T15. `BoardReader`: `exists`, `readAll`, `follow` with a partial last line, an unknown record, a line that
  is not JSON, a later `v`.
- [ ] T16. Regression: for a workflow without `board` fields the prompts, outcomes and exit codes are as before,
  and the trace file and event stream are byte-identical (AC-27, AC-31).

## `indaba` (CLI)

- [ ] T17. `createEngine` registers `BoardWriter`; a write failure adds `indaba.board.degraded` (class name only)
  and does not fail the run. `layers.test.ts` stays green.
- [ ] T18. `plan` prints the `board:` line; `validate` shows the errors of T8 with paths.
- [ ] T19. `watch --plain` prints the board section (AC-39), limited to 50 entries, with the count of older ones.
- [ ] T20. End to end through the built CLI: a scripted runner posts lines; a later step's prompt (captured by the
  fake runner) holds the digest; a debate workflow shows its messages on the board; a replayed board equals the
  live one.

## `@indaba/tui`

- [ ] T21. `emptyBoard`, `reduceBoard`, the filtered list, the facts and the detail view; pure tests: filters
  combine and clear, discarded and superseded hidden by default, an unknown record, a record out of order.
- [ ] T22. The board pane: layout, keys and legend of C-13, glyph and word per kind, `NO_COLOR`, ASCII fallback,
  sanitising of every string (a hostile entry cannot repaint the terminal), "no board file yet", "the board is
  incomplete". Reconcile the keys with the dashboard's legend.
- [ ] T23. `watch` follows the board file beside the trace; a layers test keeps `@indaba/tui` importing only
  `BoardReader` and value types from the engine; `@indaba/tui` still loads optionally.

## Documentation and gates

- [ ] T24. `docs/workflow-format.md` (the `board` field, the post lines with a worked example, the digest, what a
  retry does to the board, the limits and that they are not measured), `docs/getting-started.md` (reading the
  board in the TUI), `docs/extending.md` (the `BoardRecorded` event for listeners), `README.md`, `CHANGELOG.md`
  under Unreleased, `specs/DEPENDENCY_MAP.md`, `AGENTS.md` repository map if a path changed.
- [ ] T25. An example `examples/board-handoff.workflow.ai.yml` (two steps, the second reading the first's result
  and fact); it passes `indaba validate` and `indaba plan` from the built CLI, and a test keeps it parsing.
- [ ] T26. `specs/agent-mesh` and `specs/tui` get a pointer to this spec; `specs/workflow-editor` is told of the new
  field (its schema is generated from the parser, so no text is copied).
- [ ] T27. `pnpm qa`, `pnpm e2e`, the node gates; coverage at least 85% on all four metrics.
- [ ] T28. Fill `review.md`.
