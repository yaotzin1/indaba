# Specification: Path ownership (a role owns part of the project; others ask it for changes)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 2 (the maintainer confirmed C-01 to C-04 on 2026-10-27)
> **Semver impact**: minor (an optional workflow field, a new board kind, new span attributes and log records; a
> workflow without `owners` behaves as today; below 1.0). Provisional; confirmed in `api-surface.md` at stage 3.
> **Builds on**: [`specs/parallel-steps`](../parallel-steps/spec.md) (intents, landing, waiting, resolution),
> [`specs/run-blackboard`](../run-blackboard/spec.md) (requests and answers are board entries),
> [`specs/agent-mesh`](../agent-mesh/spec.md) and [`specs/debate-arbiter`](../debate-arbiter/spec.md) (a disputed
> request goes to the arbiter), [`specs/git-workspace`](../git-workspace/spec.md).
> **Meets**: [`specs/agent-conversation`](../agent-conversation/spec.md) (the decider), [`specs/step-budgets`](../step-budgets/spec.md)
> (the owner's calls are metered).

---

## 1. The problem

A project often has a part that everything else is built on: the core of a library with plugins around it, a shared
data model, a public API. When several agents work at once, each building one plugin, each of them will find something
the core lacks and will change the core to get it. Five agents, five slightly different changes to the same engine; the
core drifts, and nobody was responsible for keeping it coherent.

People solve this with ownership: one person owns the core, and anyone who needs a change asks them. The owner decides
whether the change belongs in the core, makes it in a way that fits the rest, or says how to do it without touching the
core. The core changes only when it has to, and always through one pair of hands.

Indaba has no way to say "this role owns these paths". A `diff_within_scope` guard can forbid a step to touch them, but
then the step fails and nobody makes the change it needed.

## 2. User stories

- **US-01.** As a workflow author, I want to declare that a role owns some paths (`core` owns `src/core/**`), so no other
  role changes them directly.
- **US-02.** As a workflow author, I want a step that needs a change in owned paths to send a change request to the
  owner, saying what it needs and why, instead of making the change itself.
- **US-03.** As a workflow author, I want the owner to accept a request and make the change in its own way, or reject it
  with a reason and an alternative, and I want the requesting step to continue from the result.
- **US-04.** As a workflow author, I want a step that changed owned paths anyway to have that part of its change turned
  into a request automatically, not thrown away and not landed.
- **US-05.** As a workflow author, I want a requester who disagrees with a rejection to be able to take it to the
  arbiter, once.
- **US-06.** As a person watching a run, I want to see every request, who asked, what the owner answered, and what
  changed in the owned paths because of it.

## 3. Acceptance criteria

**Declaring**

- [ ] AC-01. A workflow may declare `owners`: a map from a role name to a non-empty list of paths or globs. A role that
  is not in `roles`, an empty list, a path outside the project or two roles owning the same literal path fail validation
  naming the role and the path. Globs of two owners that may overlap (by literal prefix, as in `parallel-steps` C-07)
  are a validation warning, not an error.
- [ ] AC-02. A workflow without `owners` parses, validates and runs exactly as today.
- [ ] AC-03. A step whose role owns a path may change it like any path. Every other step may read it and may not change
  it.

**Asking before work**

- [ ] AC-04. In a parallel run (`parallel-steps`), an intent with an `INTENT` line that matches another role's owned
  paths, or a `NEEDS` line naming something the owner `PROVIDES`, is not negotiated with the owner's paths. The intent
  call's instruction tells the agent which paths are owned and by whom, and asks it to express what it needs from them
  as `REQUEST <owner role>: <what and why, one paragraph>` lines.
- [ ] AC-05. A `REQUEST` line becomes a board entry of kind `change_request`, from the step, to the owner role. The step
  then waits (as `parallel-steps` AC-13) until every request it made is answered.

**Asking after work**

- [ ] AC-06. When a step that is not the owner is about to land and its change touches owned paths, the change is split
  by path. The part outside owned paths lands as usual. The part inside becomes a `change_request` whose body is the
  step's diff of those files, bounded, plus the step's goal. The step waits for the answer before it is `COMPLETED`.
- [ ] AC-07. In a run with a limit of 1, AC-06 applies the same way: ownership does not need parallel steps.

**Answering**

- [ ] AC-08. Requests to one owner are answered one at a time, in the order they were posted, by an *owner call*: the
  owner role's runner chain in a fork of the run worktree, with the request, the requesting step's intent and contract,
  the board digest and an instruction to either make the change in the owned paths or answer `REJECT: <reason>` with
  `INSTEAD: <how to do it without changing the owned paths>`.
- [ ] AC-09. An owner call that changes only owned paths and passes the owner step's guards (or, when no step has the
  owner role, the guards of the first step that names the role in `consensus_with`, else none) lands like any step's
  change, through `parallel-steps` landing and resolution. The request is answered `accepted`, with a short summary the
  owner writes, and the requesting step continues from the combined state: if it was waiting before work, it is admitted
  again; if it was waiting to land, its own part is re-forked from the combined state and its owned part is dropped.
