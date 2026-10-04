---
name: observability
description: Use when changing the tracer, spans, token usage, the pricing table or the event dispatcher, or when naming a span or attribute. Covers OpenTelemetry GenAI conventions, cost honesty and keeping secrets out of telemetry.
---

# Observability & Telemetry Specialist

Telemetry is a public contract: dashboards, alerts and cost reports are built on its names.

## Structure

A task is a **trace**; a workflow step is a **span**; an LLM call, a tool execution or a shell
verification is a **child span**. `Tracer` (`new Tracer(clock, events, ids, pricing?)`, in
`@indaba/core`) starts and ends spans with `startTrace`, `startSpan` and `endSpan` (all async,
because event dispatch is), `Span` holds attributes and its status, and the injected `Clock` and
`IdGenerator` make durations and ids testable. The JSONL exporter in `@indaba/engine` listens to
`SpanEnded` and writes `.indaba/traces/*.jsonl`.

## Attribute names

Follow the OpenTelemetry GenAI semantic conventions, which are still evolving: use the current
`gen_ai.*` names (`Tracer.ATTR_OPERATION`, `ATTR_PROVIDER`, `ATTR_MODEL`, `ATTR_INPUT_TOKENS`,
`ATTR_OUTPUT_TOKENS`) and check the convention's current page before adding one. Anything
Indaba-specific (step id, attempt number, cost: `indaba.cost.usd`) is namespaced `indaba.*` and
listed in the feature's `events.md`. A rename of a shipped attribute is a major. Do not invent a
`gen_ai.*` name the convention lacks.

## Tokens and cost

`TokenUsage` is a value class (input and output tokens). `PricingTable` maps a model to a rate per
million tokens, with a dated source, and `costUsd(model, usage)` returns `undefined` for an unknown
model.

- Unknown model, unknown price, unknown usage: report unknown, never zero. `recordUsage` sets the
  cost attribute only when a price is known.
- Cost = measured tokens x listed price, labelled with the table's date. Never display a total
  that mixes unknown into known without saying so.
- A JavaScript number is a double: do not sum cost across hundreds of calls without a rounding rule
  in the spec, and never print an unrounded float as if it were exact.

## Events

State changes and span lifecycle are events (`StepStatusChanged`, `SpanStarted`, `SpanEnded`)
dispatched through `EventDispatcher` from `@indaba/core`. `SimpleEventDispatcher` runs listeners
sequentially in registration order and isolates a failing listener (it is reported through a
callback, never thrown), which is how a CLI or an SSE endpoint streams a run live. Events are
immutable, carry ids and values rather than live handles, and are dispatched after the state they
describe is true. Listeners are added through `PluginHost.addListener`.

## Never in telemetry

Secrets, full prompts, full diffs and file contents do not go into attributes. Sizes, hashes and ids
do. Redaction is applied at the tracer boundary and tested with a planted secret.

## Volume

One span per step and per call. Streamed chunks update counters or a bounded event, never a span each.

## Testing

A `Tracer` with a fixed `Clock`, a counting `IdGenerator` and a `SimpleEventDispatcher` that collects
`SpanEnded`; assert the tree shape, attribute names, usage arithmetic and that a planted key never
appears in any exported value. Tests are in `packages/core/test/observability.test.ts` and
`packages/engine/test/observability.test.ts`.
