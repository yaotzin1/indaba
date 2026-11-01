# Tasks: Agent reasoning stream

Ordered by dependency. Domain first, infrastructure second, console and documentation last. Each
task is independently checkable; run `pnpm qa` after each group.

## Domain (`@indaba/core`)

- [ ] **T-01** Add `readonly onThought?: (chunk: string) => void` to `RunRequest` in `packages/core/src/runner/index.ts`.
- [ ] **T-02** In `packages/core/src/observability/index.ts` (and re-export `StepThought` from `packages/core/src/index.ts`):
  - Add `StepThought(traceId, spanId, seq, text)`.
  - Extend `TokenUsage` with optional `readonly reasoningTokens?: number`, validating in the constructor that when defined it is a non-negative safe integer (`Number.isSafeInteger(reasoningTokens) && reasoningTokens >= 0`, throwing `RangeError` otherwise).
  - Add `Tracer.ATTR_REASONING_TOKENS = 'indaba.usage.reasoning_tokens'` and `Tracer.ATTR_THOUGHT_CHARS = 'indaba.thought.chars'`.
  - Update `Tracer.recordUsage` to set `Tracer.ATTR_REASONING_TOKENS` when `usage.reasoningTokens !== undefined`.
  - Unit tests in `packages/core/test/observability.test.ts`: valid `reasoningTokens` (`0`, `500`), `undefined` omitted from span attributes, negative / float / `NaN` throws `RangeError`, and `PricingTable.costUsd` computes cost from `outputTokens` only without double-charging `reasoningTokens`.
- [ ] **T-03** Extend web-contract types in `packages/core/src/web-contract/run.ts` (re-exported via `packages/core/src/web-contract/index.ts` and `packages/core/src/index.ts`):
  - `AttemptView.thought?: string`, `RunnerView.reasoningTokens?: number`, `RunSummaryOfUse.reasoningTokens: number | null`, `StepView.thoughts: readonly string[]`, `StepView.partialThought: string`, and `{ readonly type: 'thought'; readonly spanId: string; readonly seq: number; readonly text: string; readonly cut: boolean }` on `RunStreamEvent`.
  - Verify `packages/core/test/architecture.test.ts` passes with zero `node:` imports.

## Infrastructure (`@indaba/runners` and `@indaba/engine`)

- [ ] **T-04** Update `AcpRunner` (`packages/runners/src/acp-runner.ts`):
  - Handle `case 'agent_thought_chunk':` in `session/update` notifications: when `content` is a record with `type === 'text'` and non-empty string `text`, call `request.onThought?.(text)`.
  - Update `packages/runners/test/acp-runner.test.ts` to assert `agent_thought_chunk` is delivered to `onThought`, never calls `onOutput`, and leaves `result.output` byte-for-byte unchanged (AC-02).
- [ ] **T-05** Update `OpenRouterRunner` (`packages/runners/src/openrouter-runner.ts`):
  - In `readStream`, extract non-empty string `delta.reasoning` (or `delta.reasoning_content` when `delta.reasoning` is absent) and call `request.onThought?.(reasoning)`.
  - In `readUsage`, read `usage.completion_tokens_details?.reasoning_tokens`; when it is a non-negative safe integer, pass it as the 3rd argument to `new TokenUsage(input, output, reasoning)`. Ignore negative or non-integer values.
  - Update `packages/runners/test/openrouter.test.ts` with fixtures covering `delta.reasoning`, `delta.reasoning_content`, valid `reasoning_tokens`, invalid `reasoning_tokens` (`-1`, `1.5`, `"bad"`), fixture-based cost calculation (`PricingTable.costUsd` uses `outputTokens` only), and asserting `result.output` is byte-for-byte unchanged (AC-03, AC-09).
- [ ] **T-06** Update `packages/engine/src/trace/records.ts` and `packages/engine/src/trace/event-writer.ts` (and re-export `ThoughtRecord` from `packages/engine/src/index.ts`):
  - Add `ThoughtRecord` (`type: 'thought'`), serialize and parse it in `serializeRecord` and `readRunRecord`.
  - Add `RunEventWriter.onThought(event: StepThought): Promise<void>` using `this.redact(event.text)` before measuring length against `maxRecordChars` (`cut: true` when sliced) and shared `outputOfTrace` (`maxRunChars`, writing one `truncated` record and stopping both `onOutput` and `onThought` when exceeded).
  - Unit tests in `packages/engine/test/run-event-writer.test.ts`: normal thought record, `cut: true` when exceeding `maxRecordChars`, shared `maxRunChars` budget across `onOutput` and `onThought`, redactor applied before length check, and redactor throwing drops chunk and calls `onError` once (AC-06, AC-07).
  - Unit tests in `packages/engine/test/trace-reader.test.ts`: `readRunRecord` parses `type: 'thought'` into `ThoughtRecord`, and unknown record types remain `UnknownRecord` without throwing (AC-10).
