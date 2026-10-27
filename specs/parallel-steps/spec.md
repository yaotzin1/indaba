# Specification: Parallel steps (independent steps of a run work at the same time, and talk before they collide)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 2 (the maintainer confirmed C-01 to C-11 on 2026-10-27 and asked for the coordination, the review before
> landing and the conflict conversation; all decisions are confirmed)
> **Semver impact**: minor (optional workflow fields, a new engine option, a new section of `indaba.config`, a new CLI
> option, new board kinds, one new span attribute; the default keeps today's behaviour; below 1.0). Provisional;
> confirmed in `api-surface.md` at stage 3.
> **Builds on**: [`specs/workflow-engine`](../workflow-engine/spec.md) (the DAG, step state, retries; this spec replaces
> its non-goal "steps run one at a time"), [`specs/git-workspace`](../git-workspace/spec.md) (worktrees and patches),
> [`specs/run-blackboard`](../run-blackboard/spec.md) (the board the parallel steps coordinate on; **implemented before
> this spec**), [`specs/agent-mesh`](../agent-mesh/spec.md) and [`specs/debate-arbiter`](../debate-arbiter/spec.md)
> (the negotiation and the conflict conversation are debates), [`specs/logging`](../logging/spec.md) (`indaba.config`),
> [`specs/observability`](../observability/spec.md) and [`specs/tui`](../tui/spec.md) (traces, events, the dashboard).
> **Meets**: [`specs/step-verdicts`](../step-verdicts/spec.md) and [`specs/review-gate`](../review-gate/spec.md) (a step's
> review runs before it lands), [`specs/workspace-without-git`](../workspace-without-git/spec.md) (`isolation: copy`
> counts as isolated), [`specs/agent-conversation`](../agent-conversation/spec.md) (several live steps),
> [`specs/step-budgets`](../step-budgets/spec.md) (spend of steps that overlap), `specs/step-variants` (private
> specification; uses the pool and the worktree handling this spec provides). Section 10 says where each one meets this.

---

## 1. The problem

Indaba is built for several agents that work on one project, share what they learn and examine each other's work. The
engine does not let them work at the same time. `WorkflowEngine.run` walks the topological order and runs one step,
waits for it, then runs the next. Two steps that do not depend on each other (one agent building feature A, another
building feature B, a third writing the documentation) still run one after another, so a run with three agents takes as
long as three runs with one. The DAG already says which steps are independent; the engine ignores it.

The workspace model has the same shape. A run has at most one worktree, shared by every isolated step and every step
that depends on one, so two isolated steps could not work at the same time even if the engine started them.

Starting them together is not enough on its own. Two agents that each own a feature but never speak will edit the same
files, invent two versions of the interface between their parts, and find out only when their changes are combined.
The point of Indaba is that they speak first: say what they intend to change, agree a contract where their parts meet,
and settle a collision by talking rather than by one of them losing its work.

Consequences today:

1. **Multi-agent work costs the same wall-clock time as single-agent work.**
2. **The mesh has nothing to coordinate.** Debates and the board describe agents that exchange findings and agree on
   things; when only one is working at any moment, there is no "meanwhile".
3. **Authors serialise by hand what is not serial**, and nothing would stop parallel agents colliding if they were not.

## 2. User stories

- **US-01.** As a workflow author, I want steps whose dependencies are all complete to start together, up to a limit,
  so a run with several agents is about as long as its longest chain of dependent steps.
- **US-02.** As a person running Indaba, I want the limit to be a setting: off (one at a time) by default, set for my
  project in `indaba.config`, changed for one run with `--parallel`, and lowered by a workflow that needs it.
- **US-03.** As a workflow author, I want each step that edits files in isolation to work in a worktree of its own, so
  agents working at the same time do not see each other's half-done edits.
- **US-04.** As a workflow author, I want agents that start together to say first what they intend to change and what
  they provide to or need from each other, and to agree a contract when their intentions meet, before any of them edits
  a file.
- **US-05.** As a workflow author, I want a step that would collide with a step already working to wait for it rather
  than collide.
- **US-06.** As a workflow author, I want a step's review (when it has one) to happen on its own changes before they are
  combined with anyone else's.
- **US-07.** As a workflow author, I want a collision that still happens to be settled by the agents involved, in a short
  recorded conversation, and to come to me (or the arbiter I chose) only when they cannot agree.
- **US-08.** As a workflow author, I want a step that depends on several parallel steps to see all of their changes
  together.
- **US-09.** As a person watching a run, I want the dashboard, `watch --plain` and the web view to show every running
  step, the intentions, the agreed contracts and any conflict conversation.
- **US-10.** As a person who cancels a run, I want every running step stopped and every worktree the run created
  removed.
- **US-11.** As a workflow author, I want `indaba plan` to show which steps may run together.

## 3. The life of a step in a parallel run

This is the order every step goes through. Sections 4 to 6 give the acceptance criteria for each stage.

| # | Stage | What happens | Who acts |
| :--- | :--- | :--- | :--- |
| 1 | **Ready** | Every step it depends on is `COMPLETED`. | engine |
| 2 | **Admitted** | A slot is free under the limit, and it is the first ready step in topological order. A step that runs in the project directory is admitted only when nothing runs, and blocks everything while it runs. | engine |
| 3 | **Intent** | An agent step running in a worktree is asked, in a short call, what it will change (paths), what it provides to other steps and what it needs from them. The answer is posted to the board as an `intent`. A shell step's intent is the paths its author declared, or none. | the step's agent |
| 4 | **Check** | The engine compares the intent with the intents of the steps admitted with it and of the steps still running. | engine |
| 5 | **Wait** | If the intent meets a step that is already working (stage 7 or later), this step goes back to waiting until that step has landed, and starts again at stage 2 from the combined state. | engine |
| 6 | **Negotiate** | If the intent meets steps admitted with it, their agents hold a debate over their intents and post the agreed split and interface as a `contract`. No agreement in the round limit goes to the arbiter. | the agents, then the arbiter |
| 7 | **Fork and work** | The step gets a worktree forked from the run worktree, with the agreed contract and the board digest in its prompt, and does its work. | the step's agent |
| 8 | **Guards** | Its guards run in its own worktree, as today. | engine |
| 9 | **Review** | If the step has a review (`step-verdicts`, `review-gate`), it runs on the step's own changes, before anything is combined. | reviewers |
| 10 | **Land** | Its changes are applied to the run worktree with a three-way apply, one landing at a time, in the order steps finish. | engine |
| 11 | **Resolve** | If the landing conflicts, the step's agent proposes a resolution in a fresh fork, the agent of the step whose change it met examines it, and they agree or go to the arbiter. | the two agents, then the arbiter |
| 12 | **Done** | The step is `COMPLETED`; its worktree is removed. | engine |

Steps that do not meet anyone skip 5, 6 and 11. With the limit at 1, stages 3 to 6 and 11 never happen and the run is
exactly today's.

## 4. Acceptance criteria: the limit and scheduling

- [ ] AC-01. The number of steps that may run at once (the *limit*) is decided, strongest first, by: `--parallel <n>`
  on `indaba run` and `indaba ui`; the variable `INDABA_PARALLEL`; `parallel.max_steps` in `indaba.config`; the default
  1 (C-01). Each is an integer of at least 1; anything else is a usage error (flag), a warning and the next source
  (variable), or a configuration error naming the key (file), as `logging` does for the level.
- [ ] AC-02. The engine takes the resolved value as the option `maxParallelSteps` (default 1).
- [ ] AC-03. A workflow may declare `max_parallel` at the top level. The limit of its run is the smaller of `max_parallel`
  and the resolved value: a workflow lowers it, never raises it (C-02). `max_waits` (AC-13) follows the same rule. A
  non-integer or a number below 1 in either fails validation naming the field.
- [ ] AC-04. The Settings screens of the terminal dashboard and of the web view show the resolved limit and where it came
  from, and the web view's Settings can write `parallel.max_steps` to `indaba.config`.
- [ ] AC-04a. Parallel work is the person's choice, made knowing what it costs. Wherever the limit is set above 1 (the
  Settings screens, the run panel of the web view) and at the start of every run whose limit is above 1 (`indaba run`,
  `watch --plain`, the dashboard), Indaba states the consequences in a few lines: each agent step makes an extra intent
  call, steps whose intentions meet hold a negotiation and may resolve conflicts (more calls and spend), each running
  step uses a worktree of its own on disk, and a negotiation or conflict nobody can settle comes to the decider. The
  text is the same everywhere and is part of the documentation.
