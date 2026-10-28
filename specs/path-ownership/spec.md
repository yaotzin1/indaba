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

**What a request can end as**

- [ ] AC-04. A request ends in exactly one *outcome*: `accepted` (the owner changed its paths and the change landed),
  `rejected` (the owner answered `REJECT` with a reason and an `INSTEAD`; after a contest, if any), `failed` (the owner
  call failed, timed out, or twice changed paths it does not own) or `withdrawn` (the requester stopped waiting:
  cancelled, failed, or reset by a retry). `accepted`, `rejected` after its contest, `failed` and `withdrawn` are final.
  A request with a final outcome is *settled*.

**Asking before work**

- [ ] AC-05. In a parallel run (`parallel-steps`), the intent call's instruction tells the agent which paths are owned
  and by whom, and asks it to express what it needs from them as `REQUEST <owner role>: <what and why, one paragraph>`
  lines. Before the intent is posted, the engine removes from its `INTENT` paths every path owned by a role other than
  the step's own, so owned paths never make two intents meet (`parallel-steps` AC-12), never put a step back (its
  AC-13) and never take part in a negotiation (its AC-14): two steps that both name a path a third role owns do not
  wait for or negotiate with each other over it, because neither may change it; each sends its request instead. A
  contract proposal that gives a step a path another role owns is not valid (`parseContract` with `mayChange`).