- [ ] **T-07** Wire `thoughtSink` in `StepExecutor.invoke` (`packages/engine/src/engine/step-executor.ts`):
  - Maintain per-span `seq = 0` and raw `thoughtChars = 0` for each `invoke` call.
  - Ignore empty chunks (`chunk === ''`); for non-empty chunks, increment `thoughtChars += chunk.length`, call `request.onThought?.(chunk)` and `events.dispatch(new StepThought(span.traceId, span.spanId, seq++, chunk))` inside a `try/catch` (and `.catch(() => undefined)`) so a throwing callback or listener never fails the step.
  - In both normal completion and error/abort `catch` before `this.tracer.endSpan(span, ...)`, set `span.setAttribute(Tracer.ATTR_THOUGHT_CHARS, thoughtChars)` when `thoughtChars > 0`.
  - Tests in `packages/engine/test/run-event-stream.test.ts`:
    - single-agent step records `StepThought` and `indaba.thought.chars`, and no span attribute contains thought text (AC-05, AC-08);
    - multi-round debate via `RunnerParticipant` gives each turn its own `invoke_agent` `spanId` and `seq` starting at `0` (AC-05);
    - plugin `Runner` parity calling only `RunRequest.onThought` produces identical events and records (AC-01, US-04);
    - hostile-input isolation (`BOARD result:` and `AGREEMENT:` in `onThought` ignored by board and debate) (AC-04);
    - retry-loop isolation (thoughts from failed attempt 1 absent from attempt 2's prompt, and attempt 2 gets a fresh `invoke_agent` span with `seq = 0`) (AC-04);
    - throwing `onThought` or `StepThought` listener does not fail the step (spec §5).
- [ ] **T-08** Update `packages/engine/src/trace/view.ts`, `packages/engine/src/trace/trace-reader.ts`, and `packages/engine/src/trace/plain.ts`:
  - In `view.ts`, reduce `thought` records into `StepView.thoughts` / `partialThought` (bounded by `MAX_OUTPUT_LINES` and `MAX_LINE_CHARS`) and `AttemptView.thought`, and read `indaba.usage.reasoning_tokens` onto `RunnerView.reasoningTokens`.
  - In `trace-reader.ts`, aggregate `indaba.usage.reasoning_tokens` into `RunSummaryOfUse.reasoningTokens`: sum values across spans that reported it, and set `null` (never `0`) when no span reported it (AC-09).
  - In `plain.ts`, add `thoughts?: boolean` to `PlainOptions`; when `true`, format thought lines with `[thought] ` prefix (sanitized via `sanitize()`), and keep default `PlainOptions` output byte-for-byte unchanged.
  - Unit tests in `packages/engine/test/trace-reader.test.ts` (for `RunSummaryOfUse.reasoningTokens` sum and `null`-not-`0`, plus `plain.ts` with `thoughts: false` vs `thoughts: true`, AC-09, AC-11).

## Console and Web (`indaba`, `@indaba/tui`, `@indaba/server`, `@indaba/web`)

- [ ] **T-09** In `packages/cli/src/engine-factory.ts`, register `events.addListener(StepThought, (e) => writer.onThought(e))`. In `packages/cli/src/watch.ts` and `packages/cli/src/main.ts`, add `--thoughts` to `indaba watch` and pass `thoughts: true` to `PlainOptions`. Tests in `packages/cli/test/watch.test.ts` covering CLI `--thoughts` flag parsing and `watch --plain` vs `watch --plain --thoughts` reading from `<traceId>.events.jsonl` (AC-11).
- [ ] **T-10a** In `@indaba/tui` (`packages/tui/src/screen.ts`, `packages/tui/src/ink/view.ts`), render a collapsible/distinct reasoning section sanitized of control characters (`sanitize()`) when a step has thought lines from `<traceId>.events.jsonl`. Tests in `packages/tui/test/watch.test.ts` (AC-11).
- [ ] **T-10b** In `@indaba/server` (`packages/server/src/sse.ts`), forward `thought` records from `<traceId>.events.jsonl` as `{ type: 'thought', ... }` SSE events and include `thoughts` / `reasoningTokens` in run snapshots. Tests in `packages/server/test/streams.test.ts` (AC-11).
- [ ] **T-10c** In `@indaba/web` (`packages/web/src/ui/StepPanel.ts` and `packages/web/src/sse.ts`), handle `thought` SSE events and render a collapsible plain-text `<details>` section per attempt (stripping control characters, never using `innerHTML`). Tests in `packages/web/` / `packages/server/test/hostile.test.ts` (AC-11).

## Documentation and Stage 7 Verification

- [ ] **T-11** Update `docs/getting-started.md`, `docs/playbook.md`, `docs/ai-playbook.md` (`type: "thought"` in `<id>.events.jsonl` and `indaba watch --thoughts`), `docs/extending.md` (`RunRequest.onThought`), `docs/logging.md` (documenting the per-chunk streaming redaction boundary limitation from spec §6.2), `CHANGELOG.md` (under `Unreleased`), and `specs/DEPENDENCY_MAP.md`.
- [ ] **T-12** Run `pnpm qa`, `pnpm e2e`, and all node gates (`node scripts/check-workflow.mjs`, `node scripts/security-audit.mjs --source`, `node scripts/build-site.mjs --check`); record actual output in `specs/agent-reasoning/review.md`.
