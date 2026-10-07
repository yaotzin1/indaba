# Plan: Terminal UI

Stage 3. Read before writing: `packages/core/src/observability/index.ts` (`Tracer`, `SpanStarted`,
`SpanEnded`), `packages/core/src/workflow/state.ts` (`StepStatusChanged`), `packages/engine/src/engine/
workflow-engine.ts` and `step-executor.ts` (where output and status changes originate),
`packages/engine/src/observability/jsonl-span-exporter.ts`, `packages/cli/src/{main,engine-factory}.ts`.

## Decisions (maintainer: "go with tui", after choosing Ink and the MIT-only rule)

| Question | Decision |
| :--- | :--- |
| 1 Library | Ink 8.0.0 with React 19.3.0, **pinned exactly** in `@indaba/tui` only (39 packages, all MIT, ISC or MIT-or-CC0; `research.md`). `react-devtools-core` is never installed. |
| 2 Live stream | A second file, `<traceId>.events.jsonl`; the existing trace stays byte-identical. |
| 3 Process model | The engine in its own process; the TUI tails files. |
| 4 JSX | None. Components use a `createElement` helper (`h`), so no compiler option changes and no protected file is touched. |
| 5 Windows | Windows Terminal and modern consoles supported on a best-effort basis; anything else falls back to `--plain`. Claimed in docs only after a real-machine check. |
| 6 Layout | Header (run, status, cost, elapsed), DAG list on the left, selected step on the right (runners and skips, tool calls, permission decisions, live output tail), key legend at the bottom. |
| 7 Caps | `output` records: 4096 characters each, 2 MiB per run, then one `truncated` record and no more output. |
| 8 Replay | Play, pause, 1x and 10x. No seeking. |

Changes to the spec made by this plan: the **consensus transcript** (US-03) is reduced for v1 to the
outcome, the round count and the open objections already carried by the step's status reason and span
attributes (`indaba.consensus.outcome`, `indaba.consensus.rounds`). The messages of the mesh are recorded
nowhere today; a transcript needs the mesh to emit them, which is its own change.

## Modules

| Package | Change |
| :--- | :--- |
| `@indaba/core` | one new event, `StepOutput { traceId, spanId, seq, text }`. Nothing else. |
| `@indaba/engine` | `StepExecutorOptions.events` (optional dispatcher) and a wrapper in `invoke` that dispatches `StepOutput`; `trace/` module: `RunRecord` types and a parser, `RunEventWriter`, `TraceReader`, `listRuns`. No UI imports. |
| `@indaba/tui` (new, optional) | pure: `reduceRun` (records to a view model), `sanitize`, `formatPlain`; effectful: Ink components (`h` helper), `watch`, `replay`. Only this package imports `ink` and `react`. |
| `indaba` (CLI) | writes the event stream in `createEngine` (with a redactor built from the environment), `watch [run]`, `run --tui`, dynamic import of `@indaba/tui` that is allowed to fail. |

## Design

### The event stream (first deliverable)

`RunEventWriter` listens to `SpanStarted`, `SpanEnded`, `StepStatusChanged` and `StepOutput`. It maps
`taskId` to `traceId` from the root span (`indaba.task.id` attribute, no parent), appends one JSON line per
event to `<dir>/<traceId>.events.jsonl` (`appendFile`, so a reader sees complete lines), stamps each record
with the injected clock, and never throws into the run (a failing listener is already isolated; the writer
also swallows write errors after reporting the first one). Record shapes are in `api-surface.md`.

Output records pass through the redactor given by the composition root (the same environment-based redaction
`indaba run` applies to its own messages), are cut to 4096 characters, and stop after 2 MiB per run with a
single `truncated` record. Output is stored as streamed text; it can contain whatever the agent printed, so
it lives under `.indaba/` (gitignored, local), like artifacts. The docs say so.

### `TraceReader`

Reads `<traceId>.jsonl` and `<traceId>.events.jsonl` into typed values. `readAll` for replay, `follow` for a
live run (polls file size every 100 ms and reads appended bytes; no `fs.watch`, which is unreliable across
platforms), tolerant of a partial last line (kept until it completes), malformed lines and unknown types
(surfaced as `unknown` records, never thrown). The run id is validated as hexadecimal before it becomes a
path.

### The view model

`reduceRun(state, record)` is pure and total: it never throws on any record. State: run status, steps in
document order with status, attempt count and reason, per step the runner spans (`invoke_agent <runner>`),
skipped runners with reasons, ACP tool calls (kind and status counts), permission decisions, an output tail
(bounded), cost (a sum with an `unknown` flag when a model is not priced, from `indaba.cost.usd` and the
absence of it), and elapsed time. The dashboard and the plain view render the same state.

### Rendering

Ink components take the state and nothing else. Every string that came from an agent or a command goes
through `sanitize` (the allow-list filter already in `packages/cli/src/printable.ts`, moved to the TUI package
and re-exported for the CLI) before it reaches a component. State is conveyed by a glyph, a word and, when
colour is on, a colour. `NO_COLOR` is honoured; with no TTY or `--plain` the plain renderer prints the same
information line by line.

### `run --tui`

The CLI starts `indaba run ...` as a child (`process.execPath` with the CLI's own `bin.js`, argument array)
and attaches to the new run's files. It finds them by the `<traceId>.events.jsonl` that appears after the
child started. Closing the UI asks to detach or cancel; cancel sends the same signal as Ctrl+C.

## Order of work

1. Event stream and reader in `@indaba/engine` and `StepOutput` in core, wired in the CLI, tests, docs. Useful
   alone: anything can follow a run.
2. `@indaba/tui` pure part: `reduceRun`, `sanitize`, the plain renderer, `watch --plain` and replay. No Ink yet.
3. The Ink dashboard on top of the same state.
4. `run --tui`, then Windows and macOS checks and the docs.

## Trade-offs taken

- **Polling over `fs.watch`:** a 100 ms poll costs a stat per tick but behaves the same on every OS and
  inside containers.
- **A second file over typed lines in the trace:** one more file per run, but every existing consumer of the
  trace keeps working byte for byte.
- **No JSX:** component code is a little noisier; no change to protected compiler configuration.
- **Output is stored:** it can hold sensitive text. Redaction covers known secrets, not everything an agent
  might print; the file stays local and gitignored.

## Risks

| Risk | Mitigation |
| :--- | :--- |
| a hostile agent writes escape sequences to the screen | one sanitiser, allow-list, applied at the component boundary, tested with hostile inputs and split sequences |
| the event file grows without bound | per-record and per-run caps with a visible truncation marker |
| a reader sees a half-written line | `appendFile` of whole lines; the reader keeps a partial tail |
| Ink or React break on a major release | exact pins, every import in one adapter folder |
| Ink on legacy Windows consoles | `--plain` fallback; the claim is made only after a real check |
| `run --tui` leaves an orphaned run | closing the UI always asks detach or cancel; a test covers both |
