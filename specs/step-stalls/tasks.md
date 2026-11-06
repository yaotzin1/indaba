# Tasks: step stalls

## Release 1 (`timeout_seconds`): done

Ordered by dependency. Each task independently checkable. Tests are written first for each task (stage 6).

## Domain

- [x] **T-01** `MAX_TIMEOUT_SECONDS` and `StepDefinition.timeoutSeconds?` in `core/workflow/model.ts`; exported from the index. Test: `defineStep` keeps the field, omits it when absent.
- [x] **T-02** `RunnerParticipantOptions.timeoutSeconds?`; `respond` puts it in the request only when set. Test: with and without it, on the `RunRequest` a fake runner receives (AC-14, AC-20).

## Infrastructure

- [x] **T-03** Parser: `timeout_seconds` whole number 1 to 86400 on any step kind; the contract's message for 0, 86401, 1.5, "10", a list, null. Test in `parser-errors.test.ts` and `parser.test.ts` (AC-01, AC-14).
- [x] **T-04** Executor: effective limit `step.timeoutSeconds ?? global`; shell commands, agent call and debate participants all receive it. Tests with a fake runner that records `timeoutSeconds` (AC-01, AC-02, AC-14).
- [x] **T-05** A step that times out ends as today with `Timed out after N seconds.` where N is the step's number, and `on_failure` applies (AC-03). Test with a fake runner returning exit 124.
- [x] **T-06** `indaba.step.timeout_seconds` on the step span only when set. Test on the exporter output; a step without the field has no such attribute (AC-20).
- [x] **T-07** Compatibility pin: a workflow without the field produces the same requests, events and attributes as before (AC-20).

## Console

- [x] **T-08** `schema` lists `timeout_seconds` (`editor/schema.ts`); `plan` prints `timeout Ns`. Tests in the existing schema and CLI plan tests.

## Tests

- [x] **T-09** Hostile inputs for the number (strings, negative, huge, NaN, YAML anchors producing non-integers): rejected before anything runs, message without file contents.
- [x] **T-10** `core/test/architecture.test.ts` and the `layers.test.ts` files still green.

## Documentation

- [x] **T-11** `docs/workflow-format.md` (field table, precedence, "per call", debates, not the same as `permissions.timeout_seconds`), `docs/playbook.md` and `docs/ai-playbook.md`, `docs/README.md` if a page is added, `llms.txt`, the Pages build (`node scripts/build-site.mjs --check`).
- [x] **T-12** `CHANGELOG.md` under Unreleased; `specs/DEPENDENCY_MAP.md` (no new dependency: say so if it lists packages).
- [x] **T-13** Cookbook note: where `examples/crud-inventory.workflow.ai.yml` could set a longer limit on `implement`. Optional; do not change the example's behaviour in this release.
- [x] **T-14** `review.md` answered against `.agents/rules/review.md`; the seven answers with real `pnpm qa` and `check-workflow` output.

## Gates

- [x] **T-15** `pnpm qa`, `node scripts/check-workflow.mjs`, the other node gates, `node scripts/check-track.mjs`. Report the actual output.

## Release 2 (`stall` and its retry)

Ordered by dependency. Tests first for each task (stage 6). The numbers continue from release 1.

### Domain

- [ ] **T-16** `StallPolicy`, `StepDefinition.stall?` and the three constants in `core/workflow/model.ts`; exported. Test: `defineStep` keeps the field and omits it when absent.
- [ ] **T-17** `RunRequest.stallSeconds?`; `RunResult.stalled?` and `RunResultInit.stalled?`, present only when true. Test: absent on an ordinary result, `true` when given (AC-05, AC-06).
- [ ] **T-18** `StallCapable` and `isStallCapable` in `core/extension/stall.ts`, exported. Test: true only for `canReportActivity === true`; a plain `Runner` is not; a runner saying `false` is not.

### Runners

