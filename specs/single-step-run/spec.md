# Specification: Running one step

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommendations the maintainer confirms)
> **Semver impact**: minor (new CLI option, new engine option, new event field; below 1.0)
> **Builds on**: [`specs/workflow-engine`](../workflow-engine/spec.md) (the DAG and the step state),
> [`specs/workspace-without-git`](../workspace-without-git/spec.md) (the working copy),
> [`specs/step-budgets`](../step-budgets/spec.md) (resume), [`specs/web-app`](../web-app/spec.md) (the button).
> **Decided by the maintainer**: a person can run one step, for example only the review step, from the page.

---

## 1. The problem

A run always starts at the first step. To run only the review of a project, a person has to run everything before it,
or write a second workflow that holds just the review. Neither is acceptable for a button labelled "run this step", and
the second fragments the very workflows the registry is meant to list.

A step is not self-contained. It reads the artifacts that earlier steps wrote, may run in the working copy an earlier
step changed, and may depend on a verdict or a ruling from before. Running it alone is only meaningful if Indaba can say
what it will be given in place of those.

## 2. User stories

- **US-01.** As a person, I run only the `review` step of a workflow on the project as it is now.
- **US-02.** As a person, I run `review` using the outputs of my last completed run, so it reviews what that run made.
- **US-03.** As a person, before it starts, I am told which inputs the step will get and where each comes from, and
  which are missing.
- **US-04.** As a person, a step that cannot run alone (a needed input exists nowhere) tells me so and which earlier step
  would produce it.
- **US-05.** As a workflow author, I know a single-step run uses the same guards, permissions, budget, sandbox and
  retries as a full run.
- **US-06.** As a person reading traces, I see that a run was a single step and which run its inputs came from.

## 3. Acceptance criteria

- [ ] AC-01. `indaba run <workflow> --step <id>` runs that step only. The engine option is
  `RunOptions.only: { step: string; from?: string }`. An unknown step id fails before anything starts, listing the ids.
- [ ] AC-02. Every other step is skipped, with the state `SKIPPED` (new, section 8 C-02). A step that depends on the
  chosen one is not run. The run's result is the chosen step's result.
- [ ] AC-03. The inputs of the step (`inputArtifacts`) are resolved, in this order: a value given with `--input`; the
  file in the working folder; the artifact from the run named by `from`; the artifact from the most recent run of this
  workflow that completed that producing step. Each input is reported with its source and, when from a run, that run's id.
- [ ] AC-04. `--from <runId>` (or `from` in the option) names the run that supplies artifacts. A run that does not exist,
  belongs to another workflow, or is still running is refused, naming the reason.
- [ ] AC-05. Before the step starts, a plan is produced and shown (`--plan` prints it and exits): the step, its inputs
  with sources, the workspace it will use, the sandbox, the budget, the guards, and what is missing. A missing required
  input fails the run with the id of the earlier step that produces it. Nothing is guessed or created to fill it.
- [ ] AC-06. The workspace follows `isolation`: a fresh working copy of the project as it is now (the default), or, with
  `--workspace-from <runId>`, a kept workspace from that run (`step-budgets` keeps one after a stop; `workspace-without-git`
  may keep one after a run). A workspace that no longer exists is an error, not a silent fresh copy.
- [ ] AC-07. A step that needs a verdict, a ruling or a board post from earlier in the run uses the ones recorded by
  `from`; without `from` it starts with none, and the plan says so. A decision ledger entry still applies by its key.
- [ ] AC-08. Guards, permissions, budget (`max_cost` and the currency), sandbox policy, retries, `on_failure` and the
  consensus rules apply exactly as in a full run. `on_failure: goto <step>` that leaves the chosen step is not followed:
  the run ends with the step's failure and says where it would have gone.
- [ ] AC-09. The trace root span records `indaba.run.mode: step`, `indaba.run.step`, and `indaba.run.inputs_from` (run
  ids only, never contents). `watch`, the dashboard and the page show the mode.
- [ ] AC-10. The result is not applied to the project unless the step asks for it by the workflow's `apply` rule and the
  person confirms, as for any run.
- [ ] AC-11. The web view's "Run this step" calls the same code path with the same options; it adds no capability the CLI
  lacks.

## 4. Non-goals

- **No partial rerun of a failed run's remaining steps.** Resuming from a failure is a different feature
  (`step-budgets` covers a stopped step; a general "continue from step N" is not specified).
- **No running of a range of steps** or of a step together with its dependencies. A person who wants that runs the
  workflow.
- **No fabricating inputs.** There are no stubs or fake outputs.
- **No change to the workflow file.** The option belongs to the run, not to the definition.
- **No silent use of a stale run.** An input from a run is always reported with that run's id and time.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the step id does not exist | fail before starting; list the ids |
| a required input is missing everywhere | fail before starting; name the producing step; nothing is run |
| `from` names a missing, foreign or running run | refuse, naming the reason |
| an input found is older than the workflow file | proceed, and mark it in the plan as "from an older version of the workflow" |
| the step fails | its retries and failure handling run; the run ends `failed`; no other step starts |
| the step escalates | the run ends `escalated` with the board and ruling as for a full run |
| the run is cancelled | teardown as today; the workspace is removed unless kept |
| `--workspace-from` points at a removed workspace | fail before starting |

## 6. Security and data handling

`--step`, `--from` and `--workspace-from` are identifiers resolved against the run store; a value is checked against the
strict name pattern before use and never joined into a path unchecked. An artifact taken from a previous run is
untrusted data and passes the same confinement and size checks as one written in the current run. A run's contents are
never copied into a trace attribute. The step's isolation, sandbox and policy are the ones a full run uses, so a single
step cannot be a way around either.

## 7. Where it lives

- `@indaba/core`: `StepState.Skipped` (a new member), `RunOptions.only` types, the input-source type.
- `@indaba/engine`: planning the single step (resolving inputs and workspace), the engine's run loop honoring `only`, the
  trace attributes.
- `indaba` (the CLI): `--step`, `--from`, `--workspace-from`, `--plan`.
- Contract: `RunOptions.only` of `api-surface.md`.

## 8. Clarifications

All recommendations; the maintainer confirms.

- **C-01. Inputs come from the folder first.** The point of running one step is usually "on what is there now", so the
  current folder wins over an old run's artifact, and the plan states each source. Alternative rejected: preferring the
  last run, which would make the step review something the person has since changed.
- **C-02. A new state, `SKIPPED`.** Treating skipped steps as `COMPLETED` would mislead the dashboard and the cost
  figures, and a step that was not run is not failed. Adding a member to a string-literal union is the cost named in the
  dependency map (a consumer that switches exhaustively stops compiling), so it is classified in `api-surface.md`.
- **C-03. Single-step runs are runs.** They get a trace id, appear in the registry's last-run reference, and cost money
  like any run. The registry shows the mode so a one-step cost is not read as a workflow's cost.
- **C-04. No dependency closure.** Running a step with the steps it needs is a full run, and the cost of getting this
  wrong (running more than asked, spending money) is higher than the convenience.
- **C-05. The web view does not get a different rule.** The button for a step on the graph calls this option with the
  inputs the plan lists, and shows the plan before it asks the person to start.

## Artifacts not written

- `plan.md`: the plan waits for the clarifications to be confirmed.
- `tasks.md`: nothing to schedule until the plan exists.
- `research.md`: there are no alternatives to compare beyond those in section 8.
- `data-model.md`: the only new data is the input-source record in `api-surface.md`.
- `events.md`: the only addition is three attributes on the root span, listed in `api-surface.md`.
