# Events and telemetry contract: Budgets

Names and values here are public contract once released. Only numbers, scope and limit names, step ids, task
ids, short enumerated words and relative paths are carried. No prompt, output, runner message, transcript,
environment value or secret appears in any of them. A source `reason` is the one piece of free text; it is cut
to 300 characters and cleaned before it is used.

## Events added (`@indaba/core`)

| Event class | Payload | Dispatched when |
| :--- | :--- | :--- |
| `BudgetExceeded` | task id, step id, scope, limit, spent, cap, `final` | a cap is reached and the in-flight call has been asked to stop; before the question is asked |
| `BudgetResolved` | task id, step id, decision (`stop`, `resume`, `unanswered`), mode (`raise_to`, `add`, `one_call`) for a resume | the question is settled, before the step is repeated or ended |

## Event-stream records (`.indaba/traces/<traceId>.events.jsonl`)

```json
{ "type": "budget_requested", "at": "2026-10-10T09:00:00.000Z", "traceId": "…", "id": "bud-1a2b3c4d", "stepId": "review", "scope": "step", "limit": "max_cost_usd", "spent": 0.5012, "cap": 0.5 }
{ "type": "budget_answered",  "at": "2026-10-10T09:01:30.000Z", "traceId": "…", "id": "bud-1a2b3c4d", "decision": "resume", "mode": "add" }
```

A reader that does not know these treats them as unknown records and skips them (a test feeds it one). The `id`
is the one a file channel would use for `.indaba/rulings/<id>.request.json` (spec section 8, item 11).

## Spans and attributes

| Span | Attribute | Type | Written when |
| :--- | :--- | :--- | :--- |
| step span (`step <id>`) | `indaba.budget.max_cost_usd`, `indaba.budget.max_tokens` | number | the cap applies to the step (the effective value, after any grant) |
| step span | `indaba.budget.spent_usd` | number | a cost cap applies and at least one call reported a cost; **absent** otherwise, never `0` for unknown |
| step span | `indaba.budget.spent_tokens` | number | a token cap applies and at least one call reported tokens; absent otherwise |
| step span | `indaba.budget.unmetered_calls`, `indaba.budget.estimated_calls` | number | at least one such call; absent otherwise |
| step span | `indaba.budget.resumes` | number | the step was resumed at least once |
| task span (`indaba.task <name>`) | the same names, with the run's totals | | a run cap applies |
| task span | `indaba.budget.exceeded_scope`, `indaba.budget.exceeded_limit` | string | a budget ended the run |
| task span | `indaba.budget.resumed_from` | string | this run was started with `--resume`: the earlier run's trace id |
| task span | `indaba.budget.kept` | boolean | work was kept and a resume file written |
| call span | `indaba.metering.kind`, `indaba.metering.basis` | string | always: `metered`, `unmetered`, `none`; `reported` or `estimated` |
| call span | `indaba.metering.reason` | string | the call was `unmetered`: the cleaned, bounded reason |

The existing `indaba.cost.usd` and `gen_ai.usage.*` attributes on a call span are unchanged; the budget
attributes are sums over them. A step with no budget, run with only metered or `free` sources, gets none of the
step attributes; the call-span `indaba.metering.*` attributes are new on every agent call.

## Span events

| Event | On | Attributes |
| :--- | :--- | :--- |
| `indaba.budget.exceeded` | the step span | `indaba.budget.scope`, `.limit`, `.spent`, `.cap`, `.final` |
| `indaba.budget.resolved` | the step span | `indaba.budget.decision`, `indaba.budget.mode` (resume only), `indaba.budget.channel` (`terminal`, `files`, `none`, or a plugin resolver's name) |
| `indaba.budget.kept` | the step span | `indaba.budget.workspace` (relative path), `indaba.budget.reason` (`unanswered`, `final_cap`, `resume_limit`, `cancelled`) |
| `indaba.budget.observation_ignored` | the call span | `indaba.budget.field` (`tokens` or `cost_usd`), `indaba.budget.reason` (`negative`, `not_finite`, `decreased`); once per call and field, never the offending value |
| `indaba.metering.gap` | the call span | `indaba.metering.source`: a capability declared `metered` reported no figure |

## Ordering guarantees

`BudgetExceeded` is dispatched after the in-flight call was asked to stop and before the question is asked.
`BudgetResolved` follows the answer and precedes the repeated call or the step's end. While the question is open
the step is `RUNNING`; `StepStatusChanged` to `ESCALATED` follows `BudgetResolved` (`stop` or `unanswered`).
The step attributes are written when the step span ends, from the same meter the verdict came from.
`budget_requested` precedes `budget_answered` for the same `id`; a cancelled run writes only the first.

## Teardown

A stopped call's span ends with an error status and the abort reason. On a kept ending the run's spans end as for
any escalated or cancelled run, and the working directory is **not** destroyed (the one change to "torn down
however the run ends"); every other ending tears down as before. Nothing here is written after the trace is
closed.
