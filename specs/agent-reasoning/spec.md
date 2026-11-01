# Specification: Agent reasoning stream (Chain-of-Thought observability)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 4 (specified, clarified, planned and broken into tasks; ready for stage 5/6)
> **Semver impact**: minor (optional callback on `RunRequest`, optional field on `TokenUsage`, a new event class, a new event-stream record type, new span attributes, additive web-contract fields; nothing existing changes; below 1.0). Confirmed in `api-surface.md`.
> **Builds on**: [`specs/observability`](../observability/spec.md), [`specs/runner-adapters`](../runner-adapters/spec.md), [`specs/run-blackboard`](../run-blackboard/spec.md).

---

## 1. The problem

When an agent makes a bad decision, stalls in a debate, or edits the wrong file before a guard stops it, the person
watching or debugging the run wants to know *why* the model chose that path. Two of Indaba's primary transports already
deliver the model's reasoning stream:

- Over ACP, the agent sends `session/update` notifications with `sessionUpdate: "agent_thought_chunk"`.
- Over OpenRouter (and compatible SSE endpoints), reasoning models stream `delta.reasoning` (or
  `delta.reasoning_content`) and report `completion_tokens_details.reasoning_tokens`.

Today both runners silently drop these chunks (`acp-runner.ts` ignores `agent_thought_chunk`; `openrouter-runner.ts`
ignores `delta.reasoning`). They cannot simply be appended to `RunResult.output` or `request.onOutput`: Indaba parses
`RunResult.output` for protocol lines (`AGREEMENT:`, `CRITIQUE:`, `PROPOSAL:` in debates, and `BOARD <kind>:` posts for
the run board). If raw reasoning entered `output`, a model thinking *"Should I start with AGREEMENT: or CRITIQUE:?"*
or drafting a `BOARD fact:` line in its scratchpad would trigger a false consensus vote or pollute the run board.

Because there is no separate channel for reasoning, a person debugging a run has no visibility into the model's
Chain-of-Thought, and token accounting cannot show how much of `output_tokens` was spent on hidden reasoning.

## 2. User stories

- **US-01.** As a person watching or debugging a run (`indaba watch`, `indaba ui`, or the TUI), I want to see what an
  agent is thinking as a stream distinct from its final reply, so I can tell why it chose an approach or why it is
  taking time before any output appears.
- **US-02.** As a workflow author using debates (`consensus_with`) and the run board (`board.post`), I want reasoning
  tokens to be strictly isolated from `RunResult.output`, so a model's internal deliberation never triggers
  `AGREEMENT:`, `CRITIQUE:` or `BOARD ` parsing.
- **US-03.** As a developer tracking run costs and token budgets, I want reasoning token counts recorded on the step's
  span when the provider reports them, without guessing or inventing zero when it does not.
- **US-04.** As a plugin author writing a custom `Runner`, I want to emit reasoning chunks through `RunRequest` using
  the same callback built-in runners use.

## 3. Acceptance criteria

- [ ] AC-01. `RunRequest` gains an optional `onThought?: (chunk: string) => void` callback. Calling `onThought` never
  appends to `RunResult.output` and never calls `onOutput`. A plugin `Runner` that calls `request.onThought?.(chunk)`
  produces the exact same `StepThought` events, `thought` records and `indaba.thought.chars` span attribute as a
  built-in runner (verified by a plugin-parity test).
- [ ] AC-02. `AcpRunner` forwards the text of `sessionUpdate: "agent_thought_chunk"` (when `content.type === "text"` and
  `content.text` is non-empty) to `request.onThought?.(text)`. `RunResult.output` remains byte-for-byte unchanged.
- [ ] AC-03. `OpenRouterRunner` forwards non-empty string values of `delta.reasoning` (and `delta.reasoning_content` when
  `delta.reasoning` is absent) from SSE chunks to `request.onThought?.(text)`. `RunResult.output` remains byte-for-byte
  unchanged.
- [ ] AC-04. **Protocol and retry isolation.** Neither `parseBoardLines`, `RunnerParticipant`, any guard, nor retry
  prompt construction reads reasoning chunks. A test where a runner emits `BOARD result: injected` and
  `AGREEMENT: injected` via `onThought` and `CRITIQUE: real` via `onOutput` asserts that the board receives nothing
  from `onThought` and the debate records `CRITIQUE`. A second test asserts that when a step fails and is retried via
  `on_failure: { action: "retry_step" }`, reasoning chunks from the failed attempt never appear in the retry prompt
  (which carries only the last failure), and the retry attempt gets a fresh `invoke_agent` span with `seq` starting at
  `0`.