- [ ] AC-05. With a limit of 1 every run behaves exactly as today: same order, same workspace handling, same events,
  same trace file byte for byte apart from the root attribute of AC-31 (a test pins it).
- [ ] AC-06. Ready steps are admitted in their topological position order (the order `DagBuilder` returns today), so
  which ready step starts first is deterministic.
- [ ] AC-07. A step that runs in the project directory (no isolation, and no isolated dependency, as decided today) is
  admitted only when no step is running, and no step is admitted while it runs (C-03).
- [ ] AC-08. A debate step (`consensus_with`) is one step for scheduling and counts once against the limit.

## 5. Acceptance criteria: coordination before work

- [ ] AC-09. When the limit is above 1, an agent step that will run in a worktree makes an *intent call* before its work:
  one call to its runner with the step's goal, the board digest and a fixed instruction to answer only with lines of
  three forms: `INTENT <path or glob>`, `PROVIDES <name>: <one line>`, `NEEDS <name>`. Lines of any other form are
  ignored and counted. The intent call is metered and traced as a child span of the step.
- [ ] AC-10. A shell step declares its intent in the file with `touches:` (a list of paths or globs). A shell step
  without `touches` intends nothing; a step that intends nothing still lands under AC-22 and its conflicts are handled by
  AC-24.
