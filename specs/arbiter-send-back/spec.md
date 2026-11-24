# Specification: Arbiter send-back (a ruling that moves the run back to an earlier step, with a note)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommendations the maintainer confirms)
> **Semver impact**: minor (an optional member of a ruling, an optional member of a ledger line, one new span attribute; a
> workflow without a gate behaves as today; below 1.0). Provisional; confirmed in `api-surface.md` at stage 3.
> **Builds on**: [`specs/debate-arbiter`](../debate-arbiter/spec.md) (the ruling, the ledger; implemented),
> [`specs/review-gate`](../review-gate/spec.md) (the closed set of labels, `send_back`, the bounded loop; **not implemented,
> this spec is implemented after it**) and [`specs/step-verdicts`](../step-verdicts/spec.md) (`send_back_to`, `max_iterations`).
> **Not part of it**: a model arbiter (its own spec, `debate-arbiter` section 4), restoring a workspace on send-back
> (`review-gate` section 4), and sending work back on a plain failure (that is `on_failure: retry_step`, which exists).

---

## 1. The problem

A debate that ends `stalled` or `max_rounds_exceeded` goes to an arbiter, and the arbiter says `accept` or `reject`. A `reject`
ends the step `ESCALATED`, and the engine never retries an escalated outcome: `on_failure: retry_step` acts only on a plain
failure, so the run halts. `debate-arbiter` section 4 once said re-running after a `reject` "is `on_failure`"; it is not (the
engine skips the retry when the outcome is escalated).

So after the reviewers have converged on "the spec was wrong", the person who rules has one move: stop the run. They cannot say
*go back to the spec, and fix this*. `review-gate` gives a gate a closed set of labels, with a send-back to an earlier step, but
a debate's ruling is not one of its inputs.

## 2. User stories

- **US-01.** As a person who rules on a failed debate, I want to answer `reject` with one of the labels the author wrote and a
  note ("the requirement about X is wrong"), so the run goes back to that step instead of stopping.
- **US-02.** As a workflow author, I want to list in the file which earlier steps a ruling may send the run back to, so no
  ruling can name a step I did not allow.
- **US-03.** As a workflow author, I want the loop bounded, so a ruling that keeps sending work back ends in `escalated`.
- **US-04.** As a person reviewing a run, I want each send-back (who, which label, the note) in the decision ledger.
- **US-05.** As a developer embedding the engine, I want a model arbiter to be able to give the same answer later without a
  second mechanism.

## 3. Acceptance criteria

- [ ] AC-01. A ruling may carry an optional `label`. A ruling with no `label` behaves exactly as `debate-arbiter` specifies
  (`accept` completes the step, `reject` ends it `ESCALATED`).
- [ ] AC-02. A `label` is valid only with `reject`, and only if it is one of the closed set of labels of the step's gate
  (`review-gate` AC-06) that sends the run back: `back` and each `send_back` label. `revise` is also allowed (run this step's
  debate again). `approve` and `stop` are not labels of a ruling: they are `accept` and a `reject` without a label.
- [ ] AC-03. A step with `arbiter` and a `review` that has no send-back label has nothing to offer: the arbiter asks for `accept`
  or `reject` as today.
- [ ] AC-04. The terminal arbiter lists the labels the step allows, each with its target step, and reads `accept`, `reject`, or
  `reject <label>` with an optional one-line note. Any other answer is asked again, at most three times, then the arbiter is
  unavailable (as `debate-arbiter` AC-06).
- [ ] AC-05. On `reject <label>` the target and every step after it are reset and run again, exactly as for `retry_step`, and
  the target's next prompt carries the note and nothing else from this attempt (`Retries are isolated and bounded`). The note is
  cut to 4000 characters and redacted as failure feedback is.
- [ ] AC-06. The loop is bounded by the gate's counter (`review-gate` AC-09): one per gate, never reset in the run, counting every
  run-again. When it is spent the step ends `ESCALATED` with a reason naming the step and the limit, and the arbiter is not
  asked again.
