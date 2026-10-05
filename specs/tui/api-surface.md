# API surface contract: Terminal UI

> Specification only. Nothing here exists yet; this is the contract implementation will be written
> against, and it changes only through this spec. Draft: it settles once the clarifications in `spec.md`
> section 8 are resolved.

## Semver classification

**minor** (below 1.0): a new optional package, a new command, a new reader and a new file per run. It
changes no existing class, workflow key, default, event or trace line. The existing `<traceId>.jsonl` is
written exactly as before. Adopting Ink is a dependency decision recorded separately (`research.md`).

## Public symbols added

| Export (package, module) | Kind | Notes |
| :--- | :--- | :--- |
| `@indaba/engine` `trace` | type | `RunRecord`, a discriminated union on `type`: `span_started`, `span_ended`, `step_status`, `output` |
| `@indaba/engine` `trace` | class | `RunEventWriter`, appends `RunRecord`s to `<traceId>.events.jsonl`; registered by the composition root on the existing events |
| `@indaba/engine` `trace` | class | `TraceReader`, reads and tails the trace and the event stream into typed values; tolerant of partial and malformed lines; no UI imports |
| `@indaba/engine` `trace` | function | `listRuns(tracesDir)`: the runs found, newest first |
| `@indaba/tui` | package | optional; exports `watch(options)` and the plain renderer; owns every `ink` and `react` import |
| `indaba watch [run]` | command | registered only when `@indaba/tui` loads |
| `indaba run --tui` | option | same condition |

### Record shapes (draft)

| `type` | Fields |
| :--- | :--- |
| `span_started` | `trace_id`, `span_id`, `parent_span_id`, `name`, `start`, `attributes` |
| `span_ended` | `trace_id`, `span_id`, `end`, `status`, `status_message`, `attributes` |
| `step_status` | `trace_id`, `task_id`, `step_id`, `from`, `to`, `reason?`, `at` |
| `output` | `trace_id`, `span_id`, `seq`, `text` (already redacted, bounded), `truncated?` |

## CLI

| Command | Behaviour |
| :--- | :--- |
| `watch [run]` | attach to a run's files; no argument lists runs; `--plain` and non-TTY give line output; `--replay[=speed]` replays a finished run |
| `run --tui` | start the workflow in a child process and attach; closing the UI asks detach or cancel |

Exit status of `watch --plain` mirrors the run: `0` completed, `1` failed, `2` escalated, `3` the files ended
without a final state.

## Workflow schema, events and span attributes

No change to the workflow schema, the existing events or the existing trace file. New: the
`<traceId>.events.jsonl` file and its record types above.

## Defaults introduced

Every run writes the event file (a few kilobytes per step plus bounded output); read-only UI; no network
listener; terminal output sanitised. Loosening any of the last three later is a major.

## Checks

- [ ] `@indaba/core`, `@indaba/engine` and `@indaba/runners` import no `ink` or `react`, enforced by their layers tests
- [ ] The existing trace file is byte-identical with and without the event writer (snapshot test)
- [ ] Every dependency is open source and MIT-compatible, transitively, recorded in `research.md`
- [ ] `pnpm qa` passes with no suppression comment