- [ ] AC-11. The intent is posted to the board as an entry of kind `intent`, by the step, with the paths, provides and
  needs as structured fields (cleaned and redacted as every board entry). Paths are normalised, confined to the project,
  and a path outside it is dropped with a warning.
- [ ] AC-12. Two intents *meet* when a path of one matches a path of the other (glob against glob is decided by the
  literal prefix before the first wildcard, C-07), or when one `NEEDS` a name the other `PROVIDES`.
- [ ] AC-13. A step whose intent meets a step that has passed stage 6 (it is forking, working, being checked, reviewed
  or landed but not yet `COMPLETED`) is put back to waiting. It is admitted again when that step is `COMPLETED`, and
  repeats its intent call then (it now sees the combined state and the board). Waiting frees its slot. A step put back
  `parallel.max_waits` times in a row (default 3) is admitted alone, with nothing else admitted beside it, so it cannot
  starve (C-08). `max_waits` is set in `indaba.config` and lowered, never raised, by a workflow's `max_waits`.
- [ ] AC-14. Steps admitted together whose intents meet form a *negotiation*: a debate under `specs/agent-mesh`, with
  each step's role as a participant, the intents as the topic, and the same round limit and stall detection as any
  debate. Each participant answers with its proposal of the split (which paths each step changes) and of each shared
  interface (its name and its shape in a few lines).
- [ ] AC-15. A negotiation that reaches consensus posts one `contract` entry to the board, accepted, naming the steps,
  the agreed paths of each, and the agreed interfaces. The work prompt of each of those steps carries the contract as a
  section of its own.
