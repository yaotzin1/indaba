# Tasks: Review gate

Implemented after `step-verdicts`, `agent-conversation`, `run-blackboard` and `workspace-without-git`; it hooks into the review loop of
the first and the answerer machinery of the second.

## `@indaba/core`

- [ ] T-01. Types of `api-surface.md`, `isGate`, `Deadline`, `AnsweredBy` gaining `'policy'`. Test: a consumer that switches on
  `AnsweredBy` still compiles.
- [ ] T-02. `parseVerdictLine` and `parseDoubtLine` (AC-07, AC-11): first-column line, narration before it allowed, a line inside a
  code fence, two lines, an unknown label, a label that looks like a step id, a note cut at 4000, a doubt cut at 500.
- [ ] T-03. `panelLabelFrom` (AC-07): consensus on one label, a majority, a split with no quorum, a participant that names an
  unknown label.
- [ ] T-04. `resolveGate` (AC-03, AC-06, AC-08): ancestors only, label collisions with built-ins and step ids, `previous` with zero
  or several predecessors, a template that leaves a label out for a step that cannot take it.
- [ ] T-05. `applyIfNobody` (AC-15, AC-17, AC-18): each value; `advice` without a label behaves as `fail`; the result is recorded as
  policy with `decided_by: policy:<step id>` and never as a person.
- [ ] T-06. `isArmed` (AC-10 to AC-12): `always`, `doubt` with and without the line, `paths` with no tracked workspace is armed and
  says why.
- [ ] T-07. `gateBound` (AC-24): a chain of gates with sends-back to a shared ancestor; the bound is not `gates x iterations`.

## `@indaba/engine`

- [ ] T-08. Parser and validator for every member and every parse error of `api-surface.md`, including `workspace: restore`, `person`
  not last, `advise` of the step's own role, and `isReviewStep` being false for a gate.
- [ ] T-09. `GateEvidence` builder (AC-13): the 50-path bound and the count of the rest, guards by name, the agent's account last
  and cut, the 6000-byte bound with paths cut first. No diff text.
- [ ] T-10. The change list of one attempt for `paths` (AC-12) from the tracked workspace between the attempt's snapshots, not
  counting earlier steps.
- [ ] T-11. `GateRunner`: arm; `advise`; walk `by`; faulty versus silent (AC-15); the label or the policy; the deadline aborting calls in
  flight and counting what they spent (AC-16). A fake answerer per kind; a fake `Deadline`; the step stays `VALIDATING` while it waits.
  Test: a faulty reviewer with `if_nobody: approve` ends the step `ESCALATED`, not approved.
- [ ] T-12. `WorkflowEngine`: route the label as `retry_step` does, the counter, `stop`, the two kinds of feedback and their
  one-delivery lifecycle (AC-09, AC-21, AC-22). Test: a gate sends to the architect, a later step fails and also rewinds to the
  architect, and both reach the architect's prompt once.
- [ ] T-13. `PromptBuilder` and `StepRunOptions`: the gate note; a step with neither has a prompt byte-identical to today.
- [ ] T-14. The board entries (`accepted` when posted), `GateDecided`, the span attributes and the structure key (AC-19, AC-20), with a
  test that no note or evidence text is in a span, event or log line.
- [ ] T-15. Cancellation while a gate waits (AC-25).

## `indaba` and documentation

- [ ] T-16. `plan`: everything listed under CLI in `api-surface.md`.
- [ ] T-17. The extension of the answer prompt and dashboard to render a `GateRequest` (AC-14).
- [ ] T-18. `docs/workflow-format.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`; the changes to other specs listed in `api-surface.md`.
  Fill `review.md`.
