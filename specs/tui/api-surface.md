# API surface contract: Terminal UI

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**minor** (below 1.0): a new optional package, a new command, a new reader, one new event and a new file per
run. It changes no existing class, workflow key, default, event or trace line. The existing
`<traceId>.jsonl` is written exactly as before (a test pins that). Adopting Ink is a dependency decision
recorded in `research.md`, confined to `@indaba/tui`.

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core` `observability` | class | `StepOutput { readonly traceId: string; readonly spanId: string; readonly seq: number; readonly text: string }`, dispatched for each streamed chunk of a step |
| `@indaba/engine` `engine` | field | `StepExecutorOptions.events?: EventDispatcher`; when absent nothing is dispatched |
| `@indaba/engine` `trace` | type | `RunRecord`: a union discriminated by `type`: `span_started`, `span_ended`, `step_status`, `output`, `truncated`, `unknown` |
| `@indaba/engine` `trace` | function | `parseRecord(line: string): RunRecord` (total: never throws) |
| `@indaba/engine` `trace` | function | `isRunId(value: string): boolean` (lowercase hexadecimal) |
| `@indaba/engine` `trace` | class | `RunEventWriter`, constructor `{ directory: string; clock: Clock; redact?: (text: string) => string; maxRecordChars?: number; maxRunChars?: number; onError?: (error: unknown) => void }`; methods `onSpanStarted`, `onSpanEnded`, `onStepStatus`, `onOutput` |
| `@indaba/engine` `trace` | class | `TraceReader`, constructor `(directory: string)`; `readAll(runId): Promise<RunRecord[]>`; `follow(runId, signal): AsyncIterable<RunRecord>`; `listRuns(): Promise<RunSummary[]>` |
| `@indaba/engine` `trace` | interface | `RunSummary { runId; startedAt?; status: 'running' \| 'completed' \| 'failed' \| 'escalated' \| 'cancelled' \| 'unknown' }` |
| `@indaba/tui` | function | `watch(options: WatchOptions): Promise<number>`, the live view and replay; returns the exit status |
| `@indaba/tui` | functions | `reduceRun(state, record): RunState`, `emptyRun(): RunState`, `formatPlain(state, options): string` |
| `@indaba/tui` | function | `sanitize(text: string): string` and `createSanitizer(): (chunk: string) => string` |
| `indaba watch [run]` | command | plain view always available; the Ink view when `@indaba/tui` loads |
| `indaba run --tui` | option | same condition |

### Record shapes

| `type` | Fields |
| :--- | :--- |
| `span_started` | `at`, `trace_id`, `span_id`, `parent_span_id`, `name`, `attributes` |
| `span_ended` | `at`, `trace_id`, `span_id`, `status`, `status_message`, `attributes`, `events` |
| `step_status` | `at`, `trace_id`, `task_id`, `step_id`, `from`, `to`, `reason?` |
| `output` | `at`, `trace_id`, `span_id`, `seq`, `text` (redacted, at most 4096 characters) |
| `truncated` | `at`, `trace_id`, `span_id`; written once, after which no more `output` is recorded for the run |

## CLI

| Command | Behaviour |
| :--- | :--- |
| `watch [run]` | attach to a run's files; no argument lists runs; `--plain` and a non-TTY give line output; `--replay[=1\|10]` replays a finished run |
| `run --tui` | start the workflow in a child process and attach; closing the UI asks detach or cancel |

Exit status of `watch --plain` mirrors the run: `0` completed, `1` failed, `2` escalated, `3` the files ended
without a final state.

## Workflow schema, events and span attributes

No change to the workflow schema, the existing events (`StepStatusChanged`, `SpanStarted`, `SpanEnded`) or the
existing trace file. New: the `StepOutput` event, the `<traceId>.events.jsonl` file and its record types.

## Defaults introduced

Every run writes the event file (a few kilobytes per step plus output capped at 2 MiB per run); read-only UI;
no network listener; terminal output sanitised. Loosening any of the last three later is a major.

## Checks

- [ ] `@indaba/core`, `@indaba/engine` and `@indaba/runners` import no `ink` or `react`, enforced by their layers tests
- [ ] The existing trace file is byte-identical with and without the event writer (snapshot test)
- [ ] Every dependency is open source and MIT-compatible, transitively, recorded in `research.md`
- [ ] Collections are typed precisely and read-only where they are not mutated
- [ ] `pnpm qa` (Biome, `tsc` strict, Vitest) passes with no suppression comment
