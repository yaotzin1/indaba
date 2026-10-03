---
name: observability
description: Use when changing the tracer, spans, token usage, the pricing table or PSR-14 events, or when naming a span or attribute. Covers OpenTelemetry GenAI conventions, cost honesty and keeping secrets out of telemetry.
---

# Observability & Telemetry Specialist

Telemetry is a public contract: dashboards, alerts and cost reports are built on its names.

## Structure

A task is a **trace**; a workflow step is a **span**; an LLM call, a tool execution or a shell
verification is a **child span**. `Observability\Tracer` starts and ends spans, `Span` holds
attributes and events and its status, and a tracer takes the injected clock so durations are testable.

## Attribute names

Follow the OpenTelemetry GenAI semantic conventions, which are still evolving: use the current
`gen_ai.*` names (operation name, system or provider, request model, response model,
`gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`) and check the convention's current page
before adding one. Anything Indaba-specific (step id, attempt number, cost) is namespaced `indaba.*`
and listed in the feature's `events.md`. A rename of a shipped attribute is a major. Do not invent a
`gen_ai.*` name the convention lacks.

## Tokens and cost

`TokenUsage` is a value object: input, output, and optionally cached or reasoning tokens, and a flag
saying whether the numbers were **reported by the provider** or **estimated**. `PricingTable` maps a
model to prices per million tokens with a dated source.

- Unknown model, unknown price, unknown usage: report unknown, never zero.
- Cost = measured tokens x listed price, labelled with the table's date. Never display a total
  that mixes unknown into known without saying so.
- Money is an integer in the smallest unit or a decimal string, never a float sum across hundreds of
  calls without a rounding rule in the spec.

## Events

State changes and runner output are PSR-14 events through the injected event dispatcher
(`symfony/event-dispatcher`), which is how a console or an SSE endpoint streams a run live. Events are
immutable, carry ids not objects, and are dispatched after the state they describe is true.

## Never in telemetry

Secrets, full prompts, full diffs and file contents do not go into attributes. Sizes, hashes and ids
do. Redaction is applied at the tracer boundary and tested with a planted secret.

## Volume

One span per step and per call. Streamed chunks update counters or a bounded event, never a span each.

## Testing

A tracer with a `MockClock` and an in-memory exporter; assert the tree shape, attribute names, usage
arithmetic and that a planted key never appears in any exported value.
