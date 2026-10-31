# Specification: Step stalls (a per-step time limit, a no-activity limit, and a bounded retry of the stalled attempt)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 to 3 (the decisions in section 8 are recommended; the maintainer confirms them; `plan.md` and `tasks.md` follow)
> **Semver impact**: minor (optional step fields, one optional runner interface, optional members of `RunRequest` and
> `RunResult`, new span attributes and one new span event; below 1.0). **Nothing changes for a workflow that uses none of
> the new fields**: no default moves. Confirmed in [`api-surface.md`](api-surface.md).
> **Builds on**: [`specs/workflow-engine`](../workflow-engine/spec.md) (step state, `on_failure`, retries),
> [`specs/git-workspace`](../git-workspace/spec.md) (the worktree a stalled attempt leaves behind),
> [`specs/agent-permissions`](../agent-permissions/spec.md) (the pattern of an optional runner capability checked by
> `validate`), [`specs/observability`](../observability/spec.md) (span attributes and events).
> **Meets**: [`specs/step-budgets`](../step-budgets/spec.md) (a stalled attempt still spends; see section 10).

---

## 1. The problem

An agent call can stop making progress without failing. The process is alive, uses almost no CPU, writes nothing and
prints nothing, and Indaba waits for it.

This was seen on 2026-10-31, in a real run of the CRUD cookbook (`examples/crud-inventory.workflow.ai.yml`) with the
`claude-code` runner. `verify` failed (`npm test`), the `on_failure` of `verify` sent the run back to `implement`, and the
second `implement` produced nothing for more than ten minutes: the agent process had used 16 CPU-seconds since it
started, and the worktree had no file change after the attempt began. The `implement` of an earlier, complete run of
the same workflow took 1.6 minutes.

Today a person who runs Indaba has these means, and none is enough:

1. **A single global limit.** A step is limited by `indaba run --timeout <secs>` (default 900), the same for every step of
   the run. A step that normally takes two minutes and one that normally takes twelve share one number, so a limit that is
   safe for the second wastes thirteen minutes on the first.
2. **A timeout is a plain failure.** When it elapses, the step fails. A step with no `on_failure` of its own ends the run
   `failed`, even when the step is the target of another step's `retry_step` that still has retries left (the engine
   counts a retry against the step that *fails*, not against the one that is *re-run*). The stalled `implement` above has
   no `on_failure`; its timeout would have ended a run in which `verify` had two retries left.
3. **No way to tell a stall from slowness.** The `claude-code` runner calls `claude -p` in its plain mode, which prints
   nothing until the answer is complete, so from outside a stalled call and a slow call look the same for the whole of
   the limit. `indaba watch --stale` only stops the *person* following a quiet run; it does nothing to the run.

The cost is time and, for a hosted agent, money: a run is held for the whole limit, and the person who started it and
walked away comes back to nothing.

## 2. User stories

- **US-01.** As a workflow author, I give a step its own time limit, because the tests step and the implement step do
  not take the same time, so that a step that hangs costs minutes, not the global default.
- **US-02.** As a workflow author, I say "if this step shows no sign of life for five minutes, stop it", without having
  to guess how long a correct run of it takes.
- **US-03.** As a workflow author, I say "and try it once more", so that an unattended run survives one stalled call.
- **US-04.** As a person following a run, I see that an attempt stalled, after how long, and whether it is being
  retried, in the dashboard, the web view and the trace, and not a step that is silently `RUNNING`.
- **US-05.** As a developer embedding the engine or writing a runner plugin, I can make my runner report activity
  through a small optional interface, with the same standing as a built-in runner.
- **US-06.** As a person who changes nothing, my existing workflows behave exactly as before.

## 3. Acceptance criteria

**The per-step limit**

- [ ] AC-01. A step accepts an optional `timeout_seconds` (a whole number from 1 to 86400). It replaces the global
      limit for that step. The order is: the step's field, then `indaba run --timeout`, then 900.
- [ ] AC-02. `timeout_seconds` limits each call of a runner and each command of a shell step, as `--timeout` does today;
      it does not limit the step as a whole.
