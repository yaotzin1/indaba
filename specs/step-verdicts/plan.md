# Plan: Step verdicts

## Modules touched

| Module | Change |
| :--- | :--- |
| `packages/core/src/workflow/model.ts` | `ReviewDefinition`, `StepDefinition.review`, `isReviewStep` |
| `packages/core/src/workflow/review.ts` (new) | the constants, `parseReview`, `reviewProtocolReminder` |
| `packages/core/src/observability/index.ts` | the five `ATTR_VERDICT*` constants on `Tracer` |
| `packages/engine/src/parser/parser.ts`, `validator.ts` | parse `review`; the errors in `api-surface.md` |
| `packages/engine/src/engine/outcome.ts` | `StepOutcome.verdict`, `okWithVerdict` |
| `packages/engine/src/engine/prompt-builder.ts` | the `## Verdict` section |
| `packages/engine/src/engine/step-executor.ts` | `runAgent` keeps the reply and, for a review step, parses it |
| `packages/engine/src/engine/workflow-engine.ts` | routing after `validate`; `reviewIterations` beside `retries` |
| `packages/cli/src/main.ts` (and the `plan` printer it calls) | the review lines and the loop bound |
| `docs/workflow-format.md`, `README.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md` | documentation moves with the change |

`packages/core/src/workflow/state.ts` and `packages/core/src/mesh/message.ts` are **not** touched: the transition
table already allows `VALIDATING` to `FAILED`, `ESCALATED` and `COMPLETED` and `FAILED` to `PENDING`, and the
mesh parser stays lenient on purpose (spec C-03).

## Where the verdict is read, and why there

`StepExecutor.run` returns before `validate`, and the runner's `RunResult.output` is gone after it returns, so
`runAgent` is the only place that has both the reply and the step. It parses the verdict there and carries it on the
`StepOutcome`. `WorkflowEngine.execute` then runs `validate` as today; only if that passes is the verdict routed.
That is the order AC-06 asks for, without a second output buffer.

Routing, in the engine, for an `ok` outcome carrying a verdict:

1. `agreement`: `VALIDATING` to `COMPLETED`, as today.
2. `critique` with `send_back_to`: `used = reviewIterations.get(stepId) ?? 0`. If `used < maxIterations`: move the
   step `VALIDATING` to `FAILED`, count one, set the target's feedback, reset the target and its descendants to
   `PENDING`, and jump to the target (the code path of an `on_failure` retry, extracted into one method both use).
   Otherwise move to `ESCALATED` and end the run `escalated`.
3. `critique` without `send_back_to`: move to `ESCALATED` and end the run `escalated`.

The `on_failure` path and the review path share the reset-and-jump method so the isolation rule (one feedback slot
per target, only the last reason) has one implementation.

## Alternatives considered

The carrier of the verdict (a file, a guard, a debate, an arbiter) is weighed in spec C-02. Also rejected:

- **A `loop` node**: spec C-01.
- **A new `StepStatus` such as `REVISE`**: the existing table already expresses "sent back" as `FAILED` then
  `PENDING`, and a new state would touch the TUI, the trace view and the event contract.
- **Folding review into `on_failure`**: a critique is not a failure and would share its counter (spec C-07).
- **Reusing the mesh parser for the gate**: it accepts replies a gate must refuse (spec C-03).