- [ ] AC-16. A negotiation that does not reach consensus goes to the arbiter as a failed debate does: the `arbiter` of
  the first of those steps in topological order, else the workflow's default, else the person (`debate-arbiter`). An
  accept ruling posts the contract the ruling names. A reject, or no ruling, asks the run's decider (the person, or the
  agent the person promoted, `specs/agent-conversation`) what to do, with three answers: run those steps one after
  another, run them in an order it names, or stop the run. Until `agent-conversation` is implemented, and when nobody
  answers, those steps run one after another in topological order. The choice and who made it are recorded (C-09).
- [ ] AC-17. A step's work may still go beyond its intent; nothing here blocks it. A `diff_within_scope` guard can be
  added by the author if the intent must hold (C-10).

## 6. Acceptance criteria: workspaces, review, landing and conflicts

- [ ] AC-18. The run keeps one *run worktree*, created when the first step needs one, as today. Each step that uses a
  worktree gets one of its own, forked from the run worktree's state when its work starts (stage 7).
- [ ] AC-19. Input artifacts are staged into each step's own worktree as they are staged into the run worktree today.
- [ ] AC-20. Guards run in the step's own worktree (stage 8).
- [ ] AC-21. A step with a review (`step-verdicts` `review`, or a `review-gate` gate) has it after its guards and before
  it lands; the reviewers see the step's own diff, not the combined state. A step sent back by its review runs again in
  its own worktree and does not land. Landing happens only when the step is about to become `COMPLETED`.
- [ ] AC-22. Landing applies the step's diff since its fork to the run worktree with a three-way apply. Steps land one at
  a time, in the order they finish (C-04). The `patch` artifact is written after each landing.
- [ ] AC-23. A landing that conflicts changes nothing in the run worktree.
- [ ] AC-24. A conflicting landing starts a *resolution* (stage 11) instead of failing the step:
  1. The engine forks a fresh worktree from the run worktree.
  2. The step's agent is called there with its own diff, the conflicting files and hunks, and the intent, contract and
     notes of the step whose landed change it met. It makes the combined change.
  3. The guards run on it.
  4. The agent of the step it met examines it in a debate of the two roles, with the same round limit. With consensus,
     it lands. Without, it goes to the arbiter as in AC-16. An accept lands it; a reject fails the step.
  If the step it met is a shell step (no agent), there is no debate: passing the guards is enough.
- [ ] AC-25. One resolution is tried per landing. A resolution that fails its guards, conflicts again, or is rejected
  fails the step with feedback naming the conflicting files, and the step's `on_failure` applies; a retry forks from the
  combined state. A resolution does not count against `max_retries`.
- [ ] AC-26. A step's own worktree, and a resolution's, is removed after it lands or fails, whatever happens. At most
  `limit` step worktrees exist at once, plus one for a resolution, plus the run worktree.

## 7. Acceptance criteria: failure, cancellation, visibility

- [ ] AC-27. When a step fails and its policy does not retry, no new step is admitted. Steps already running finish,
  each to its own end state, including their review and landing; the run then ends `FAILED` or `ESCALATED` as today,
  with the reason of the first step that ended it (C-05).
- [ ] AC-28. A retry resets the target and its descendants to `PENDING`, as today. A descendant that is running at that
  moment is aborted, moves `RUNNING` to `FAILED` to `PENDING` (transitions `StepState` already allows), and the abort does
  not count against `max_retries`. Running steps that are not descendants are not touched.
- [ ] AC-29. Cancelling the run aborts every running step, negotiation and resolution through its signal. Nothing is
  admitted after the cancel. The run ends `CANCELLED` once everything has settled; teardown then removes every worktree
  and is itself never cancelled, as today.
- [ ] AC-30. The event stream carries the same events as today for each step; events of different steps interleave. The
  order within one step is guaranteed; across steps it is not, and no consumer may rely on it. The dashboard, `watch
  --plain` and the web view show every running step, and show a step that waits under AC-13 as waiting, with the step it
  waits for.