- [ ] AC-10. An owner call that changes paths outside its own is refused at landing with feedback naming them, and is
  repeated once with that feedback; a second refusal answers the request `failed`, which goes to the arbiter as AC-12.
- [ ] AC-11. An owner call that rejects answers the request `rejected` with the reason and the alternative. A step
  waiting before work starts with the rejection in its prompt. A step waiting to land runs again (as a resolution, not
  counted against `max_retries`) with the rejection and the alternative, and must land without touching owned paths.
- [ ] AC-12. A requester whose request is rejected may contest it once: the rejection, the request and both steps' notes
  go to a debate of the two roles; without consensus, to the arbiter of the requesting step, else the workflow default,
  else the person. An accept ruling sends the request back to the owner as AC-08 with the ruling attached; a reject
  stands.
- [ ] AC-13. When no step in the run has the owner role (the owner exists only to answer), the owner call uses the role's
  runner and permissions from `roles`, and the role is still subject to every permission check before the run starts.

**Seeing it**

- [ ] AC-14. Every request, answer and contest is a board entry; the dashboard, `watch --plain` and the web view show
  open requests on the requesting step and on the owner, and the outcome.
- [ ] AC-15. The owner call is a span of its own under the root span, linked to the requesting step's span, with
  `indaba.ownership.owner`, `indaba.ownership.request` and `indaba.ownership.outcome`.
- [ ] AC-16. Each request, answer and contest writes one structured log record with the step, the owner and the task id
  and nothing from the agents' text.

## 4. Non-goals

- **Ownership across workflows or projects.** One run, one project.
- **Fine-grained permissions on reads.** Owned paths are readable by everyone.
- **Owners per step.** Ownership belongs to roles, so the same agent configuration answers every request.
- **Several owners agreeing on one change.** A request goes to one owner; a change that spans two owners is two
  requests.
- **Persisting ownership between runs** beyond the workflow file and the decision ledger.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the owner call fails or times out | the request is answered `failed`; AC-12 applies, with the failure as the reason |
| the owner changes paths it does not own | AC-10 |
| the owner's change conflicts on landing | `parallel-steps` resolution, with the owner as the step |
| the requesting step is cancelled or fails while it waits | its open requests are withdrawn (a board entry); an owner call already running finishes and lands if accepted |
| the run is cancelled | every owner call is aborted; open requests are withdrawn |
| two requests to the same owner contradict | answered in order; the second sees the first's outcome on the board and in the combined state |

## 6. Security and data handling

- Requests and answers are agent text: bounded, cleaned, redacted and fenced when they enter another agent's prompt.
- Owned paths are validated and confined at parse time; the split of a diff by path uses the confined, project-relative
  paths git reports.
- The owner role's permissions are checked before the run, like any role's.

## 7. Where it lives

- `@indaba/core`: `owners` on the model; the owned-path match (shared with `meets`); the `REQUEST`, `REJECT` and
  `INSTEAD` line parser; the `change_request` board kind and its answers.
- `@indaba/engine`: validation; splitting a diff by path; the owner queue and the owner call; the contest through the
  debate path.
- `indaba`, `@indaba/tui`, `@indaba/server`, `@indaba/web`: showing requests and answers.

## 8. Clarifications

Confirmed by the maintainer on 2026-10-27:

- **C-01. Ownership belongs to roles, declared at the workflow level.** A role is the agent configuration that answers;
  tying ownership to a step would leave nobody to answer once that step is complete.
- **C-02. Owned parts of a change are turned into a request, not rejected.** The work the step did is the clearest
  statement of what it needs; throwing it away would make it say the same thing again in prose.
- **C-03. One owner call at a time per owner.** The owner keeps the owned paths coherent only if it sees its own changes
  in order.
- **C-04. One contest per request.** Without a bound, a requester and an owner can argue for the whole run.

## Artifacts not written

- `plan.md`: stage 3, once `parallel-steps` slice 3 is in.
- `tasks.md`: stage 4, after the plan.
- `data-model.md`: the request and answer are board records, added to `specs/run-blackboard`'s data model when planned.
- `events.md`: no new event class.
- `research.md`: none needed.