- [ ] AC-06. A `REQUEST` line becomes a board entry of kind `change_request`, from the step, to the owner role. The step
  then waits, freeing its slot, until every request it made is settled. It is then admitted again and repeats its
  intent call, with each outcome (the owner's summary, or the reason and the alternative) in its prompt.

**Asking after work**

- [ ] AC-07. When a step that is not the owner is about to land and its change touches owned paths, nothing of its change
  lands yet. The owned part (the step's diff of those files, bounded, with its goal) becomes a `change_request`, and the
  step waits, freeing its slot, until every such request is settled. It then continues as a *resolution*
  (`parallel-steps` AC-24, not counted against `max_retries`): its agent is called in a fresh fork of the run
  worktree, which now holds every accepted change, with its own earlier diff of the paths it does own and every
  outcome; it makes its change again without touching an owned path; its guards and its review run on that change;
  and it lands as any step does. One rule covers every mix of outcomes: whatever was accepted is already there, and
  whatever was rejected, failed or withdrawn must be done without the owned paths, using the `INSTEAD` when there is one.
- [ ] AC-07a. The continuation of AC-07 is a fresh pass of the step's work, not its `parallel-steps` AC-24 resolution:
  if its landing then conflicts, it still has that one resolution. A `parallel-steps` resolution (after a conflict) of a
  step that is not the owner may not touch an owned path either; one that does fails the step under AC-08. Requests
  come only from an intent call (AC-05) or from the step's own work at its first landing (AC-07), so a resolution
  never waits for an owner.
- [ ] AC-08. A resolution under AC-07 that touches an owned path again fails the step with the reason `change request to
  <owner> not granted: <the outcome and its reason>`, and its `on_failure` applies. AC-05 to AC-08 apply the same way
  in a run with a limit of 1 only in part: there is no intent call at a limit of 1 (`parallel-steps` C-11), so no
  request is sent before work (AC-05, AC-06), and every request comes from the step's work at landing (AC-07). Ownership
  does not need parallel steps.

**Bounds**

- [ ] AC-09. Every wait is bounded and no wait can form a cycle:
  - An owner call never sends a request and never waits for one: it may change only its own paths (AC-12). A need it
    cannot meet there is answered as a rejection with an `INSTEAD`. Its own landing may meet a conflict, which is
    resolved under `parallel-steps` AC-24, a debate with a round limit, not a request.
  - A step sends at most 5 requests per intent call or landing (a design choice); further `REQUEST` lines are ignored,
    counted and reported in the step's feedback.
  - An owner call takes a slot under the parallel limit like any step. A waiting step frees its slot, and an owner call
    with a request waiting is admitted before other ready steps, in the precedence of `parallel-steps` AC-08a (after a
    starved step and a project-directory step, which run alone), so the slots cannot all be held by steps waiting for
    owners.
  - Every owner call has the owner role's timeout; one that times out ends its request `failed`.
  - A contest (AC-14) is a debate with the round limit of any debate, then the arbiter. A ruling not given within
    `ownership.contest_timeout_seconds` (in `indaba.config`, default 900, a design choice) leaves the rejection
    standing, and the run records that nobody ruled. The time is measured by a `Timer` the engine is given (the same
    way it is given its `Clock`), never by reading the system clock in the decision; a test passes a fake timer and
    fires it to check that the rejection stands.
  So a step's wait ends after at most: the owner calls queued ahead of its requests, each bounded by the owner's
  timeout, plus at most one contest per rejected request.

**Answering**

- [ ] AC-10. Requests to one owner are answered one at a time, in board order (their `seq`, `run-blackboard` AC-02). The
  board has one writer, so two requests never share a `seq`; requests that steps produce in the same turn of the
  engine's loop are written in the topological position order of the requesting steps, so the order is the same on
  every run. Each is answered by an *owner call*: the owner role's runner chain in a fork of the run worktree, with
  the request, the requesting step's intent and contract, and an instruction to either make the change in the owned
  paths or answer `REJECT: <reason>` with `INSTEAD: <how to do it without changing the owned paths>`.
- [ ] AC-11. An owner call that changes only owned paths and passes the owner's guards (those of the step with the owner
  role, or, when no step has it, of the first step that names the role in `consensus_with`, else none) lands like any
  step's change. The request ends `accepted`, with a short summary the owner writes.
- [ ] AC-12. An owner call that changes paths outside its own is refused at landing with feedback naming them, and is
  repeated once with that feedback; a second refusal ends the request `failed`.
- [ ] AC-13. An owner call whose answer `parseOwnerAnswer` reads as a rejection ends the request `rejected` with the
  reason and the alternative, unless the requester contests it (AC-14). An answer that is neither a change nor a
  well-formed rejection is treated as a failure of the call.
- [ ] AC-14. A requester may contest a `rejected` request once: the rejection, the request and both steps' notes go to a
  debate of the two roles; without consensus, to the arbiter of the requesting step, else the workflow default, else
  the person, within the bound of AC-09. An accept ruling sends the request back to the owner as AC-10 with the ruling
  attached; whatever that second owner call ends in is final and cannot be contested. A reject ruling makes the
  rejection final. A `failed` request cannot be contested: a failing owner is not asked again.
- [ ] AC-15. When no step in the run has the owner role (the owner exists only to answer), the owner call uses the role's
  runner and permissions from `roles`, and the role is still subject to every permission check before the run starts.

**Seeing it**

- [ ] AC-16. Every request, answer and contest is a board entry, engine-written and engine-read as `parallel-steps`
  AC-11a says: never in a step's digest, always recorded whatever the board's entry cap; the dashboard, `watch --plain` and the web view show
  open requests on the requesting step and on the owner, and the outcome.
- [ ] AC-17. The owner call is a span of its own under the root span, linked to the requesting step's span, with
  `indaba.ownership.owner`, `indaba.ownership.request` and `indaba.ownership.outcome`.
- [ ] AC-18. Each request, answer and contest writes one structured log record with the step, the owner and the task id
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
| the owner call fails or times out | the request ends `failed` (final, not contested); the requester continues under AC-06 or AC-07 |
| the owner changes paths it does not own | AC-12 |
| the owner's change conflicts on landing | `parallel-steps` resolution, with the owner as the step |
| the requesting step is cancelled, fails or is reset while it waits | its open requests end `withdrawn` (a board entry); an owner call already running finishes and lands if it changed the owned paths |
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
- **C-04. One contest per request.** Without a bound, a requester and an owner can argue for the whole run. Only a
  rejection can be contested; a failed owner call is not asked again (review of PR 90).

## Artifacts not written

- `plan.md`: stage 3, once `parallel-steps` slice 3 is in.
- `tasks.md`: stage 4, after the plan.
- `data-model.md`: the request and answer are board records, added to `specs/run-blackboard`'s data model when planned.
- `events.md`: no new event class.
- `research.md`: none needed.
