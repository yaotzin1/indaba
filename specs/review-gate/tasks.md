# Tasks: Review gate

Implemented after `step-verdicts`, `agent-conversation` and `question-contract`; it hooks into the question machinery of the
second and the review loop of the first.

## `@indaba/core`

- [ ] T-01. Types of `api-surface.md`, the built-in labels and `AnsweredBy` gaining `policy`. Test: a consumer that switches on
  `AnsweredBy` still compiles with `plugin:<kind>` handled as open.
- [ ] T-02. `parseVerdictLine` (AC-07): first-column line, closed label set, second line, unknown label, a note cut at 4000.
  Tests include a label that looks like a step id and a reply with the line inside a code fence.
- [ ] T-03. `resolveGate` (AC-06, AC-08): ancestors only, collisions with built-ins, `back` with zero or several predecessors,
  a `defaults.review` template resolved per step.
- [ ] T-04. `applyIfNobody` (AC-15, AC-17, AC-18): each value; `recommendation` without a source behaves as `fail`; the result is
  recorded as policy and never as a person.
- [ ] T-05. `isArmed` (AC-10 to AC-12): `always`, `doubt` with and without the line, `paths` with no tracked workspace is armed
  and says why.

## `@indaba/engine`

- [ ] T-06. Parser and validator for every member of the table in `api-surface.md`, including each parse error and
  `workspace: restore`.
- [ ] T-07. `GateEvidence` builder (AC-14): the 50-path bound and the count of the rest, guards by name, the agent's account
  last and cut. No diff text.
- [ ] T-08. `GateRunner`: arm, build the request (`StructuredQuestion` of kind `review`), walk `by` through the machinery of
  `agent-conversation`, apply the label or the policy (AC-04, AC-05, AC-13, AC-15, AC-16). A fake runner for each answerer
  kind; a fake clock for `timeout_seconds`; the step stays `VALIDATING` while it waits.
- [ ] T-09. `WorkflowEngine`: route the label as `retry_step` does, the counter, `stop`, the two feedback slots (AC-09, AC-21,
  AC-22). Test: a gate sends to the architect, a later step fails and also rewinds to the architect, and both notes arrive.
- [ ] T-10. The board entries, the span attributes and the structure key (AC-19, AC-20, trace structure), with a test that no
  note or evidence text is in a span, event or log line.
- [ ] T-11. Cancellation while a gate waits (AC-24).

## `indaba` and documentation

- [ ] T-12. `plan`: the gate per step, `when`, `if_nobody` sentence, steps run again per label, `gates x iterations`.
- [ ] T-13. `docs/workflow-format.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`; the changes to other specs listed in
  `api-surface.md`. Fill `review.md`.
