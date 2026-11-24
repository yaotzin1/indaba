# Specification: Landing recheck (check the combined result before a step lands, and say what happens when the target moves twice)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommendations the maintainer confirms)
> **Semver impact**: minor (one optional workflow field, one new span attribute, one clarified end state; a workflow without
> the field behaves as today; below 1.0). Provisional; confirmed in `api-surface.md` at stage 3.
> **Builds on**: [`specs/parallel-steps`](../parallel-steps/spec.md) (landing AC-22, conflicting landing and resolution
> AC-24 and AC-25; slices 1 to 4 implemented) and [`specs/run-integration`](../run-integration/spec.md) (the compare-and-swap,
> AC-06 and AC-07; **not implemented**, so the second part of this spec is implemented after it).
> **Origin**: a discussion of the Indaba post in r/LLMDevs (2026-11-21): rebase and build on the combined tip, and a bounded
> retry when several things land at once.
> **Not part of it**: bisecting a failed combined merge to find the step that broke it, and pre-tagging files to merge last.
> Both are separate ideas that need their own specs.

---

## 1. The problem

**Inside a run.** Steps that run at the same time each pass their own guards in their own worktree, then land one at a
time with a three-way apply (`parallel-steps` AC-22). A landing that applies cleanly is trusted. Two steps can each be correct
alone and clean to merge, and still break the build together: one renames a function, the other adds a call to the old name.
Git sees no conflict, nothing is checked on the combined state, and the break shows up at the end of the run or not at all.

**At the end of a run.** `run-integration` checks the merged result with the run's guards before the swap (AC-07) and tries
once more if the target moved (AC-06). It does not say what happens when the target moves a second time while that second
attempt is built.

## 2. User stories

- **US-01.** As a workflow author, I want to name checks (a build, a type-check) that run on the combined result before each
  step lands, so two clean merges that break together are found where they meet.
- **US-02.** As a workflow author, I want a failed combined check to get the same bounded resolution as a conflicting landing, not
  a new mechanism.
- **US-03.** As a person integrating a run, I want a defined result when the target moves twice, so I never wonder what state
  the target is in.

## 3. Acceptance criteria

- [ ] AC-01. A workflow may declare `land_check`, a list of guards (the guard types of `workflow-format`, same schema). Without
  it, landing is exactly as `parallel-steps` AC-22 specifies.
- [ ] AC-02. With `land_check`, a landing is first applied in a scratch fork of the run worktree, the `land_check` guards run
  there, and only a result that passes is applied to the run worktree. A failing check changes nothing in the run worktree
  (as `parallel-steps` AC-23).
- [ ] AC-03. A failed `land_check` is handled as a conflicting landing: one resolution is tried (`parallel-steps` AC-24), and a
  resolution that fails its guards, fails the check again or is rejected fails the step with feedback naming the check and its
  message, and the step's `on_failure` applies (`parallel-steps` AC-25). No new retry counter is added.
- [ ] AC-04. A step with no changes to land runs no check.
- [ ] AC-05. The checks of one landing see only that landing's combined result. Landings stay one at a time (`parallel-steps`
  AC-22), so two checks never run on overlapping state.
- [ ] AC-06. The time and spend of `land_check` count against the step's timeout and the run's budgets as any guard does; this
  spec adds no ceiling and no default number of its own.
- [ ] AC-07. When the target moves while the second attempt of an integration is built (`run-integration` AC-06), nothing is
  written, the integration ends `moved`, the run keeps its `COMPLETED` status, and the result is kept on the branch
  `indaba/<run id>` as in `run-integration` AC-13. There is no third attempt and no delay before an attempt.
- [ ] AC-08. The span of a landing records `indaba.land.check` (`passed`, `failed` or `skipped`). The end state `moved` is
  recorded on the integration's span and event as the other end states are.
- [ ] AC-09. Every new line is covered by tests; the 85% floor holds.

## 4. Non-goals

- A jitter or back-off before an attempt. Inside a run, landings are serialized by the engine, so nothing retries against
  another landing. Across runs, the attempt is bounded at two (`run-integration` AC-06), so there is nothing to livelock; if many
  runs integrate into one target and `moved` becomes common, that is the evidence to add it, and it needs an injected random source
  (determinism rule) in its own spec.
- Bisecting a failed combined merge to name the culprit step, and pre-tagging files to land last.
- Checks on every commit inside a step's own worktree. Those are the step's guards, which exist.
- A new retry or iteration counter. The existing resolution (`parallel-steps` AC-25) and `on_failure` bound the loop.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| `land_check` passes | the landing applies, as today |
| `land_check` fails | one resolution (AC-03); the run worktree is untouched meanwhile |
| the resolution fails the check again, conflicts or is rejected | the step fails with the check's message; `on_failure` applies |
| a guard in `land_check` cannot run (git state unreadable, process cannot start) | the step fails with that reason; nothing is landed |
| the run is cancelled during a check | the scratch fork is removed, nothing is landed, the step is cancelled |
| the target moves twice during integration | `moved`; nothing written; result on `indaba/<run id>` (AC-07) |
| the process dies midway | the run worktree is changed only by the final apply, one apply, so nothing is half-landed; scratch forks remain under `.indaba/worktrees/` as today |

## 6. Security and data handling

`land_check` guards are written by the author in the workflow file, like every guard, and run in a scratch fork. A guard's
output is untrusted: it is cut and redacted as failure feedback is before it reaches the next prompt, a span or a log. No
model-produced text reaches a command, a path or a shell. The scratch fork is removed whatever happens (`parallel-steps` AC-26).

## 7. Where it lives

- `@indaba/core`: the optional `land_check` member of the workflow model (a list of existing guard definitions).
- `@indaba/engine`: the scratch fork, running the guards, routing a failure to the existing resolution, the `moved` end state of
  the integration (after `run-integration`), the span attributes.

## 8. Clarifications

Recommended defaults, for the maintainer to confirm:

- **C-01.** Opt-in. A check on every landing costs a build per step, so it is off unless the author writes `land_check`.
- **C-02.** Reuse the resolution of `parallel-steps` rather than add a failure path (US-02).
- **C-03.** Open: should a failed check also be offered to a person through `review-gate`, not only to the agents? Recommended no
  for v1; `on_failure` and an arbiter already end in a person when the agents cannot agree.
- **C-04.** Open: is `moved` a new end state or a flavour of `conflicted`? Recommended new, so a report can tell "the code
  conflicts" from "the target kept moving".
- **C-05.** Open: overlap with `parallel-steps` AC-22a (PR #159), which re-runs the *step's own* guards on the combined tree when the run worktree moved, with no opt-in. `land_check` runs *author-named* checks on every landing. Recommended: keep AC-22a as the default mechanism and make `land_check` add checks to it (same scratch fork, same resolution route, one recheck, not two), and have AC-02 and AC-05 here refer to AC-22a instead of restating the apply. Reconciled by the maintainer before either is implemented.

## Artifacts not written

- `plan.md`: the order of work is written when this is implemented, after `run-integration` for AC-07.
- `tasks.md`: as `plan.md`.
- `research.md`: the alternatives are the discussion named under Origin; no external fact is needed.
- `data-model.md`: no stored format of its own.
- `events.md`: no new event class beyond the end state on the existing integration event; the attributes are in `api-surface.md`.
