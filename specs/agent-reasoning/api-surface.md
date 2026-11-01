# API surface contract: Agent reasoning stream

> **Stage 3 contract.** Immutable during stage 6; an implementation that finds it wrong stops and returns to stage 3.

## Semver classification

**minor** (below 1.0).

Reasoning: every change is optional and additive. `RunRequest.onThought` is an optional callback, `TokenUsage` gains an
optional constructor parameter and property, `StepThought` is a new event class, `ThoughtRecord` is a new member of the
`RunRecord` union in `@indaba/engine` (whose wire format already documents that readers ignore unknown record types),
web-contract view types gain optional/additive fields, and `indaba watch` output is unchanged unless `--thoughts` is
given.

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core` (`runner/index.ts`) | field | `RunRequest.onThought?: (chunk: string) => void` |
| `@indaba/core` (`observability/index.ts`) | class | `StepThought { constructor(readonly traceId: string, readonly spanId: string, readonly seq: number, readonly text: string) }` |
| `@indaba/core` (`observability/index.ts`) | field | `TokenUsage.reasoningTokens?: number` |
| `@indaba/core` (`observability/index.ts`) | constant | `Tracer.ATTR_REASONING_TOKENS = 'indaba.usage.reasoning_tokens'` |
| `@indaba/core` (`observability/index.ts`) | constant | `Tracer.ATTR_THOUGHT_CHARS = 'indaba.thought.chars'` |
| `@indaba/core` (`web-contract/run.ts`, re-exported via `web-contract/index.ts`) | field | `AttemptView.thought?: string` (accumulated redacted thought text for the attempt, when present) |
| `@indaba/core` (`web-contract/run.ts`, re-exported via `web-contract/index.ts`) | field | `RunnerView.reasoningTokens?: number` (reasoning tokens reported for this runner span, when present) |
| `@indaba/core` (`web-contract/run.ts`, re-exported via `web-contract/index.ts`) | field | `StepView.thoughts: readonly string[]` (bounded lines of redacted thought text for the step) |
| `@indaba/core` (`web-contract/run.ts`, re-exported via `web-contract/index.ts`) | field | `StepView.partialThought: string` (trailing incomplete thought line) |
| `@indaba/core` (`web-contract/run.ts`, re-exported via `web-contract/index.ts`) | field | `RunSummaryOfUse.reasoningTokens: number \| null` (`null` when no span reported `reasoningTokens`, never `0`) |
| `@indaba/core` (`web-contract/run.ts`, re-exported via `web-contract/index.ts`) | union member | `RunStreamEvent` gains `{ readonly type: 'thought'; readonly spanId: string; readonly seq: number; readonly text: string; readonly cut: boolean }` |
| `@indaba/engine` (`trace/records.ts`) | interface | `ThoughtRecord { readonly type: 'thought'; readonly at: string; readonly traceId: string; readonly spanId: string; readonly seq: number; readonly text: string; readonly cut: boolean }` |
| `@indaba/engine` (`trace/event-writer.ts`) | method | `RunEventWriter.onThought(event: StepThought): Promise<void>` |
| `@indaba/engine` (`trace/plain.ts`) | field | `PlainOptions.thoughts?: boolean` |

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `TokenUsage.constructor` | `(inputTokens: number, outputTokens: number)` | `(inputTokens: number, outputTokens: number, reasoningTokens?: number)` | additive optional parameter; validates non-negative safe integer when defined |
| `RunRecord` (`@indaba/engine`) | `SpanStartedRecord \| SpanEndedRecord \| StepStatusRecord \| OutputRecord \| TruncatedRecord \| UnknownRecord` | adds `\| ThoughtRecord` | additive union member on event stream reader |
| `RunStreamEvent` (`@indaba/core`) | existing SSE stream event union | adds `\| { readonly type: 'thought'; ... }` | additive union member on web stream contract |

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow file | (none) | unchanged |
| span attributes | `indaba.usage.reasoning_tokens` | added when `TokenUsage.reasoningTokens` is defined |
| span attributes | `indaba.thought.chars` | added when at least one non-empty thought chunk was received |
| `<traceId>.events.jsonl` | record `type: "thought"` | added |
| CLI | `indaba watch --thoughts` | added (default off; in `--plain`, prints `[thought]` lines when enabled) |
| TUI / Web UI | step inspector reasoning section | collapsible plain-text reasoning section per attempt |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| `indaba watch --thoughts` | (none) | `false` |
| `PlainOptions.thoughts` | (none) | `false` |

## Checks

- [ ] Every type appearing in a new public signature is itself public (or deliberately marked `@internal` and not re-exported from the package index)
- [ ] Implementations are not exported for subclassing; the extension point is an interface
- [ ] Collections are typed precisely and read-only where they are not mutated (`readonly T[]`, `Readonly<Record<string, V>>`)
- [ ] `pnpm qa` (Biome, `tsc` strict, Vitest) passes with no suppression comment