- [ ] AC-03. A step that times out ends as it does today: failed, with the reason `Timed out after N seconds.`, and its
      `on_failure` policy applies. Only the number `N` can differ.

**The no-activity limit and its retry**

- [ ] AC-04. A step accepts an optional `stall` block with `after_seconds` (a whole number from 30 to 3600, required) and
      `retries` (a whole number from 0 to 3, default 0).
- [ ] AC-05. While an attempt runs, the runner reports activity. When `after_seconds` pass without any, the runner
      stops the attempt and returns a result marked `stalled`. What counts as activity is each runner's, stated in its
      documentation; a runner that cannot report it does not offer the capability (AC-12).
- [ ] AC-06. A stalled attempt is a failed attempt with the reason `Stalled: no activity for N seconds.` It is never
      reported as a timeout, and never as a success.
- [ ] AC-07. With `retries` left, the engine discards what the stalled attempt changed in the step's worktree (back to
      the commit it had when the attempt began) and runs the same step again, up to `retries` times. The next prompt
      carries the failure of the previous attempt only: `Your previous attempt stalled: no activity for N seconds. Nothing
      it did was kept.`
- [ ] AC-08. With no `retries` left, the stalled step ends failed and its `on_failure` policy applies as it would for any
      failure. A stall retry is not a retry in the sense of `on_failure: retry_step` and consumes none of its budget, and
      `on_failure` consumes none of the stall retries.
- [ ] AC-09. The stall retries of a step are counted for each execution of the step. When an `on_failure: retry_step`
      resets the step to pending, its stall retries are available again. The total number of attempts of a step in a run
      is therefore bounded by `(1 + stall.retries) * (1 + the retries of the steps that can reset it)`.
- [ ] AC-10. A stall also ends an attempt on `timeout_seconds` if that elapses first, with the timeout's reason (AC-03).
      The two limits are independent and both may be set.

**Validation**

- [ ] AC-11. `stall` on a shell step, on a step that runs no agent, or on a debate step (`consensus_with` or
      `decision_type`) is an error from `validate`, `plan` and the start of a run, naming the step.
- [ ] AC-12. `stall` on a step whose runner chain holds a runner that does not offer the capability is an error that
      names the runner and the step, as an unsupported permission level is today.
- [ ] AC-13. `stall.retries` above 0 on a step without `isolation: git_worktree` is an error: there is nothing to
      restore. `stall` with `retries: 0` needs no isolation.
- [ ] AC-14. `timeout_seconds` is accepted on every kind of step. On a debate step it limits each call of each
      participant.

**The built-in runners**

- [ ] AC-15. The `claude-code` runner offers the capability. In a step that sets `stall` it asks `claude` for its
      streaming output and treats each event it receives, including the ones sent while the model is thinking, as
      activity. In a step that does not set `stall`, its command line and its result are exactly what they are today.
- [ ] AC-16. The result a step produces with the streaming output is the same text, in the same `RunResult` fields, as the
      plain output would have given, so a step's board lines, outputs and guards do not depend on whether `stall` is set.
- [ ] AC-17. Each other built-in runner either offers the capability, with its activity signal named in `plan.md` and
      its documentation, or is listed there with the reason it does not. None is left unmentioned.

**Visibility**

- [ ] AC-18. A stall is visible without reading code: the step's span carries the attributes and the event in
      [`events.md`](events.md), the step's status reason names the stall and the retry it triggers, and `indaba watch`,
      `indaba ui` and `indaba report` show the reason as they show any other.
- [ ] AC-19. No secret, prompt or agent output is in the stall's attributes or event.

**Compatibility**

- [ ] AC-20. A workflow with no `timeout_seconds` and no `stall` parses, plans, validates and runs exactly as before: the
      same command lines, results, events and attributes. A test pins it.
- [ ] AC-21. A runner plugin that does not implement the capability keeps working; it is refused only in a step that
      sets `stall`.

## 4. Non-goals

- **A default stall limit.** Both fields are opt-in. A limit that is on by default would end runs that work today (a
  long think writes nothing) and would be a major change. The cookbooks and `examples/` may set the fields once this
  ships; Indaba does not.