- [ ] AC-31. The root span carries `indaba.workflow.max_parallel` (the effective limit) and
  `indaba.workflow.max_parallel.source` (`flag`, `env`, `config`, `workflow` or `default`). The intent call, the
  negotiation, the landing and the resolution are child spans of the step.
- [ ] AC-32. `indaba plan` prints, for the effective limit, the groups of steps that may be admitted together if every
  step took the same time, and marks steps that run alone under AC-07. Intents are not known before a run, so the plan
  says that a group may be narrowed by AC-13 and AC-16.
- [ ] AC-33. Admission, an intent posted, a step put back to wait, a negotiation's outcome, a landing, a conflicting
  landing, a resolution's outcome and an abort for a retry each write one structured log record with the step and task
  ids and nothing from the agent's output.

## 8. Non-goals

- **Several attempts at the same step.** This spec runs *different* steps at the same time. Running one step several
  ways and choosing between the results is not part of this repository.
- **Dependencies between workflows.** Parallelism is inside one run of one workflow. Not part of this repository.
- **Coordination between Indaba instances or projects.** One run, one project. Not part of this repository.
- **Changing the person's checkout.** Landing and resolution change the run worktree, which Indaba owns and removes. The
  run's result still leaves as a patch.
- **Talking to a step in the middle of its work.** Agents coordinate before work (intents, contracts) and after it
  (resolution). A sibling that is working is waited for, not interrupted. Live exchange during work belongs to
  `agent-conversation`.
- **Read-only project-directory steps running together** (C-03).
- **A scheduler.** Nothing here starts runs, queues them or runs several runs at once.

## 9. Behaviour on failure

Why a step fails at all, in a parallel run as in a sequential one: its runner exits with an error or times out, its
outputs are missing, a guard fails (tests red, a change outside its scope), its review sends it back or stops it, or
(new here) its resolution is rejected.

| Situation | Expected behaviour |
| :--- | :--- |
| the intent call fails or times out | the step fails as any call does; `on_failure` applies |
| the intent call returns no usable line | the step intends nothing (AC-10) and proceeds |
| a negotiation fails | AC-16 |
| a step's runner exits non-zero or times out | the step fails as today; AC-27 or AC-28 decides the rest |
| a guard fails | as above; the step does not land; its worktree is removed |
| the review sends it back | it runs again in its own worktree (AC-21) |
| a landing conflicts | AC-24, then AC-25 |
| a worktree cannot be created | the step fails with the reason |
| a worktree cannot be removed | the run continues; it ends `FAILED` with "The workspace could not be removed." after everything settles, as today |
| the run is cancelled | AC-29 |
| the engine or a runner throws | the run ends as today; running steps are aborted as on a cancel first |
| the process dies midway | as today for the run worktree: worktrees under `.indaba/worktrees/` remain; a landing is one apply, so nothing is half-landed |

## 10. Security and data handling

- Intent lines are agent output: parsed with a fixed pattern on a bounded prefix, cleaned and redacted, and never used to
  build a command. Paths in them are confined to the project before they are stored or compared.
- The paths a conflict names come from git's output for the run worktree, are made relative, checked to stay inside the
  project, and cleaned before they reach a prompt, feedback, events or logs.
- What one agent receives from another (intents, contracts, notes, a diff during resolution) is fenced as untrusted
  content in its prompt, as the board digest already is.
- Worktree names are built from the validated task and step ids. Landing uses the `Git` wrapper with argument arrays.
- More agents at once means more concurrent spend and credentials in use. Each step's runner, permissions and the `full`
  acknowledgement are checked before the run starts, as today.

## 11. Where it lives

- `@indaba/core`: `maxParallel` and `touches` on the model; the pure scheduling decision (admission, meeting intents,
  putting back, the anti-starvation rule); the intent line parser; the `intent` and `contract` board kinds.
