# Specification: Observability

> **Superseded implementation language.** This spec was written for the PHP prototype, which was never
> published. Behaviour is unchanged by the TypeScript port; class, method and field names follow
> [`specs/typescript-port/api-surface.md`](../typescript-port/api-surface.md) (for example
> `RunnerInterface` is `Runner`, `*Exception` is `*Error`, fields are camelCase). Where this text names a
> PHP, Composer, Symfony or Docker detail, read the Node and TypeScript equivalent.

> **Status**: Implemented in the initial commit; specified retroactively from `docs/vision.md`
> section 3E. Treat as a description to be corrected by review.
> **Stage entry**: 1 (retroactive)
> **Semver impact**: minor (first public surface; below 1.0)

---

## 1. The problem

A multi-agent run is expensive and opaque. The person running it needs to see which step is doing
what, how many tokens each call used, what it cost, and how long it took, live, and afterwards in a
form their existing tooling can read.

## 2. User stories

- **US-01.** As a person running a workflow, I see per-step and per-call timing, tokens and cost.
- **US-02.** As a developer embedding Indaba, I receive PSR-14 events as spans start and end, to
  stream them to a UI.
- **US-03.** As an operator, I can read the trace of a finished task as JSON Lines.

## 3. Acceptance criteria

- [ ] A task is a trace, a workflow step a span, an LLM call, tool execution or shell verification a
      child span.
- [ ] Attribute names follow the OpenTelemetry GenAI semantic conventions where one exists
      (`gen_ai.*`); Indaba's own use `indaba.*`.
- [ ] `TokenUsage` records input and output tokens and whether they were reported or estimated.
- [ ] `PricingTable` prices by model; an unknown model yields unknown cost, not zero.
- [ ] `Tracer` takes an injected clock; durations are testable.
- [ ] `SpanStarted` and `SpanEnded` are dispatched through the injected event dispatcher.
- [ ] No secret, full prompt or full diff appears in an attribute or event.

## 4. Non-goals

- Shipping an OTLP exporter or depending on the OpenTelemetry SDK (the attribute names are aligned;
  the wire protocol is a later, separate decision).
- A hosted dashboard. A streaming transport (SSE, Mercure, WebSockets) is for a consumer to build on
  the events.
- Per-chunk spans.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the provider reports no usage | `TokenUsage` is absent or flagged unknown; cost is unknown |
| a span is never ended (run killed) | the exporter does not report it as completed |
| an event listener throws | the run continues; the failure is not swallowed silently |

## 6. Security and data handling

Redaction applies at the tracer boundary. Sizes, hashes and ids go into attributes, not payloads.
See `.agents/skills/observability/SKILL.md`.

## 7. Where it lives

`src/Observability/`, infrastructure. It depends on `Psr\Clock\ClockInterface` and the event
dispatcher interface.

## 8. Clarifications

The GenAI conventions are still developing; the exact attribute set in use is recorded in
`events.md` and is a major to change.

## Artifacts not written

- `plan.md`: retroactive spec.
- `research.md`: no options were recorded at the time.
- `data-model.md`: the value objects are listed in api-surface.md; there is no state machine.
- `tasks.md`: the work is done.