- **Deciding what a correct duration is.** The number is the author's. Indaba measures silence, not progress.
- **Detecting a stuck loop that prints.** An agent that streams output and goes nowhere is not a stall. That is a budget
  question (`specs/step-budgets`).
- **Changing what happens when a retry target fails.** Today a step with no `on_failure` of its own ends the run `failed`,
  even when it was re-run for another step's `retry_step`. That is a separate decision with its own semver weight (a run
  that fails today would continue), and is not changed here. Section 8 (C-08) records it as a follow-up.
- **Stall retries for steps without a worktree, and for debates.** A retry needs something to restore, and a debate has
  several participants and rounds, each with a transcript that is not an attempt to discard.
- **Restarting the agent's session or resuming its conversation.** A retry is a fresh call.
- **Killing a hung process of a shell step.** A shell command is limited by `timeout_seconds` and nothing else.
- **A lower limit for the whole run.** Only steps are limited.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| an attempt shows no activity for `after_seconds`, retries left | the runner stops the process group; the engine restores the worktree to the commit the attempt began from; the step runs again with the stall as its only feedback; the status reason reads `Stalled: no activity for N seconds (retry k of n).` |
| the same, no retries left | the step fails with `Stalled: no activity for N seconds.`; its `on_failure` policy applies |
| `timeout_seconds` elapses first | exactly today's timeout (AC-03); not a stall, no stall retry |
| the runner reports activity at intervals just under `after_seconds` | never a stall; only `timeout_seconds` or the global limit applies |
| the restore of the worktree fails | the step fails with the reason `The worktree could not be restored after a stall.`; no further attempt is made, and the run ends as for any failed step |
| the run is cancelled while an attempt runs or while the worktree is restored | the attempt is stopped as it is today; the restore completes or is abandoned with the worktree, which is removed at teardown; the step ends cancelled |
| the runner returns `stalled` without the step having set `stall` | treated as a failed attempt with its reason; no retry (the runner is at fault, not the workflow) |
| the stalled process ignores the stop signal | the same escalation as a timeout today (the process group is killed); nothing new |
| `stall` and `on_failure: retry_step` both apply to a failing step | the stall retries run first, within the attempt; only when they are used up does the step fail and `on_failure` apply (AC-08) |

## 6. Security and data handling

- **Untrusted data.** The only new input is the workflow's numbers, validated as whole numbers within the bounds above
  before anything runs. The reason strings contain numbers and fixed text, never agent output, a prompt or a path.
- **The restore runs git on the engine's own worktree.** It uses the `Git` wrapper with an argument array, never a
  shell string, and confines every path to the worktree root (`specs/git-workspace`; the `workspace-git` skill). It
  restores tracked files to the commit the attempt began from and removes untracked files the attempt created; it does
  not remove ignored files (`node_modules`, `reports/`, a build cache), which are not the agent's to lose and not the
  guard's to judge. It never touches the person's project directory.
- **The streaming output of `claude` carries the model's messages.** The runner reads it as data: it parses each line as
  JSON inside a bounded buffer, extracts the final text, and treats any line that does not parse as activity and as
  text, never as a command. Messages are not copied into spans, events or logs (AC-19).
- **Secrets.** Unchanged: none in a trace, event, exception or artifact.
- **Bounded.** Every number is bounded (AC-01, AC-04), so no value turns the limit into "never" or into a busy loop.

## 7. Where it lives

| Part | Package | Pure or infrastructure |
| :--- | :--- | :--- |
| `StallPolicy`, `Step.stall`, `Step.timeoutSeconds`, `StallCapable`, `RunRequest.stallSeconds`, `RunResult.stalled` | `@indaba/core` | pure domain |
| parsing and validating `timeout_seconds` and `stall`; refusing the combinations in AC-11 to AC-13 | `@indaba/engine` (parser, validator) | infrastructure |
| the attempt loop, the restore, the feedback, the status reasons, the span attributes and event | `@indaba/engine` (`StepExecutor`, `WorkflowEngine`) | infrastructure |
| detection of silence and the stop of the process group; the streaming mode of `claude` | `@indaba/runners` (`claude-runner.ts`, the shared process code) | infrastructure |
| documentation, the schema | `docs/workflow-format.md`, `indaba schema` | |

