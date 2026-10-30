# Tasks: Run blackboard

Each task is checkable on its own; tests come with the code. Run `pnpm qa` after each group.

## `@indaba/core`

- [x] T1. `BoardKind`, `AGENT_POSTABLE_KINDS`, `DEFAULT_READ_KINDS`, `BoardEntry`, the four record types,
  `BoardLimits`, `DEFAULT_BOARD_LIMITS`; export. Test: the kind sets, that no engine-only kind is postable.
- [x] T2. `RunBoard.post`: cleaning (newlines, tabs, controls, spaces), redaction (a throw stores nothing), cut and
  `cut` flag, `seq`, the entry and character allowance and the single `truncated` record, `isFull`.
- [x] T3. `RunBoard.settle`, `supersede`, `stateOf`, `entries(view)`, `facts`: pending to accepted, discarded,
  superseded; the latest settlement wins; a settle covers only earlier entries; scopes; a fact replaced by a newer
  value keeps the older in the log.
- [x] T4. `RunBoard.replay`: a board rebuilt from its own records gives equal `entries`, `facts` and next `seq`.
  Same inputs and clock give identical records (determinism test).
- [x] T5. `buildDigest`: selection (steps, kinds, accepted only, not the step itself), facts first, newest-first
  within `maxChars` shown oldest-first, the omitted line, an empty board, nothing fits, byte-identical for the
  same input. Hostile entries (instruction-like text, `BOARD note:` lines, fences, `| ` prefixes) cannot form a
  line without the prefix (AC-16).
- [x] T6. `parseBoardLines`: each kind and the fact key grammar; case; first-column rule; indented, bulleted and
  quoted lines ignored; fenced blocks skipped; the limit of 10; text over the limit; empty text; not allowed
  kinds; an input of 1 MiB scanned without a slow path (a timing bound in the test, not a number in the spec).
- [x] T7. `StepBoard` and `StepDefinition.board`; `BoardRecorded`. `ConsensusArbiter.deliberate` observer: called
  once per message, in order, not called when absent; the result is unchanged. `architecture.test.ts` still
  passes.

## `@indaba/engine`

- [x] T8. Parse and validate `board`: every rule and error path of the field table (shell step, debate step with
  `post`, unknown step, non-ancestor, unknown and not postable kinds, `digest_chars` range, unknown key); a
  workflow without `board` parses to the same definition as before.
- [x] T9. Run wiring: the run's `RunBoard`, the sink dispatching `BoardRecorded`, `attempt` in `StepRunOptions`.
  Settlement after `execute` (ok, failed, escalated, cancelled) and `supersede` in the retry reset loop.
- [x] T10. Digest in prompts: `PromptBuilder.build` with and without a digest (the latter byte-identical to
  today); `runAgent` and the debate topic use it; the three span attributes.
- [x] T11. Posting from replies: only with `board.post`, only a successful result, only the runner's output;
  counts on the span; a failing step's posts are `discarded`; a completed step's are `accepted`.
- [x] T12. (the debate-retry clause is in board-debate.test.ts.) Retry isolation (AC-24): a step fails once, is retried; the second prompt holds the last failure and no
  entry of the first attempt (settled or still pending); entries of reset steps are `superseded` and absent from
  digests; a step run again from attempt 1 leaves the state of its earlier entries as it was (a re-run test);
  a debate step that is retried supersedes the failed attempt's entries.
- [x] T13. Debates: the observer mirrors every message, the outcome `result` and the ruling `decision`; the
  entries are `accepted` whatever the outcome; the ledger-skipped debate; a test compares the debate's own board
  with its copy. The transcript, ruling artifacts and ledger are unchanged (existing tests stay green).
- [x] T14. `board-records.ts` (`serializeBoardRecord`, `parseBoardRecord`, `BOARD_FILE_SUFFIX`) and
  `BoardWriter`: whole lines in order, one queue, run-id validation, the first failure reported once and the
  run unaffected. Tests with a temporary directory and an unwritable one.
- [x] T15. `BoardReader`: `exists`, `readAll`, `follow` with a partial last line, an unknown record, a line that
  is not JSON, a later `v`. A resumed run (`RunBoard.replay`) appends without a second start record.
- [x] T15b. Plain words (AC-40) and the id syntax of a step id and a scope (AC-02): the messages are listed and
  checked, and an entry with a bad step id or scope is not recorded.
- [x] T16. Regression: for a workflow without `board` fields the prompts, outcomes and exit codes are as before,
  and the trace file and event stream are byte-identical (AC-27, AC-31).

## `indaba` (CLI)

- [x] T17. `createEngine` passes the same redaction function to `WorkflowEngineOptions.board.redact` that it gives the executor and
  the event writer (the board has no default: unset, a secret reaches `.board.jsonl`; a test posts a secret through the built
  engine and finds it in no board record); registers `BoardWriter`; a write failure adds `indaba.board.degraded` (class name only)
  and does not fail the run. `layers.test.ts` stays green.
- [x] T18. `plan` prints the `board:` line; `validate` shows the errors of T8 with paths.
- [x] T19. `watch --plain` prints the board section (AC-39), limited to 50 entries, with the count of older ones.
- [x] T20. End to end through the built CLI: a scripted runner posts lines; a later step's prompt (captured by the
  fake runner) holds the digest; a debate workflow shows its messages on the board; a replayed board equals the
  live one.

## `@indaba/tui`

- [x] T21. `emptyBoard`, `reduceBoard`, the filtered list, the facts and the detail view; pure tests: filters
  combine and clear, discarded and superseded hidden by default, an unknown record, a record out of order.
- [x] T22. The board pane: layout, keys and legend of C-13, glyph and word per kind, `NO_COLOR`, ASCII fallback,
  sanitising of every string (a hostile entry cannot repaint the terminal), "no board file yet", "the board is
  incomplete". Reconcile the keys with the dashboard's legend.
  Done as a switchable pane (`b`); the dock beside the step list on a wide terminal (C-13) is left for a width chosen
  from a sketch, and AC-33 stays open for it. AC-34's word for `superseded` is now `replaced` (AC-40).
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
