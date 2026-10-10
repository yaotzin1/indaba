# Events and telemetry contract: Step verdicts

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it.

## Events added

None. `StepStatusChanged` is reused with a new *reason* text only (a verdict word, a step id and numbers, never
reply text):

| Transition | Reason |
| :--- | :--- |
| `VALIDATING` to `FAILED` (critique, sent back) | `critique sent the run back to "code" (iteration 1 of 3)` |
| `VALIDATING` to `ESCALATED` (limit reached) | `critique reached its limit of 3 iterations` |
| `VALIDATING` to `ESCALATED` (no `send_back_to`) | `critique escalates` |
| `VALIDATING` to `COMPLETED` (agreement) | none (as today) |

Step ids are restricted by the parser to `[A-Za-z0-9_-]+`, so a reason is safe to print.

## Spans and attributes

No new span. On the existing `step <id>` span:

| Attribute | Type | Value | Set when |
| :--- | :--- | :--- | :--- |
| `indaba.verdict` | string | `agreement` or `critique` | a valid verdict was read |
| `indaba.verdict.action` | string | `continue`, `send_back` or `escalate` | a valid verdict was read |
| `indaba.verdict.iteration` | number | how many times this step has sent the run back, 1-based | the action is `send_back`, or the limit was reached |
| `indaba.verdict.max_iterations` | number | the limit | `send_back_to` is set |
| `indaba.verdict.invalid` | string | `empty`, `missing`, `conflicting` or `too_long` | no usable verdict was found |

Never recorded: the critique text, any line of the reply, the target's prompt. A test asserts that no attribute
value on a review step contains text from the reply (the rule already in force: no transcript text in telemetry).

## Span status

Follows the step state (spec C-11): `ERROR` when the step moves to `FAILED` or `ESCALATED`, `OK` when it completes.
A step span that sent the run back carries `indaba.verdict.action = send_back`, which is how a reader tells a review
round from a crash.

## Ordering guarantees

The verdict attributes are set before the step span ends. `StepStatusChanged` for the verdict transition is
dispatched after the attributes are set and before the target's reset transitions, so a listener sees "returned a
verdict, then reset".

## Teardown

Nothing new. A cancelled run reads no verdict (AC-14), so no verdict attribute is set on a cancelled step.