A runner plugin implements `StallCapable` in the same way a built-in does (the no-privileged-access rule): the engine
asks the interface, never the class.

## 8. Clarifications

Every item is a decision this specification **recommends**; the maintainer confirms or changes it before stage 4.

- **C-01. The names.** `timeout_seconds` on the step and `stall: { after_seconds, retries }`. `timeout_seconds` is
  already refused inside `permissions` (it belonged to asking a person); on the step it means something else and is
  accepted. The permissions error message is not changed.
- **C-02. Opt-in.** No default for either field (see Non-goals). This keeps the change a minor.
- **C-03. Precedence.** Step field, then `indaba run --timeout`, then 900. A step's own number is the more specific one,
  and the author wrote it for that step.
- **C-04. Who detects silence.** The runner, not the engine. The runner knows what its signals are (output chunks, a
  protocol update, a stream event); the engine only passes `stallSeconds` and reads `stalled`. This keeps one detector
  per kind of runner and leaves the engine free of any knowledge of `claude`.
- **C-05. The bounds.** `after_seconds` 30 to 3600: below 30 seconds a normal model call is mistaken for a stall.
  `retries` 0 to 3: more than three attempts of a call that hangs is a configuration problem. `timeout_seconds` 1 to
  86400.
- **C-06. What is restored.** Tracked files back to the commit the attempt began from, untracked files created by the
  attempt removed, ignored files kept (section 6). The commit is the worktree's `HEAD` when the attempt began; the engine
  records it. Checkpoint steps (the cookbooks' `checkpoint_*`) are what make that commit recent.
- **C-07. Debates.** `stall` is refused on a debate step in this version; `timeout_seconds` is accepted. A later
  specification may add it with a rule for what a discarded round is.
- **C-08. The retry target that fails.** Not changed here. A follow-up decision: whether the failure of a step that was
  re-run for `retry_step` should count against the retrying step's budget instead of ending the run. It is a behaviour
  change for existing workflows and is classified separately.
- **C-09. The streaming mode of `claude`.** The runner adds the streaming output format to its command line only in a
  step that sets `stall`, and nowhere else (AC-15). Other steps keep the plain output, so this specification changes no
  existing step. If a later `claude` release changes the format, the runner treats a line it cannot parse as activity
  and as text.
- **C-10. Reason texts.** `Stalled: no activity for N seconds.` and `Timed out after N seconds.` are fixed strings; the
  first is new, the second is today's.
- **C-12. The exit code of a stalled attempt.** A new code, `STALL_EXIT_CODE = 125`, beside `TIMEOUT_EXIT_CODE` (124) and
  `ABORT_EXIT_CODE` (130), so that a consumer that reads only the code can tell the three apart. No existing code changes.
- **C-11. The counters.** Stall retries reset when the step is reset to pending (AC-09); they are not stored between
  runs.

## 9. Open questions for the maintainer

- Whether `retries` should default to 1 when `stall` is set, so that the common case is one line (`stall: { after_seconds: 300 }`).
  This specification says 0, so that setting `stall` never retries by surprise.
- Whether `claude`'s thinking events should count as activity. They do here, because a long think is not a stall; if they
  were excluded, a step that thinks for longer than `after_seconds` would be stopped.

## 10. How it meets other specifications

- **`specs/step-budgets`.** A stalled attempt may have spent tokens. They are counted like those of any attempt, and the
  attempt is marked stalled; a budget ceiling still applies across attempts. Neither specification changes the other.
- **`specs/agent-permissions`.** `stall` follows the same pattern as permission levels: the workflow asks, the runner
  declares what it can hold, and `validate` refuses a mismatch before anything runs.
- **`specs/parallel-steps`.** The silence of one step does not depend on the others. When steps overlap, each has its own
  timer.

## Artifacts not written

- `plan.md`: stage 3's module-level plan follows once the clarifications are confirmed; this change specifies and
  fixes the contract.
- `tasks.md`: stage 4, after `plan.md`.
- `data-model.md`: the only shapes are `StallPolicy` and the optional members in [`api-surface.md`](api-surface.md); a
  separate file would repeat them.
