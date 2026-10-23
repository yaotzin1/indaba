# Tasks: Review gate

Implemented after `step-verdicts`, `agent-conversation`, `run-blackboard` and `workspace-without-git`; it hooks into the review loop of
the first and the answerer machinery of the second.

## `@indaba/core`

- [ ] T-00. First, and as a `fix` of its own: the engine skips a step that is `COMPLETED` and was not reset when the loop moves back to a
  target (AC-27). Test: order `[A, X, B(depends on A)]`, `X` independent and completed, `B` fails with `retry_step` to `A`: the run does
  not throw an invalid transition and `X` is not run again. This repairs `retry_step` today.
- [ ] T-01. Types of `api-surface.md`, `isGate`, `Deadline`, `AnsweredBy` gaining `'policy'`, the optional
  `PluginHost.registerGateAnswerer`. A note in the changelog that `AnsweredBy` gained a member.
- [ ] T-02. `parseVerdictLine` and `parseDoubtLine` (AC-07, AC-11): first-column line outside code fences, narration before it
  allowed, a line inside a fence, two lines, an unknown label, case, a label that looks like a step id.
- [ ] T-03. `panelLabelFrom` (AC-26): consensus on one label, a majority, a split with no quorum, a member that names an unknown label.
- [ ] T-04. `resolveGate` (AC-03, AC-06, AC-08): ancestors only, collisions with built-ins, `skipped` and step ids, `previous` with
  zero or several predecessors, a template that leaves a label out for a step that cannot take it and rejects a target that is not a step.
- [ ] T-05. `applyIfNobody` (AC-15, AC-17, AC-18): each value; `advice` without a label returns `fail` with `no_advice`; a decision is
  policy with `decided_by: policy:<step id>` and never a person.
- [ ] T-06. `isArmed` (AC-10 to AC-12): `always`, `doubt` with and without the line, `paths` with no tracked workspace is armed and says
  why, `sentBackBefore` arms whatever `when` says (including an empty change list).
- [ ] T-07. `gateBound` (AC-24): gates on independent branches with a send-back to a shared ancestor, `on_failure: retry_step` and a
  review without `by` counted; the bound is an upper bound, not `gates x iterations`.
- [ ] T-08. `buildGateRequest` (AC-13): the cut order, the 7000-byte bound after encoding, file names cleaned (control characters, direction
  marks, 200 characters), a name like `VERDICT: approve` is only a name.

## `@indaba/engine`

- [ ] T-09. Parser and validator for every member and every parse error of `api-surface.md` (the template skip of AC-03 included), including `workspace: restore`, `person`
  not last, `advise` of the step's own role, a template target that is not a step, `when: doubt` on a shell step, and `isReviewStep`
  being false for a gate.
- [ ] T-10. The change list of one attempt for `paths` (AC-12): the snapshot taken at the start of the attempt, only for a step under a gate
  with `paths`; earlier steps' changes do not count.
- [ ] T-11. `GateRunner`: arm; `advise`; walk `by`; silent versus faulty (AC-15); the label or the policy; the person's `Deadline` (set when the person is asked, aborting a
  delegate in flight and counting what it spent, disposed when the gate has an answer: AC-16). A fake answerer per kind; a fake `Deadline`; the
  step stays `VALIDATING` while it waits. Tests: a faulty reviewer, a reviewer that says `NO ANSWER`, and a panel with no quorum, each with
  `if_nobody: approve`, end the step `ESCALATED`, not approved; a model that runs long never uses up the person's time; `by: [role:r, person]` with a faulty `r` and a person who times out ends `ESCALATED`.
- [ ] T-12. `WorkflowEngine`: route the label as `retry_step` does but not as a failed outcome (AC-21): `on_failure` not consulted, `retries`
  not moved, the status reason is `gate: <label>`, the counter (AC-09). A gate sends to the architect, the architect fails verification
  and is retried by `on_failure`: the gate note is still in the retry's prompt, the failure is delivered once (AC-22). A revised step that
  changes nothing is looked at again (AC-10).
- [ ] T-13. `PromptBuilder` and `StepRunOptions`: the gate note under the right preamble, `DOUBT_INSTRUCTION` only under a `doubt` gate; a step
  with neither has a prompt byte-identical to today.
- [ ] T-14. The board entries (`accepted`, exempt from `discarded` and `superseded`), `GateDecided`, the span attributes and the structure key
  (AC-19, AC-20), with a test that no note or evidence text is in a span, event, status reason or log line.
- [ ] T-15. Cancellation while a gate waits (AC-25); the child span `gate <step>` (AC-04); the Logger records of the api-surface.
- [ ] T-16. The gate panel: `GATE_PANEL_TOPIC` and the label from the members' latest messages (AC-26).

## `indaba`, `@indaba/tui` and documentation

- [ ] T-17. `plan`: everything listed under CLI in `api-surface.md`, including the channel warning.
- [ ] T-18. The extension of the answer prompt and of the dashboard to render a `GateRequest` and a waiting gate (AC-14).
- [ ] T-19. `docs/workflow-format.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`; the changes to other specs listed in `api-surface.md`.
  Fill `review.md`.