- `@indaba/engine`: parsing and validating the new fields; the `parallel` section of `indaba.config`; the run loop (a
  bounded pool, one abort controller per step under the run's signal); the intent call, the negotiation and the
  resolution through the existing debate path; forking, landing and resolution worktrees; `indaba plan`'s grouping.
- `indaba` (CLI): `--parallel`, `INDABA_PARALLEL`, resolving the limit, the plan output.
- `@indaba/tui`, `@indaba/server`, `@indaba/web`: several running steps, waiting steps, intents and contracts, the
  Settings value (AC-04, AC-30).

## 12. Clarifications

Confirmed by the maintainer on 2026-10-27:

- **C-01. One step at a time by default, configurable.** The default is 1, so nothing changes on upgrade. The limit is
  set in `indaba.config`, by `INDABA_PARALLEL` or by `--parallel` (AC-01), in the same order of strength as the logging
  level.
- **C-02. A workflow can lower the limit, not raise it.** The limit has no built-in maximum: what a machine can take
  (disk per worktree, processes, provider rate limits, spend) is not measured here, and the person running Indaba
  chooses it.
- **C-03. Project-directory steps run alone. Steps in worktrees may run together, and talk first** (stages 3 to 6).
- **C-04. Land in the order steps finish. Collisions are settled by the agents** (stage 11), with the arbiter as the last
  word.
- **C-05. Running steps finish after another step fails, and a step's review happens before it lands** (AC-21, AC-27).
- **C-06. One run worktree, step worktrees forked from it**, with the stages of section 3.
- **C-07. Glob meets glob by literal prefix.** Comparing the fixed part before the first wildcard is cheap,
  deterministic and errs towards "they meet", which only costs a negotiation.
- **C-08. Put back at most `max_waits` times (default 3, configurable), then admitted alone.** Without a bound, a step
  that meets a long chain of others could wait for the rest of the run. The default is a design choice, not a
  measurement.
- **C-09. A failed negotiation with no ruling goes to the decider** (the person or a promoted agent), who chooses to run
  the steps one after another, in a given order, or to stop. Without an answer they run one after another.
- **C-10. Intents are declarations, not fences.** An agent CLI's edits cannot be confined before they happen; landing
  and resolution catch what the intent missed, and `diff_within_scope` remains available to fence a step.
- **C-11. Agents in parallel steps always talk; with a limit of 1 nobody does.** The person decides whether to work in
  parallel and is told the consequences (AC-04a). When they do, coordination is not optional. The intent call happens only when the limit is above 1.** With 1 there is no one to meet, and the call would
  cost a request per step for nothing.

## 13. Where other specifications meet this one

- **`run-blackboard`.** Required. This spec adds two board kinds, `intent` and `contract`, written by the engine (an
  agent cannot post them through a `BOARD` line). That spec's closed list of kinds gains them when this is implemented.
- **`step-verdicts` and `review-gate`.** A review runs before landing (AC-21). Nothing in their contracts changes; their
  specs are told that "the step's changes" means its own worktree under this spec.
- **`workspace-without-git`.** `isolation: copy` counts as isolated. Its landing is a copy-back with the same conflict
  rule: a file changed both in the run copy since the fork and by the step is a conflict.
- **`agent-conversation`.** With several live steps the person may address any of them; that spec is to name the step a
  message is for.
- **`step-budgets`.** Overlapping steps, intent calls, negotiations and resolutions draw on one run budget; the check
  before a call must hold under concurrency.
- **`step-variants`** (private specification). It needs a bounded pool and worktrees forked from a base; this spec's
  pool and fork are written as reusable engine pieces.

## Artifacts not written

- `plan.md`: stage 3, next.
- `tasks.md`: stage 4, after the plan.
- `data-model.md`: the `intent` and `contract` entries are board records and are added to `specs/run-blackboard`'s data
  model when this is planned; this spec adds no file of its own.
- `events.md`: no new event class; AC-30 and AC-31 say what changes in the stream and the trace.
- `research.md`: no external research; the behaviour follows from the engine as it is.