- [ ] **T-19** `ProcessSpec.stallSeconds?`, `ProcessOutcome.stalled?`, `STALL_EXIT_CODE`; the silence timer in `supervise` for the piped and the PTY path. Tests with a fake clock: no data for N seconds stalls and kills the tree; data on stdout or on stderr restarts it; a timeout that comes first is a timeout, not a stall (AC-10); no `stallSeconds` leaves behaviour as today (AC-20).
- [ ] **T-20** `executeProcess` passes `stallSeconds` and builds a result with `stalled: true`, exit code 125 and `Stalled: no activity for N seconds.` in `errorOutput`. Test through a fake spawner.
- [ ] **T-21** `ClaudeRunner` implements `StallCapable`: true by default, false with `reportUsage: false` or its own `--output-format`. Test: the command line and result with `stallSeconds` absent equal today's (AC-15, AC-16, AC-20); with it set, the same command line (nothing added).

### Engine

- [ ] **T-22** Parser: `stall` with the messages of `api-surface.md`; AC-11 and AC-13 refusals; unknown key; every bad number (strings, 59, 3601, 1.5, null, anchors). Tests in `parser.test.ts` and `parser-errors.test.ts` (AC-04, AC-11, AC-13).
- [ ] **T-23** `checkStalls` (AC-12) and `StepExecutor.stallFindings`; `WorkflowEngine.run` refuses them. Test: a plugin runner without the capability is refused by name and step; a runner saying `false` is refused; a chain where only the first is capable is refused (AC-12, AC-21).
- [ ] **T-24** `RestorableWorkspace`, `isRestorable`, `GitWorktree.checkpoint` and `restore`, in a real temporary repository: tracked edits reverted, untracked files the attempt created removed, untracked files present before kept, ignored files kept, more than 10 000 untracked refused, a hostile checkpoint value refused (C-06, section 6).
- [ ] **T-25** `StepExecutor.runAgent` sends `stallSeconds`; a stalled result becomes `StepOutcome.stalledFor`; a stalled result for a step with no `stall` is a plain failure with its reason and no retry (spec section 5). `invoke` sets `indaba.stall.silent_seconds`.
- [ ] **T-26** `WorkflowEngine.execute` attempt loop: retries left restore and run again with the stall as the only feedback; none left fails with the reason and `on_failure` applies; the stall retries and `on_failure` budgets are independent and the counter resets when the step is reset (AC-06 to AC-09); a non-restorable workspace gives `restore_failed`; the status reasons and the event order of `events.md`; cancellation during a retry ends cancelled.
- [ ] **T-27** Span attributes `indaba.stall.after_seconds`, `.retries`, `.count` and the `indaba.step.stalled` event, with none of them on a step without `stall` and no prompt or output in any (AC-18, AC-19, AC-20).

### Console

- [ ] **T-28** `schema` lists `stall`; `plan` prints `stall Ns` and the retries; `validate`, `plan` and the run gate report the AC-12 finding through `stall-report.ts`.

### Tests across

- [ ] **T-29** Compatibility pin (AC-20): a workflow without `stall` yields the same requests, events and attributes as before. The architecture and layers tests stay green.
- [ ] **T-30** End to end with a fake runner that stalls once and then succeeds, in a real temporary git repository: the first attempt's file is gone, the second attempt's is kept, the statuses and event are as specified.

### Documentation and gates

- [ ] **T-31** `docs/workflow-format.md` (field table, the floor, what activity means for `claude-code`, what a restore cannot undo, the runner table), `docs/playbook.md`, `docs/ai-playbook.md`, `docs/cost-experiments.md` (a stalled call can be paid for), the Pages build.
- [ ] **T-32** `CHANGELOG.md` under Unreleased with the semver classification (minor); `specs/DEPENDENCY_MAP.md` (no new dependency).
- [ ] **T-33** `review.md` answered against `.agents/rules/review.md` with the real output.
- [ ] **T-34** `pnpm qa`, `node scripts/check-workflow.mjs`, the other node gates, `node scripts/check-track.mjs`; report the actual output.
