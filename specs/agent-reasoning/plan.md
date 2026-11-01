# Plan: Agent reasoning stream

> Stage 3. Contract: [`api-surface.md`](api-surface.md). Behaviour: [`spec.md`](spec.md).

## Modules touched

| File | Change |
| :--- | :--- |
| `packages/core/src/runner/index.ts` | Add `readonly onThought?: (chunk: string) => void` to `RunRequest` |
| `packages/core/src/observability/index.ts` | Add `StepThought`, `TokenUsage.reasoningTokens` (validated as a non-negative safe integer when defined), `Tracer.ATTR_REASONING_TOKENS = 'indaba.usage.reasoning_tokens'`, `Tracer.ATTR_THOUGHT_CHARS = 'indaba.thought.chars'`, and set `ATTR_REASONING_TOKENS` in `Tracer.recordUsage` when `usage.reasoningTokens !== undefined` |
| `packages/core/src/web-contract/run.ts` | Add `thought?: string` to `AttemptView`, `reasoningTokens?: number` to `RunnerView`, `reasoningTokens: number \| null` to `RunSummaryOfUse`, `thoughts: readonly string[]` and `partialThought: string` to `StepView`, and `{ readonly type: 'thought'; readonly spanId: string; readonly seq: number; readonly text: string; readonly cut: boolean }` to `RunStreamEvent` (re-exported via `packages/core/src/web-contract/index.ts`) |
| `packages/core/src/index.ts` | Re-export `StepThought` from `./observability/index.js` |
| `packages/runners/src/acp-runner.ts` | Handle `case 'agent_thought_chunk':` in `AcpHandlers.notification` by forwarding non-empty `content.text` (`content.type === 'text'`) to `request.onThought?.(text)` without touching `output` or `request.onOutput` |
| `packages/runners/src/openrouter-runner.ts` | In `readStream`, extract non-empty string `delta.reasoning` (falling back to `delta.reasoning_content`) and pass to `request.onThought?.(reasoning)`; in `readUsage`, parse `completion_tokens_details.reasoning_tokens` (when a non-negative safe integer) into `new TokenUsage(input, output, reasoning)` |
| `packages/engine/src/engine/step-executor.ts` | Add `thoughtSink(request, span)` alongside `outputSink(request, span)` in `StepExecutor.invoke`: maintains a per-span `seq` starting at `0` and a raw `thoughtChars` counter, catches any exception thrown by `request.onThought` or `events.dispatch`, dispatches `new StepThought(span.traceId, span.spanId, seq++, chunk)` for non-empty chunks, and sets `Tracer.ATTR_THOUGHT_CHARS` on `span` before `endSpan` (both success and catch paths) when `thoughtChars > 0` |
| `packages/engine/src/trace/records.ts` | Add `ThoughtRecord`, extend `RunRecord` union, serialize and parse `type: 'thought'` in `serializeRecord` and `readRunRecord` |
| `packages/engine/src/trace/event-writer.ts` | Add `onThought(event: StepThought): Promise<void>` sharing `outputOfTrace` (`maxRunChars`) and `maxRecordChars` with `onOutput`, redacting before length checks |
| `packages/engine/src/trace/view.ts` | Handle `case 'thought':` in `reduceRun` (accumulating bounded lines on `StepView.thoughts` / `partialThought` and `AttemptView.thought`) and read `indaba.usage.reasoning_tokens` onto `RunnerView.reasoningTokens` in `endedSpan` |
| `packages/engine/src/trace/trace-reader.ts` | Sum `indaba.usage.reasoning_tokens` into `RunSummaryOfUse.reasoningTokens` (`null` when no span reported it, never `0`) |
| `packages/engine/src/trace/plain.ts` | Add `readonly thoughts?: boolean` to `PlainOptions`; when `true`, render each step's thought lines prefixed with `[thought] ` before output lines |
| `packages/engine/src/index.ts` | Re-export `ThoughtRecord` from `./trace/index.js` |
| `packages/cli/src/engine-factory.ts` | Register `StepThought` listener on `EventDispatcher` calling `eventWriter.onThought(event)` |
| `packages/cli/src/watch.ts` & `packages/cli/src/main.ts` | Parse `--thoughts` on `indaba watch` and pass `thoughts: true` to `PlainOptions` and the TUI watch view |
| `packages/tui/src/screen.ts` & `packages/tui/src/ink/view.ts` | Render a collapsible/distinct sanitized reasoning section when a step has thought lines |
| `packages/server/src/sse.ts` & `packages/web/src/ui/StepPanel.ts` | Forward `thought` stream events and render a collapsible plain-text `<details>` section in `StepPanel` |

## Where the behaviour lives

