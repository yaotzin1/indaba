# Specification: Workflow engine

> **Superseded implementation language.** This spec was written for the PHP prototype, which was never
> published. Behaviour is unchanged by the TypeScript port; class, method and field names follow
> [`specs/typescript-port/api-surface.md`](../typescript-port/api-surface.md) (for example
> `RunnerInterface` is `Runner`, `*Exception` is `*Error`, fields are camelCase). Where this text names a
> PHP, Composer, Symfony or Docker detail, read the Node and TypeScript equivalent.

> **Status**: Implemented in the initial commit; specified retroactively from `docs/vision.md`
> section 3A and 4. Written after the code, so treat it as a description to be corrected by review.
> **Stage entry**: 1 (retroactive)
> **Semver impact**: minor (the first public surface; the project is below 1.0)

---

## 1. The problem

Running several AI agents and verification commands in a sequence by hand, or with a shell script,
gives no ordering guarantees, no gate that stops a bad step, no bounded retries and no record of
what happened. The person running Indaba needs to declare a pipeline once, in a file, and have it
executed the same way every time.

## 2. User stories

- **US-01.** As a workflow author, I declare roles, steps and dependencies in a YAML file and get
  every mistake (unknown dependency, cycle, unknown role or runner) reported before anything runs.
- **US-02.** As a workflow author, I attach guards to a step, such as "no changes under `src/` during
  the RFC step", and a violated guard fails the step.
- **US-03.** As a workflow author, I declare `on_failure` with a target step and `max_retries`, and a
  failing verification sends the implementer back with only the last failure, a bounded number of
  times.
- **US-04.** As a developer embedding Indaba, I get a `WorkflowResult` describing every step's final
  state and attempts, and PSR-14 events for each state change.

## 3. Acceptance criteria

- [ ] A workflow file parses into `WorkflowDefinition` and `StepDefinition` objects, or throws a
      `WorkflowValidationException` listing every problem found.
- [ ] `DagBuilder` returns a topological order, detects cycles, and breaks ties by declaration order.
- [ ] Steps move through `PENDING`, `RUNNING`, `VALIDATING`, `FAILED`, `ESCALATED`, `COMPLETED`
      only along legal transitions; an illegal one throws `InvalidTransitionException`.
- [ ] `git_diff_empty` guards fail a step that changed the listed paths.
- [ ] A retry prompt contains the last failure and not the earlier ones; the retry count is bounded
      by `max_retries`, after which the step is escalated.
- [ ] Artifact placeholders (`${{ artifacts.x }}`) are resolved or rejected at parse time.
- [ ] The engine reads no wall clock and no randomness in its decisions. (Review finding to
      resolve: the engine currently generates a default task id with `random_bytes`; the id should be
      injected.)

## 4. Non-goals

- Dynamic graphs: steps are not added at run time.
- Parallel step execution. Steps run in the topological order, one at a time, for now.
- Executing this repository's own development `workflow.ai.yml`. That file has a different schema
  and is read by Node scripts; dogfooding is a later goal.
- A scheduler, a queue or persistence of runs.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the runner exits non-zero | the step is `FAILED`; its `on_failure` decides: retry a target, or escalate |
| a guard fails | the step is `FAILED` with the guard's reason |
| retries are exhausted | the step is `ESCALATED` and the run ends with a non-success `WorkflowStatus` |
| the runner cannot run (`RunnerException`) | the step fails with that message; no retry loop on a missing binary beyond `max_retries` |
| invalid workflow file | nothing runs; every validation problem is reported |

## 6. Security and data handling

The workflow file is untrusted-ish data: parsed with `symfony/yaml` without object or constant
flags, with paths in guards and artifacts confined to the workspace, and with commands reaching a
shell only through `ShellRunner`. See `.agents/skills/application_security/SKILL.md`.

## 7. Where it lives

`src/Workflow/`. `Model`, `Graph` and `State` are pure domain; `Parser`, `Guard` and `Engine` are
infrastructure around them. The engine depends on `RunnerRegistry` and the workspace manager through
their types, never on a concrete runner.

## 8. Clarifications

None recorded; the retroactive spec follows `docs/vision.md`. Defaults (for example the default
`max_retries`) are to be confirmed against the code in `review.md`.

## Artifacts not written

- `plan.md`: retroactive spec; the module layout is in `.agents/rules/architecture.md`.
- `research.md`: no options were recorded at the time; none is invented here.
- `events.md`: the state-change event is listed in api-surface.md; its payload is `StepStatusChanged`.
- `tasks.md`: the work is done; a checklist after the fact has no use.