- [ ] AC-05. For each non-empty chunk passed to `onThought`, `StepExecutor.invoke` dispatches a
  `StepThought(traceId, spanId, seq, text)` event through `EventDispatcher`. Every `invoke_agent` span—a single agent
  step, a retry attempt, and each debate turn invoked through `RunnerParticipant`—maintains its own `seq` counter
  starting at `0`, independent of `StepOutput.seq`, and stamps `StepThought` with that `invoke_agent` span's `traceId`
  and `spanId`. A throwing `request.onThought` callback or `StepThought` event listener is caught and never fails the
  step.
- [ ] AC-06. `RunEventWriter.onThought(event: StepThought)` writes a `thought` record (`type: "thought"`, `at`,
  `traceId`, `spanId`, `seq`, `text`, `cut`) to `<traceId>.events.jsonl`. The chunk is redacted with the writer's
  `redact` function before its length is measured against `maxRecordChars` or `maxRunChars`; if `redact` throws, the
  chunk is dropped and `onError` is called once, matching `onOutput`.
- [ ] AC-07. **Bounds and `cut` semantics.** Reasoning records in `<traceId>.events.jsonl` use the redacted text length
  and follow the same bounding rules as `OutputRecord`:
  - `cut` is `true` when the redacted chunk's length exceeds `maxRecordChars` (default 4096) and its stored `text` was
    sliced to `maxRecordChars` characters; otherwise `cut` is `false`.
  - `thought` and `output` records share the per-run `maxRunChars` budget (default 2 MiB): when `state.chars +
    redacted.length > maxRunChars`, the chunk is not written, `state.stopped` becomes `true`, one `truncated` record is
    written for the trace, and both `onOutput` and `onThought` write nothing further for that trace.
- [ ] AC-08. When an `invoke_agent` span ends, `StepExecutor.invoke` sets `indaba.thought.chars` on that span to the
  raw, pre-redaction character count of reasoning chunks received during that span, computed by the engine (never by
  `RunEventWriter`), and only when at least one non-empty thought chunk was received (never `0` when the runner emitted
  none). No reasoning text is ever placed in a span attribute or span event in `<traceId>.jsonl`.
- [ ] AC-09. `TokenUsage` gains an optional `reasoningTokens?: number`, validated in `TokenUsage`'s constructor as a
  non-negative safe integer when defined (throwing `RangeError` otherwise, matching token count invariants).
  - When `OpenRouterRunner` receives `usage.completion_tokens_details.reasoning_tokens` as a non-negative integer, it
    passes it to `TokenUsage`.
  - When `usage.reasoningTokens` is defined, `Tracer.recordUsage` sets `indaba.usage.reasoning_tokens` on the span.
  - `gen_ai.usage.output_tokens` continues to record the provider's `completion_tokens` unchanged, and a fixture-based
    test asserts that `PricingTable.costUsd` computes output cost from `outputTokens` alone without adding
    `reasoningTokens` a second time.
  - When usage is aggregated across steps or attempts in `TraceReader` (`RunSummaryOfUse.reasoningTokens`), it sums the
    values of spans that reported `indaba.usage.reasoning_tokens`, and is `null` (never `0`) when no span in the run
    reported it.
- [ ] AC-10. `readRunRecord` in `@indaba/engine` parses `type: "thought"` lines into `ThoughtRecord`; older readers
  already treat unknown record types as `UnknownRecord` without failing.
- [ ] AC-11. Every front end (`indaba watch`, `@indaba/tui`, `@indaba/server` / `@indaba/web`) reads reasoning exclusively
  from `<traceId>.events.jsonl` (never from an unredacted in-memory callback):
  - `indaba watch --plain` omits `thought` records by default and prints them (prefixed with `[thought]`) only when
    `--thoughts` is also passed.
  - In the interactive `indaba watch` / TUI and in `indaba ui`, a step's reasoning is rendered as plain text (sanitized
    of control characters, never rendered as HTML) in a collapsible section separate from the step's output.

## 4. Non-goals

- Requesting or forcing a model to use extended thinking (e.g. setting `thinking.budget_tokens` or `reasoning_effort` in
  the workflow file). Model parameters belong to role configuration in a separate specification.
- Parsing structured commands, verdicts, findings or board posts out of reasoning text. Reasoning is diagnostic only and
  has zero effect on workflow control flow.
- Storing reasoning text in OpenTelemetry spans (`<traceId>.jsonl`) or in the committed decision ledger
  (`.indaba-decisions/`).
- Scraping "thinking" blocks from CLI terminal output (`claude-code`, `codex`, `cursor`, `antigravity`, `opencode`) via
  fragile regexes. Only runners with a structured reasoning field (`acp`, `openrouter`, or a plugin runner) emit
  `onThought`.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the runner emits no reasoning chunks | `onThought` is never called, no `thought` records are written, and `indaba.thought.chars` is absent on the span |
