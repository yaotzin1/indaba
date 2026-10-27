# Specification: Step fan-out (one step template, run once per item the run produces)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommendations the maintainer confirms)
> **Semver impact**: minor (an optional step field, a new extension point on `PluginHost`, an engine option; nothing
> existing changes; below 1.0). Provisional; confirmed in `api-surface.md` at stage 3.
> **Builds on**: [`specs/parallel-steps`](../parallel-steps/spec.md) (instances run as parallel steps: intents,
> negotiation, landing, conflicts, review), [`specs/run-blackboard`](../run-blackboard/spec.md),
> [`specs/workflow-engine`](../workflow-engine/spec.md) (this spec replaces its non-goal "dynamic graphs").
> **Meets**: [`specs/path-ownership`](../path-ownership/spec.md) (instances usually build around a core they do not own).

---

## 1. The problem

"Build me application xyz" goes through a specification and a plan, and the plan decides how many pieces of work there
are: for a grid component, a core and six plugins (sorting, filtering, search, pagination, grouping, tree). The workflow
file is written before the plan exists, so it cannot list six plugin steps. Today the author either writes a fixed number
of steps by hand, or one step builds every plugin, one after another, with one agent.

Parallel steps (public) make independent steps work at the same time, but only steps that exist in the file. What is
missing is a step the plan multiplies: one template, one instance per item, each instance a parallel step with its own
agent and worktree.

## 2. User stories

- **US-01.** As a workflow author, I want to write one step "build the plugin" with `for_each` naming the plan's list,
  so the run creates one instance per plugin the plan names.
- **US-02.** As a workflow author, I want each instance to get its item (`${{ item.name }}`, `${{ item.scope }}`) in its
  goal, its outputs and its `touches`, so each agent knows which plugin is its own.
- **US-03.** As a workflow author, I want the steps that depend on the template to wait for every instance, so
  integration sees all plugins.
- **US-04.** As a person running Indaba, I want a cap on the number of instances, so a plan that lists forty items does
  not start forty agents.
- **US-05.** As a person watching a run, I want to see the instances as steps of their own, grouped under the template.

## 3. Acceptance criteria

- [ ] AC-01. A step may declare `for_each: <artifact key>`. The artifact is a JSON or YAML list written by a step the
  template depends on. Each item is a map with an `id` (`[a-z0-9-]{1,64}`) and string fields.
- [ ] AC-02. When every dependency of the template is `COMPLETED`, the engine reads the list once, validates it (ids
  unique, at most `maxFanOut` items, default 8, a design choice), and adds one instance per item with the id
  `<template>.<item id>`. A list that is missing, does not parse, breaks a rule or exceeds the cap fails the template
  with a message naming the artifact and the rule.
- [ ] AC-03. `${{ item.<field> }}` in the template's goal, outputs, `touches` and guard parameters is replaced per
  instance. An unknown field is a run-time failure of that instance naming the field. Item values are untrusted: they
  are fenced in prompts and confined when they become paths.
- [ ] AC-04. Instances are ordinary steps for `parallel-steps`: admission, intents, negotiation, landing, conflicts,
  review and the limit all apply to them as to any step.
- [ ] AC-05. A step that depends on the template depends on every instance. The template is `COMPLETED` when every
  instance is, and fails as the first instance whose failure ends the run under `parallel-steps` AC-27.
- [ ] AC-06. A retry that targets the template re-reads the list and re-creates the instances; instances that are
  `COMPLETED` and whose item is unchanged are kept (C-02).
- [ ] AC-07. The trace records the list's digest and the instances created; the dashboard and the web view show the
  instances under their template.

## 4. Non-goals

- Fan-out of a fan-out (an instance that is itself a template). One level.
- Items produced during the instances' work. The list is read once, when the template becomes ready.
- Dependencies between workflows. Not part of this repository.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the list is missing or invalid | the template fails naming the artifact and the rule; `on_failure` applies |
| more items than `maxFanOut` | the template fails; nothing is created |
| one instance fails | as any parallel step (`parallel-steps` AC-27, AC-28) |
| the run is cancelled | as `parallel-steps` AC-29 |

## 6. Security and data handling

Items come from agent output. Ids are validated before they reach a step id, a worktree name or a path; fields are fenced
in prompts, confined when used as paths, and never reach a command line.

## 7. Where it lives

- `@indaba/core`: the `for_each` field, the item list's validation, the `GraphExpander` contract and
  `PluginHost.registerGraphExpander`.
- `@indaba/engine`: calling expanders when a step becomes ready, validating the steps they add as parsed steps are
  validated, and the built-in `for_each` expander, registered through the same host call as any plugin's.
- `indaba`, `@indaba/tui`, `@indaba/server`, `@indaba/web`: showing instances under their template.

## 8. Clarifications

- **C-01. Read the list once, when the template is ready.** A plan that changes during the work is a new run.
- **C-02. Keep completed instances on a retry when their item is unchanged.** Rebuilding six plugins because the plan
  added a seventh would waste the six.
- **C-03. The cap is an engine setting, not a file field**, as the parallel limit is: what a machine can take is the
  installation's choice.

## 9. The extension point

Fan-out is built on a general extension point, so that a plugin can grow a run's graph in other ways too:

- [ ] AC-08. `PluginHost.registerGraphExpander(expander)` registers a `GraphExpander`. When a step becomes ready, the
  engine asks each expander, in registration order, whether it expands that step; the first that does returns the steps
  to add (and which of them replace the step). The added steps are validated exactly as parsed steps are (ids, roles,
  fields, a cycle check on the new graph) before any of them is admitted. A step an expander returns that fails
  validation fails the expanded step with the message, and adds nothing.
- [ ] AC-09. The built-in `for_each` is an expander registered through this call, with no access a plugin's expander
  lacks.
- [ ] AC-10. An expander that throws fails the expanded step, as a guard that throws fails its step. The run's
  other steps are not affected.

## Artifacts not written

- `plan.md`: stage 3, after the decisions in section 8 are confirmed and `parallel-steps` slice 2 is in.
- `tasks.md`: stage 4, after the plan.
- `data-model.md`: the list format is in AC-01.
- `events.md`: no new event class; instances emit the events of any step.
- `research.md`: none needed.
