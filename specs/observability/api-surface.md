# API surface contract: Observability

> Written retroactively. Names are the intended public classes; signatures are to be confirmed
> against `src/Observability/` in review.

## Semver classification

**minor**: first public surface (below 1.0).

## Public symbols added

| Name (FQCN) | Kind | Notes |
| :--- | :--- | :--- |
| `Indaba\Observability\Tracer` | final class | starts traces and spans; takes a `Psr\Clock\ClockInterface`, an event dispatcher and a `PricingTable` |
| `Indaba\Observability\Span` | final class | attributes, events, status, timing |
| `Indaba\Observability\SpanStatus` | enum | outcome of a span |
| `Indaba\Observability\TokenUsage` | final readonly class | input and output tokens, reported or estimated |
| `Indaba\Observability\PricingTable` | final class | model to price per million tokens, with a dated source; `defaults()` |
| `Indaba\Observability\SpanStarted`, `SpanEnded` | event classes | PSR-14 events |
| `Indaba\Observability\JsonlSpanExporter` | final class | JSON Lines trace output |

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| events | `SpanStarted`, `SpanEnded` | added |
| attributes | see `events.md` | added |
| filesystem | `.indaba/traces/` | the trace location is part of the contract |

## Defaults introduced

To be filled from the code in review: the contents and date of `PricingTable::defaults()`, the trace
file naming. Prices change; updating the table is a patch, and says so in the changelog.

## Checks

- [ ] Every type in a public signature is public or deliberately `@internal`
- [ ] Attribute names follow the GenAI conventions where one exists
- [ ] A planted secret appears in no exported value (test)
- [ ] `composer stan` passes without an ignore