- [ ] AC-07. A ruling's `label` never names a step, a path or a number. The label is an indirection to the file.
- [ ] AC-08. Every ruling with a label is appended to `.indaba-decisions/<workflow-name>.jsonl` with an optional `label` member.
  The note is stored as for any ruling, never the transcript.
- [ ] AC-09. A recorded ruling with a `label` is honoured by the memo (`debate-arbiter` AC-12) only for the same key. Because a
  send-back changes the files, the next key misses and the debate runs again; a memoised send-back that would repeat itself
  counts against the counter all the same.
- [ ] AC-10. The span of a ruled step records `indaba.arbiter.label` when there is one. The note is in no span, event or log line.
- [ ] AC-11. When no one can answer (no terminal, `--tui`, cancel), the step ends `ESCALATED` as today. There is no default label.
- [ ] AC-12. Every new line is covered by tests; the 85% floor holds.

## 4. Non-goals

- A model deciding the label. The contract leaves room (the `Adjudicator` returns a label), and a model arbiter is its own spec.
  Its note would be untrusted data (section 6).
- A ruling that names a step directly. The author lists the labels; the arbiter picks among them.
- Sending the run *forward* or skipping a step.
- A label chosen when nobody answers. `review-gate`'s `if_nobody` is a gate's policy, not the arbiter's, and is not extended here.
- Restoring the workspace to what it was before the target (`review-gate` section 4).

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| `accept` | the step completes, as today |
| `reject` with no label | the step ends `ESCALATED`, as today |
| `reject <label>`, label allowed, counter left | the target and its descendants are reset; the target's prompt carries the note |
| `reject <label>`, counter spent | the step ends `ESCALATED`, reason names the step and the limit |
| a label that is not allowed | asked again; three tries, then unavailable and `ESCALATED` |
| no terminal, `--tui`, the run is cancelled | `ESCALATED` or cancelled exactly as `debate-arbiter` |
| the ledger line cannot be written | the step fails with the path and the error; the ruling is not applied |
| the adjudicator throws | the step `FAILED`, not `ESCALATED`, so a bug is not read as a judgement |

## 6. Security and data handling

The label is checked against the author's closed set, so a ruling cannot steer the graph to a step the author did not name. The
note a person writes is that person's own text; a note a model writes (a later spec) is untrusted data: it is cut, redacted, shown
to the next agent as data and never put in a command, a path, a span or a log line. The ledger is committed and public to
everyone with the repository, so the note is redacted before it is written, as in `debate-arbiter` section 6.

## 7. Where it lives

- `@indaba/core`: the `label` member of the ruling and of the `Adjudicator` contract (pure, no `node:`).
- `@indaba/engine`: validating the label against the gate's set, resetting the target through the existing retry path, the counter
  of the gate, the ledger member and the span attribute.
- `indaba` (CLI): the terminal arbiter lists the labels and reads `reject <label>`.

## 8. Clarifications

Recommended defaults, for the maintainer to confirm:

- **C-01.** A ruling with no label stays `ESCALATED`. Nothing changes for a workflow without a gate.
- **C-02.** The labels are the gate's: the arbiter adds no field of its own to the workflow file.
- **C-03.** The note passes through unchanged for a person, cut and redacted; summarising an agent's note is for the model-arbiter spec.
- **C-04.** A send-back resets the target and its descendants only, as `retry_step` does. Debate rulings recorded for steps in the
  reset range stay in the ledger and are matched by the memo only if the key still matches.
- **C-05.** Open: when no one can answer, should the author be able to name a fallback label? Recommended no for v1 (AC-11).

## Artifacts not written

- `plan.md`: nothing is built until `review-gate` is; the order of work is written when this is implemented after it.
- `tasks.md`: as `plan.md`.
- `research.md`: the alternatives are the debate recorded in the conversation that led here; no external fact is needed.
- `data-model.md`: no stored format of its own beyond one optional ledger member (`api-surface.md`).
- `events.md`: no new event; the one span attribute is in `api-surface.md`.
