# Events and telemetry contract: Observability

> Written retroactively. Attribute names below are the intended set; confirm them against
> `src/Observability/` and the engine in review, and correct this file to match the code.

## Events added

| Event class | Payload | Dispatched when |
| :--- | :--- | :--- |
| `Indaba\Observability\SpanStarted` | the span | a span starts |
| `Indaba\Observability\SpanEnded` | the span, with status and duration | a span ends |
| `Indaba\Workflow\State\StepStatusChanged` | step id, from, to | a step changes state (owned by workflow-engine) |

## Spans and attributes

| Span | Parent | Attributes |
| :--- | :--- | :--- |
| `indaba.task <workflow name>` | none (trace root) | `indaba.task.id`, `indaba.workflow.name` |
| a workflow step | the task span | step id, attempt number, status (`indaba.*`) |
| an LLM call | the step span | `gen_ai.*` (system, request model, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`), cost under `indaba.*` |
| a tool or shell verification | the step span | command name (not its arguments if they could hold a secret), exit code, duration |

## Ordering guarantees

An event is dispatched after the state it describes is true. `SpanEnded` follows every child's
`SpanEnded`. A listener sees spans in the order they started.

## Teardown

Spans left open by a cancelled run are ended with an error status by the engine's `finally`.
`JsonlSpanExporter` flushes on trace end.
