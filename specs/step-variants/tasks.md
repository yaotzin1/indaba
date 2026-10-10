# Tasks: Step variants

Each task is checkable on its own; tests come with the code. Run `pnpm qa` after each group.

## `@indaba/core`

- [ ] T1. `QuorumRule`, `AGREEMENT_QUORUM` (the current logic, moved), the `quorum` option. A regression test pins an unchanged debate's transcript, outcome and rounds. `architecture.test.ts` still passes.
- [ ] T2. `AgentMessage.choice` and `fromBallotReply`: an exact id, `none`, case of `CHOICE`, whitespace, a second `CHOICE:` line, extra text after the id, a path, an unknown id, an empty reply, a very long first line. Only the first line counts.
- [ ] T3. `tallyBallot` and `BALLOT_QUORUM`: unanimous, split, tie (no leader), nobody chose, `majority` with 3, a changed choice between rounds uses the latest. No randomness; same board twice gives the same tally.
- [ ] T4. `ConsensusResult.ballot` and `choice()`; stall detection still works on repeated ballot messages.
- [ ] T5. `Ruling.choice`, `RulingRequest.ballot`, `Ballot`. Existing arbiters compile and behave unchanged.
- [ ] T6. `VariantDefinition`, `VariantsDefinition`, `variants` and `examineWith` on `StepDefinition`; `defineStep` defaults; the two events.

## `@indaba/engine`

- [ ] T7. Parser and validator: both forms of `variants`, entry keys, `variants_concurrency`, `examine_with`; the validation table of `api-surface.md` (count 1 and 5, empty list, non-integer, shell step, debate step, no isolation, inherited isolation only, unknown key, unknown runner, undefined examiner role, orphan `examine_with`, orphan `variants_concurrency`); `arbiter` valid with `examine_with`.
- [ ] T8. `Workspace.snapshot` and `diff(since)` against a temporary git repository: unchanged workspace, edited, untracked, deleted and binary files, `.indaba` excluded, a workspace that already holds changes.
- [ ] T9. Seeding: a variant worktree created from a workspace with earlier changes starts identical to it, and its diff since the snapshot contains only its own change; applying that diff to the workspace succeeds.
- [ ] T10. The attempts: concurrency bound respected (a fake runner that records overlap), declaration-order numbering whatever the finish order, per-variant `outputs` and guards, a failed variant dropped with its diff kept, all failed gives one line per variant and no examination.
- [ ] T11. The examination: examiners get ids, counts and diff paths and no runner, model or label (assert the prompt); a unanimous choice applies exactly that diff after `canApply`; `none` escalates; a split that stalls goes to the arbiter with the ballot; `accept` applies the leader; `accept` naming a candidate applies it; `accept` on a tie with no named candidate escalates; `reject` escalates; no arbiter escalates; an unknown named id fails and applies nothing.
- [ ] T12. An examiner that changes the workspace fails the step and applies nothing (AC-13).
- [ ] T13. Teardown: every worktree removed after completion, failure, escalation, cancellation, a throw while creating the Nth, and an arbiter that throws. The abort signal is not passed to removal.
- [ ] T14. Cancellation mid-run aborts every variant and the examination; the step is cancelled.
- [ ] T15. Artifacts: `.variant-<n>.diff` for candidates and failed variants that produced a diff, `selection.md`, the debate artifacts, redaction applied, overwritten on a retry; a write failure fails the step and applies nothing.
- [ ] T16. Spans and events from `events.md`; a negative test that no attribute, event or log line holds a diff, summary, reason or note.
- [ ] T17. `on_failure: retry_step` re-runs every variant and the examination in fresh worktrees; nothing is reused. The ledger is neither read nor written.
- [ ] T18. Budget and verdict seams (after `specs/step-budgets` and `specs/step-verdicts` land): an equal share per variant, examination spend counted against the total; the applied variant's verdict is the one routed.

## `indaba` (CLI)

- [ ] T19. The terminal arbiter shown a ballot: prints candidates, counts and leader; accepts `accept`, a candidate id, `reject`; invalid input asked again at most three times then unavailable; escape sequences stripped; unchanged without a ballot.
- [ ] T20. `plan` output.
- [ ] T21. End to end through the built CLI with fake runners: three variants, one fails its guard, two examiners agree on another, its diff is in the workspace and the others are only artifacts; a split ending in a scripted arbiter. `layers.test.ts` still passes.

## Documentation and gates

- [ ] T22. `docs/workflow-format.md`, `docs/extending.md`, `README.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`, `examples/variants.workflow.ai.yml` (passes `validate` and `plan`; a test keeps it parsing). The documentation says variants are not a security boundary, that the limits are not measured, and that examiners can be steered by what the code says.
- [ ] T23. `pnpm qa`, `pnpm e2e`, `pnpm smoke`, the node gates; coverage at least 85% on all four metrics.
- [ ] T24. Fill `review.md`.
