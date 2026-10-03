# API surface contract: Terminal UI

> Specification only. Nothing here exists yet; this is the contract implementation will be written
> against, and it changes only through this spec.

## Semver classification

**minor** (below 1.0): a new optional package, a new command and one new core class. It changes no
existing class, workflow key or default. Adopting `symfony/tui` may require moving Symfony components
to 8.x, which is a separate dependency decision classified in its own spec.

## Public symbols added

| Name | Kind | Notes |
| :--- | :--- | :--- |
| `Indaba\Observability\TraceReader` | final class (core, no Symfony) | reads and tails a JSONL trace into the existing event value objects; shared with the run API |
| `indaba/tui` | optional package | owns the command and every `symfony/tui` import |
| `bin/indaba watch [run]` | command | registered only when `indaba/tui` is installed |
| `bin/indaba run --tui` | option | same condition |

## CLI

| Command | Behaviour |
| :--- | :--- |
| `watch [run]` | attach to a run's trace; no argument lists runs; `--plain` and non-TTY give line output; `--replay[=speed]` replays a finished run |
| `run --tui` | start the workflow in a child process and attach; closing the UI asks detach or cancel |

Exit status of `watch --plain` mirrors the run: `0` completed, `1` failed, `2` escalated, `3` the trace
ended without a final state.

## Workflow schema, events and span attributes

No change. The TUI reads the trace as `specs/observability` defines it.

## Defaults introduced

Read-only; no network listener; terminal output sanitised. Loosening any of them later is a major.
