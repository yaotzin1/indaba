# Specification: Parallel steps (independent steps of a run work at the same time)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommendations the maintainer confirms)
> **Semver impact**: minor (a new optional workflow field, a new engine option, a new CLI option, one new span attribute;
> the default keeps today's behaviour; below 1.0). Provisional; confirmed in `api-surface.md` at stage 3.
> **Builds on**: [`specs/workflow-engine`](../workflow-engine/spec.md) (the DAG, step state, retries; this spec replaces
> its non-goal "steps run one at a time"), [`specs/git-workspace`](../git-workspace/spec.md) (worktrees and patches),
> [`specs/agent-mesh`](../agent-mesh/spec.md) and [`specs/debate-arbiter`](../debate-arbiter/spec.md) (debate steps run
> unchanged inside a parallel run), [`specs/observability`](../observability/spec.md) and [`specs/tui`](../tui/spec.md)
> (traces, the event stream, the dashboard).
> **Meets**: [`specs/run-blackboard`](../run-blackboard/spec.md) (several steps post to one board at once),
> [`specs/workspace-without-git`](../workspace-without-git/spec.md) (`isolation: copy` counts as isolated here),
> [`specs/agent-conversation`](../agent-conversation/spec.md) (several live steps can be talked to),
> [`specs/step-budgets`](../step-budgets/spec.md) (spend of steps that overlap), `specs/step-variants` (private
> specification; uses the pool and the worktree handling this spec provides). Section 9 says where each one meets this.

---

## 1. The problem

Indaba is built for several agents that work on one project and examine each other's work. The engine does not let them
work at the same time. `WorkflowEngine.run` walks the topological order and runs one step, waits for it, then runs the
next. Two steps that do not depend on each other (one agent building feature A, another building feature B, a third
writing the documentation) still run one after another, so a run with three agents takes as long as three runs with
one. The DAG already says which steps are independent; the engine ignores it.

The workspace model has the same shape. A run has at most one worktree, shared by every isolated step and every step
that depends on one, so two isolated steps could not work at the same time even if the engine started them: each would
see the other's half-written files.

Three consequences:

1. **Multi-agent work costs the same wall-clock time as single-agent work.** The reason to split a change between
   agents (each owns a part, others review it) is lost on time, and only the review benefit remains.
2. **The mesh has nothing to coordinate.** Debates, the run board and the conversation specs describe agents that
   exchange findings and agree on things. In a run where only one of them is working at any moment, there is no
   "meanwhile": what agent B learns from agent A always arrives after A has finished.
3. **Authors serialise by hand what is not serial.** A workflow that lists `docs`, `api` and `ui` after `plan` is read
   by a person as "these three at once" and executed as "these three in some order".

## 2. User stories

- **US-01.** As a workflow author, I want steps whose dependencies are all complete to start together, up to a limit,
  so a run with several agents is about as long as its longest chain of dependent steps.
- **US-02.** As a workflow author, I want each step that edits files in isolation to work in a worktree of its own, so
  agents working at the same time do not see each other's half-done edits.
- **US-03.** As a workflow author, I want a step that depends on several parallel steps to see all of their changes
  together, so an integration or review step works on the combined result.
- **US-04.** As a workflow author, I want two parallel steps that changed the same lines to be reported as a failure of
  the later one, with the conflicting files named, so my `on_failure` policy (a retry that starts from the combined
  state) handles it like any other failure.
- **US-05.** As a person running Indaba, I want to set how many steps may run at once for this machine (`--parallel`),
  so an installation decides how much disk, how many processes and how much concurrent spend a run may use.
- **US-06.** As a person watching a run, I want the dashboard, `watch --plain` and the web view to show every step that
  is running, not only one.
- **US-07.** As a person who cancels a run, I want every running step stopped and every worktree the run created
  removed.
- **US-08.** As a developer embedding the engine, I want parallelism to be an engine option with a default that keeps
  today's behaviour, so upgrading changes nothing until I ask for it.
- **US-09.** As a workflow author, I want `indaba plan` to show which steps may run together, so I can see the shape of
  the run before I start it.

## 3. Acceptance criteria

**Turning it on**

- [ ] AC-01. The engine takes an option `maxParallelSteps`, an integer of at least 1 (default 1, C-01). With 1 every
  run behaves exactly as today: same order, same workspace handling, same events, same trace file byte for byte apart
  from the new root attribute of AC-20 (a test pins it).
- [ ] AC-02. A workflow may declare `max_parallel`, an integer of at least 1, at the top level. The number of steps
  running at once is the smaller of `max_parallel` and the engine's `maxParallelSteps`. A workflow cannot raise what
  the installation allows (C-02). A non-integer or a number below 1 fails validation naming the field.
- [ ] AC-03. `indaba run` and `indaba ui` take `--parallel <n>`, which sets `maxParallelSteps` for that run. A value
  that is not an integer of at least 1 is a usage error.

**Scheduling**

- [ ] AC-04. A step is *ready* when it is `PENDING` and every step it depends on is `COMPLETED`. Whenever fewer steps
  are running than the limit, the engine starts ready steps in their topological position order (the order `DagBuilder`
  returns today), so the choice of which ready step starts first is deterministic.
- [ ] AC-05. A step that runs in the project directory (no isolation, and no isolated dependency, as decided today)
  runs alone: it does not start while any step is running, and no step starts while it runs (C-03). Steps that run in a
  worktree, or in a copy under `specs/workspace-without-git`, may run together.
- [ ] AC-06. A run whose steps form a single chain behaves as today whatever the limit.
- [ ] AC-07. A debate step (`consensus_with`) is one step for scheduling: its rounds run inside it as today, and it
  counts once against the limit.

**Workspaces**

- [ ] AC-08. The run keeps one *run worktree*, created on the first step that needs one, as today. Every step that
  would use a worktree gets a worktree of its own, forked from the run worktree's state at the moment the step starts.
- [ ] AC-09. When such a step completes (guards passed), its diff against the state it was forked from is applied to
  the run worktree, with a three-way apply. Steps land one at a time, in the order they complete (C-04). The `patch`
  artifact is written after each landing, as today after each isolated step.
- [ ] AC-10. A landing that conflicts changes nothing in the run worktree. The step moves to `FAILED` with feedback that
  names each conflicting file (paths relative to the project, never absolute), and its `on_failure` policy applies. A
  retry forks again from the run worktree, so it starts from the combined state including the change it conflicted
  with.
- [ ] AC-11. A step's own worktree is removed after it lands or fails, whatever happens. At most `limit` step worktrees
  exist at once, plus the run worktree.
- [ ] AC-12. Input artifacts are staged into each step's own worktree as they are staged into the run worktree today.

**Failure, retry and cancellation**

- [ ] AC-13. When a step fails and its policy does not retry, no new step starts. Steps already running are allowed to
  finish, each to its own end state, and the run then ends `FAILED` or `ESCALATED` as today, with the reason of the
  first step that ended it (C-05).
- [ ] AC-14. A retry resets the target and its descendants to `PENDING`, as today. A descendant that is running at that
  moment is aborted, moves `RUNNING` to `FAILED` to `PENDING` (the transitions `StepState` already allows), and the
  abort does not count against anyone's `max_retries`. Running steps that are not descendants of the target are not
  touched.
- [ ] AC-15. Cancelling the run aborts every running step through its signal. No step starts after the cancel. The run
  ends `CANCELLED` once every running step has settled; teardown then removes every step worktree and the run worktree
  and is itself never cancelled, as today.
- [ ] AC-16. A step that throws (not a guard failure: an error in the engine or a runner) ends the run as today; the
  other running steps are aborted as on a cancel and their worktrees removed before the error is rethrown.

**Seeing it**

- [ ] AC-17. The event stream carries the same events as today for each step; events of different steps interleave.
  The order of events within one step is guaranteed; the order across steps is not, and no consumer may rely on it.
- [ ] AC-18. The terminal dashboard, `watch --plain` and the web view show every running step. Nothing in them assumes
  that at most one step is `RUNNING`.
- [ ] AC-19. `indaba plan` prints, for the effective limit, the groups of steps that may run together (each group is the
  set of steps ready at the same time if every step took the same time), and marks steps that will run alone under
  AC-05.
- [ ] AC-20. The root span carries `indaba.workflow.max_parallel` (the effective limit). Step spans keep their names and
  attributes and overlap in time.

**Logging**

- [ ] AC-21. Starting, landing, a conflicting landing and aborting a step for a retry each write one structured log
  record through the existing logging contract, with the step id and the task id and nothing from the agent's output.

## 4. Non-goals

- **Several attempts at the same step.** This spec runs *different* steps at the same time. Running one step several
  ways and choosing between the results is not part of this repository.
- **Dependencies between workflows.** Parallelism is inside one run of one workflow. A workflow that waits for another
  workflow is not part of this repository.
- **Coordination between Indaba instances or projects.** One run, one project. Not part of this repository.
- **Automatic merging into the project.** Landing applies a step's diff to the run worktree, which Indaba owns and
  removes. Nothing is applied to the person's checkout; the run's result still leaves as a patch.
- **Resolving conflicts.** A conflict is a step failure. Indaba does not choose between two edits of the same lines.
- **Live visibility of what a sibling is doing.** A step sees what other steps posted to the board when its call starts
  (`specs/run-blackboard`). Reading a sibling's posts during a call, and agents negotiating with each other while both
  work, is a later specification.
- **Read-only steps in the project directory running together.** AC-05 runs every project-directory step alone. A way
  to declare a step read-only so that it may run beside others is left out (C-03).
- **A scheduler.** Nothing here starts runs, queues them or runs several runs at once.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| a step's runner exits non-zero | the step fails as today; AC-13 or AC-14 decides what happens to the others |
| a step's timeout elapses | as above |
| a guard fails | as above; the step's worktree is not landed and is removed |
| a landing conflicts | AC-10: the run worktree is unchanged, the step fails naming the files, `on_failure` applies |
| a step worktree cannot be created | the step fails with the reason; nothing else changes |
| a step worktree cannot be removed | the run continues; the run ends `FAILED` with "The workspace could not be removed." as today for the run worktree, after the other steps settle |
| the run is cancelled | AC-15 |
| the engine or a runner throws | AC-16 |
| the process dies midway | as today for the run worktree: worktrees under `.indaba/worktrees/` remain; nothing is landed half-way, because a landing is one apply to the run worktree |

## 6. Security and data handling

- The paths a conflict names come from git's output for the run worktree. They are made relative to the project, checked
  to stay inside it, and cleaned of control characters before they reach feedback, events or logs.
- Step worktrees live under `.indaba/worktrees/` with names built from the task id and the step id, both validated as
  today. No path is built from agent output.
- Landing uses git with an argument array, through the existing `Git` wrapper; no shell.
- Several agents running at once multiplies concurrent spend and concurrent access to credentials. Neither changes in
  kind: each step's runner, permissions and permission acknowledgement are checked before the run starts, as today.
- Nothing from a step's output enters another step's prompt through this feature. What passes between parallel steps
  is their landed changes in the run worktree (as between sequential steps today) and the board.

## 7. Where it lives

- `@indaba/core`: the `maxParallel` field on `WorkflowDefinition`, and the pure scheduling decision (given the states,
  the DAG, the limit and which steps run in the project directory, which steps start next). No I/O.
- `@indaba/engine`: the parser and validator for `max_parallel`, the run loop in `WorkflowEngine` (a bounded pool, one
  abort controller per step under the run's signal), forking and landing step worktrees in the workspace module,
  `indaba plan`'s grouping helper.
- `indaba` (CLI): `--parallel`, passing it to the engine, the plan output.
- `@indaba/tui`, `@indaba/server`, `@indaba/web`: checked against AC-18; changed only where they assume one running
  step.

## 8. Clarifications

Recommendations; the maintainer confirms or changes each.

- **C-01. The default stays 1 for now.** With 1 nothing changes for anyone who upgrades, which keeps this a minor. The
  intended default is higher (the point of Indaba is several agents at once); raising it is a change of default and
  ships as a labelled change in a later release, once the dashboard and web view have shown parallel runs well.
  Alternative: ship with a higher default now and call it out in the changelog as the one breaking change.
- **C-02. The workflow can lower the limit, not raise it.** The machine's resources are the installation's decision
  (disk per worktree, processes, provider rate limits, spend). An author who knows two steps must not overlap can say
  `max_parallel: 1`; an author cannot ask for more than the person running it allows.
- **C-03. Project-directory steps run alone.** Two steps writing to the same directory at the same time cannot be made
  safe without isolation. A read-only declaration would let review steps run together, but it is a promise Indaba
  cannot check for agent CLIs, so it is left for a later specification that can enforce it (for example with
  `agent-permissions` at a read level).
- **C-04. Land in completion order.** Waiting to land in topological order would hold a finished step's change back
  from steps that start after it, for no gain: either order can conflict, and a conflict is handled the same way. The
  landing order is recorded (AC-21) so a run can be read afterwards.
- **C-05. Let running siblings finish after a failure.** Their work may be what the person needs to fix the failure,
  and stopping them half-way wastes what was already spent. Each has its own timeout, so the wait is bounded.
  Alternative: abort them at once, as on a cancel.
- **C-06. One run worktree, step worktrees forked from it.** Keeping the run worktree means a step that depends on
  several parallel steps (US-03) needs nothing new: it forks from the run worktree after they have all landed. The
  `patch` artifact keeps its meaning (the diff of the run worktree).

## 9. Where other specifications meet this one

- **`run-blackboard`.** The board already has one serialised writer that numbers entries (`seq`); posts from parallel
  steps go through it unchanged. The digest a step receives is built when its call starts, so a step sees what siblings
  posted before that moment. The board spec needs one sentence saying so; nothing in its contract changes.
- **`workspace-without-git`.** `isolation: copy` is isolated for AC-05 and AC-08. Its landing is a copy-back of the
  changed files instead of a git apply, with the same rule: a file changed both in the run copy since the fork and by
  the step is a conflict. That spec is to be revised to say how it detects the change since the fork.
- **`agent-conversation`.** Its `live/<taskId>.json` describes a run; with parallel steps the person may address any of
  the running steps. That spec is to be revised to name the step a message is for when more than one is live.
- **`step-budgets`.** A run budget is consumed by overlapping steps. That spec's check before a call must hold under
  concurrency: two steps must not both pass a check that only one of them fits. To be revised there.
- **`step-variants`** (private specification). It needs a bounded pool and worktrees forked from a base. This spec's
  pool and fork are written as engine pieces that can be reused, so that need is met here and not duplicated.

## Artifacts not written

- `plan.md`: stage 3; written once the decisions in section 8 are confirmed.
- `tasks.md`: stage 4, after the plan.
- `data-model.md`: no new file or record format; worktree names follow `specs/git-workspace`.
- `events.md`: no new event class; AC-17 and AC-20 say what changes in the existing stream and trace.
- `research.md`: no external research; the behaviour follows from the engine as it is.