| `request.onThought` or a `StepThought` listener throws | caught in `StepExecutor.invoke`; the runner call and the step continue unaffected |
| `redact` throws on a thought chunk | the chunk is not written to `<traceId>.events.jsonl`, `onError` is called once, and the run continues |
| combined redacted `output` and `thought` exceed `maxRunChars` | one `truncated` record is written to `<traceId>.events.jsonl`; that chunk and subsequent chunks are dropped from the file without failing the step |
| the step times out or is cancelled mid-thought | chunks emitted before abort remain in `<traceId>.events.jsonl` for post-mortem inspection; `indaba.thought.chars` is recorded on the span if `> 0`; the span ends with its failure/cancelled status |
| a provider reports a negative or non-integer `reasoning_tokens` in JSON | the runner ignores the field (`reasoningTokens` remains `undefined`) |
| a caller passes a negative or non-integer `reasoningTokens` to `new TokenUsage(...)` | `TokenUsage` throws `RangeError` |

## 6. Security and data handling

Reasoning text is untrusted model output and may echo secrets from the environment or files the agent read. It must:

1. Never be passed to a shell, a file path, `parseBoardLines`, `AgentMessage` type detection, or a guard.
2. Always pass through the secret redactor (`createRedactor`) inside `RunEventWriter` before being written to
   `<traceId>.events.jsonl`, which is the sole source read by `indaba watch`, the TUI, and `indaba ui`. As with
   `StepOutput`, redaction is applied per chunk as it arrives; a secret split across two streamed chunks is a known
   limitation of streaming chunk redaction and is documented in user docs rather than buffering an entire span in
   memory before display.
3. Never be rendered as raw HTML in `indaba ui` (plain text only, control characters stripped).
4. Never be written to `.indaba/traces/<traceId>.jsonl` (spans) or `.indaba-decisions/`.

## 7. Where it lives

- `@indaba/core`: `RunRequest.onThought`, `StepThought` event class, `TokenUsage.reasoningTokens`,
  `Tracer.ATTR_REASONING_TOKENS`, `Tracer.ATTR_THOUGHT_CHARS`, and web-contract stream/view types (`web-contract/run.ts`,
  re-exported via `web-contract/index.ts`). Pure domain, no `node:` imports.
- `@indaba/engine`: dispatching `StepThought` from `StepExecutor.invoke` (which wraps single-agent steps, retry
  attempts, and `RunnerParticipant` debate turns, giving each `invoke_agent` span its own `seq` and raw character
  count), `ThoughtRecord` in `trace/records.ts`, `RunEventWriter.onThought` in `trace/event-writer.ts`, and
  `TraceReader` / `view.ts` / `plain.ts` aggregation.
- `@indaba/runners`: `AcpRunner` (`agent_thought_chunk`) and `OpenRouterRunner` (`delta.reasoning` /
  `delta.reasoning_content` and `completion_tokens_details.reasoning_tokens`).
- `indaba`, `@indaba/tui`, `@indaba/server`, `@indaba/web`: `--thoughts` flag on `indaba watch` and collapsible
  reasoning display in the TUI and web view.

## 8. Clarifications

- **C-01. Shared `maxRunChars` budget in `RunEventWriter`.** A reasoning model can emit tens of thousands of thought
  characters before a short reply. Sharing the 2 MiB per-run cap (with the exact same stop-and-write-`truncated` rule as
  `onOutput`) prevents `.events.jsonl` from growing past its bound.
- **C-02. Off by default in `indaba watch --plain`.** Automation and AI agents read `indaba watch latest --plain`
  (`docs/ai-playbook.md`); keeping thoughts out of `--plain` unless `--thoughts` is given preserves existing consumers
  and keeps context windows small.
- **C-03. `gen_ai.usage.output_tokens` is not rewritten.** In the OpenAI / OpenRouter chat-completions usage schema
  (`usage.completion_tokens` with sub-breakdown `usage.completion_tokens_details.reasoning_tokens`, verified by fixture
  in `packages/runners/test/openrouter.test.ts`), `completion_tokens` is the total output token count billed at the
  output rate. Recording `indaba.usage.reasoning_tokens` alongside `gen_ai.usage.output_tokens` reports the breakdown
  without altering standard OpenTelemetry GenAI attributes or double-charging in `PricingTable`.

## Artifacts not written

- `data-model.md`: `ThoughtRecord` and `StepThought` are specified in AC-05, AC-06, AC-07 and `api-surface.md`.
- `events.md`: `StepThought` and `ThoughtRecord` are specified in `api-surface.md`.
- `research.md`: the ACP (`agent_thought_chunk`) and OpenRouter (`delta.reasoning`,
  `completion_tokens_details.reasoning_tokens`) wire payloads are already captured in `packages/runners/test/`.