| Layer | Responsibility | Why there |
| :--- | :--- | :--- |
| Pure domain (`@indaba/core`) | `RunRequest.onThought`, `StepThought`, `TokenUsage.reasoningTokens`, `Tracer` attribute constants and `recordUsage`, web-contract types | Pure value types and contracts with zero `node:` imports or I/O |
| Runners (`@indaba/runners`) | Extracting `agent_thought_chunk` (ACP) and `delta.reasoning` / `completion_tokens_details.reasoning_tokens` (OpenRouter) | Transport-specific wire parsing belongs exclusively in the runner adapters |
| Engine (`@indaba/engine`) | `StepExecutor.invoke` (`thoughtSink` and `indaba.thought.chars`), `RunEventWriter.onThought`, `ThoughtRecord` serialization, `reduceRun` and `TraceReader` aggregation | Because `StepExecutor.invoke` wraps single-agent steps, retry attempts, and `RunnerParticipant` debate turns, wiring `thoughtSink` in `invoke` gives every agent call and debate turn its own `invoke_agent` span, `seq` counter and character count without touching `RunnerParticipant` |
| Console & Web (`indaba`, `@indaba/tui`, `@indaba/server`, `@indaba/web`) | Wiring `StepThought` to `RunEventWriter.onThought` in `engine-factory.ts`, `--thoughts` CLI flag, TUI and web collapsible view | Composition root and presentation |

## Trade-offs taken

- **Shared `maxRunChars` budget between `output` and `thought` in `RunEventWriter`.** A separate 2 MiB budget would double the worst-case size of `<traceId>.events.jsonl`. Sharing `outputOfTrace` guarantees the file never exceeds `maxRunChars` plus one `truncated` record.
- **Per-chunk redaction in `RunEventWriter.onThought` (matching `onOutput`).** Buffering an entire span's reasoning in memory before writing to `<traceId>.events.jsonl` would break live streaming in `indaba watch` and `indaba ui`. Per-chunk redaction matches `onOutput`, and all front ends read exclusively from `<traceId>.events.jsonl` so no unredacted live callback reaches a screen.
- **Wiring `thoughtSink` inside `StepExecutor.invoke` rather than `RunnerParticipant`.** `RunnerParticipant` is already called through an `invoke` callback supplied by `StepExecutor.runConsensus` that delegates to `StepExecutor.invoke`. Putting `thoughtSink` in `StepExecutor.invoke` keeps `RunnerParticipant` pure and guarantees identical tracing for single steps, retry attempts, debate turns, and plugin runners.

## Risks

| Risk | Mitigation |
| :--- | :--- |
| Reasoning text accidentally enters `RunResult.output` and triggers `AGREEMENT:`, `CRITIQUE:`, or `BOARD ` | `AcpRunner` and `OpenRouterRunner` route thought chunks only to `request.onThought`; dedicated hostile-input test in `packages/engine/test/` emits `AGREEMENT:` and `BOARD result:` on `onThought` and verifies zero effect on debates and board |
| Reasoning tokens double-counted in USD cost | `PricingTable.costUsd` uses only `usage.inputTokens` and `usage.outputTokens`; fixture test verifies cost is unchanged when `reasoningTokens` is present |
| Empty string chunks (`""`) inflating `seq` or `indaba.thought.chars` | Both the runners and `StepExecutor.thoughtSink` ignore `chunk === ''`; `indaba.thought.chars` is only set when `thoughtChars > 0` |
| A throwing `onThought` callback or `StepThought` listener aborts the step | `thoughtSink` wraps `request.onThought` and `events.dispatch` in `try/catch` (and `.catch(() => undefined)`), so an observer failure never fails the step |
| Unbounded memory growth in `StepView` when watching a long reasoning stream | `appendThought` in `packages/engine/src/trace/view.ts` applies the same `MAX_OUTPUT_LINES` (500) and `MAX_LINE_CHARS` (2000) ring-buffer bounds as `appendOutput` |

## Analysis (stage 5)

| Check | Result |
| :--- | :--- |
| Published signature broken? | No. Every addition is optional (`onThought?`, `reasoningTokens?`, `PlainOptions.thoughts?`, additive union members). Semver: `minor` (below 1.0). |
| `node:` import in `@indaba/core`? | No. `StepThought`, `TokenUsage` and `RunRequest` use only TypeScript primitives. |
| New runtime dependency? | None. |
| Untrusted data to shell, path, URL or log? | Reasoning text never reaches a shell, path, URL, span attribute, board parser, or debate parser. It is redacted by `createRedactor` before entering `<traceId>.events.jsonl` and sanitized (`sanitize()`) before terminal display; in `@indaba/web` it is rendered as plain text nodes, never `innerHTML`. |
| Wall clock, randomness, environment in decision logic? | None. `RunEventWriter.onThought` uses the injected `Clock`. |
| Unbounded loop or buffer? | Bounded at every layer: `maxRecordChars` (4096) per record, `maxRunChars` (2 MiB) per run in `RunEventWriter`, and `MAX_OUTPUT_LINES` (500) × `MAX_LINE_CHARS` (2000) in `RunState`. |
| Retry-loop isolation preserved? | Yes. `PromptBuilder.build` receives only `step`, `options.feedback` (derived from `result.failureText()`, which reads `errorOutput` / `output`), and the board digest. Thought chunks are never stored on `RunResult`, and each retry attempt gets a fresh `invoke_agent` span and `seq = 0`. |

## Out of scope for this change

- Workflow fields to configure model reasoning effort or thinking token budgets (`thinking.budget_tokens`, `reasoning_effort`).
- Parsing `BOARD` lines, debate keywords, or `FINDING` lines from reasoning text.
- Extracting thinking blocks from CLI stdout scrapers (`claude-code`, `codex`, `cursor`, `antigravity`, `opencode`).
