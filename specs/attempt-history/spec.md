# Specification: the attempts of a step, one by one

> **Status**: Accepted
> **Stage entry**: 1
> **Semver impact**: minor (an additive field on `StepView` and extra lines in the dashboard and plain views; confirmed in api-surface.md)

---

## 1. The problem

When a step is retried (`on_failure`), the dashboard and the plain view show only a count (`x2`, `attempt 2`) and the
reason of the attempt that is current. The reason of an earlier attempt is dropped the moment the step runs again, so
a person watching a run cannot tell what failed the first time, how long it took, or whether the retries fail for the
same reason. That is the question a retry raises. (Roadmap friction list, item 6.)

## 2. User stories

- **US-01.** As a person following a run, I see for a step that was retried how each earlier attempt ended, how
  long it ran and why it failed.
- **US-02.** As a developer embedding `@indaba/engine`, I read the attempts of a step from `StepView.history`.

## 3. Acceptance criteria

- [ ] AC-01 `StepView.history` lists the attempts of a step, oldest first: each entry has `attempt` (1, 2, ...),
      `startedAt`, `endedAt` (undefined while it runs), `outcome` (the step's latest state in that attempt) and `reason`
      (why it failed or escalated, when the engine said).
- [ ] AC-02 An attempt begins when the step enters `RUNNING`, and records every later state of the step until it
      enters `RUNNING` again. It ends at `FAILED`, `ESCALATED` or `COMPLETED`.
- [ ] AC-03 `history` keeps at most the newest 20 attempts, and `attempts` still counts all of them.
- [ ] AC-04 The dashboard's detail pane, for a step with more than one attempt, shows one row for each earlier attempt:
      `attempt 1: failed after 3s: <first line of the reason>`. The attempt that is current is not repeated: its state is
      the title and its reason is the `reason:` rows, as today.
- [ ] AC-05 The plain view prints the same lines under the step.
- [ ] AC-06 A step with one attempt shows nothing new. `attempts`, `reason` and every other field are as before.
- [ ] AC-07 A reason is untrusted text: it is sanitised, cut to its first line, and bounded to 120 characters.

## 4. Non-goals

- Splitting the output pane by attempt. The output is still one stream per step.
- The agent CLI's own internal retries (an API error and its retry inside one run). Those are not recorded as events
  today, and recording them is a change to the runners.
- A new event or span. The history is built from the `step_status` records a run already writes.
- Changing how many times a step is retried.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| records are missing (a run read from a file written before the event stream) | no history; the step shows as before |
| a transition arrives with no `RUNNING` before it | no entry is made; `history` is not invented |
| the run is cancelled mid-attempt | the last entry keeps the outcome it had and has no `endedAt` |
| a reason holds escape sequences or line breaks | sanitised and cut (AC-07) |

## 6. Security and data handling

Reasons come from run files, which anything could have written, and reach a terminal: they pass through `sanitize`.
The history holds the text the run already stored (already redacted by the engine before it was recorded); nothing new
is stored, and the bound in AC-03 keeps the state small.

## 7. Where it lives

`@indaba/engine`, `trace/view.ts` (the state and the reducer) and `trace/plain.ts` (the plain view). `@indaba/tui`,
`screen.ts` (the detail pane). No change to `@indaba/core`, the records or the files.

## 8. Clarifications

- `outcome` is the step's state name as the engine writes it (`FAILED`), not a translated word, so it matches
  `StepView.status`. The views print it with the same words they already use for a step's state.
- Twenty attempts is a bound for memory, not a statement about retries; a step that is retried more is rare.
- The current attempt is the last entry of `history`. The views show the entries before it: the title already gives
  the current attempt's state and the `reason:` rows its reason.

## Artifacts not written

- `plan.md`: one reducer change and two views; the plan is the api-surface.md.
- `tasks.md`: fewer than two independent steps worth tracking.
- `data-model.md`: no stored shape changes.
- `research.md`: nothing to compare.
- `events.md`: no event, span or attribute is added or changed.
