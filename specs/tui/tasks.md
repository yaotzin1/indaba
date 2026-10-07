# Tasks: Terminal UI

Ordered by dependency. Domain first, infrastructure second, console and documentation last. Each task
independently checkable; tests are written with each task.

## Event stream (`@indaba/core`, `@indaba/engine`)

- [x] **T-01** core: `StepOutput` event; exported; test
- [x] **T-02** engine: `StepExecutorOptions.events`; `invoke` dispatches `StepOutput` for each streamed chunk with the span's ids and a per-span sequence number; no change when no dispatcher is given; tests
- [x] **T-03** engine `trace/records.ts`: `RunRecord` union, `parseRecord(line)` (total: unknown or malformed becomes an `unknown` record), a hex run-id check; tests incl. hostile lines
- [x] **T-04** engine `trace/event-writer.ts`: `RunEventWriter` (clock, redactor, caps injected); task-to-trace mapping from the root span; whole-line appends; first write error reported once, never thrown; the 4096 and 2 MiB caps with one `truncated` record; tests with a temporary directory
- [x] **T-05** engine `trace/trace-reader.ts`: `readAll`, `follow` (100 ms poll, abortable), `listRuns`; partial last line, malformed lines, a file that appears late, a run id escaping the directory; tests incl. a real file being appended to
- [x] **T-06** the existing `<traceId>.jsonl` is byte-identical with the writer on and off (snapshot test); layers test: engine imports no `ink` or `react`

## Console wiring (`indaba`)

- [x] **T-07** `createEngine` registers the writer on the events (and passes `events` to the executor), with a redactor built from the environment; a `run` writes the event file; end-to-end test through the built CLI
- [x] **T-08** a plain `indaba watch [run] --plain` that needs no TUI package: lists runs, follows one, prints state lines, exits with the run's status (0, 1, 2, 3); tests

## `@indaba/tui` (pure part)

- [x] **T-09** new package `packages/tui`: manifest (`ink` and `react` pinned exactly, nothing else), tsconfig, build, `files`, added to the workspace, `smoke-pack`, release workflow, `check-workflow`
- [x] **T-10** `sanitize` moved here from the CLI (the CLI re-exports it); hostile and split-sequence tests carried over
- [x] **T-11** `reduceRun`: total over every record type including unknown; steps, attempts, runner chain and skips, tool calls, permission decisions, output tail (bounded), cost with the `unknown` and partial rules, elapsed; property-style tests with shuffled and truncated input
- [x] **T-12** plain renderer `formatPlain(state)`: glyph, word and colour never the only carrier; `NO_COLOR`; ASCII fallback; tests
- [x] **T-13** replay: `play`, pause, 1x and 10x over `readAll`, driven by an injected clock; tests

## `@indaba/tui` (Ink)

- [x] **T-14** `h` helper over `React.createElement` and the single adapter folder that imports `ink` and `react`; layers test that nothing else does
- [x] **T-15** components: header, DAG list, step detail (runners and skips, tool calls, permissions, output tail), key legend; resize and minimum-size notice; every agent string through `sanitize`; rendered with `ink-testing-library`-style output capture (no extra dependency: use Ink's own `render` with a fake stdout)
- [x] **T-16** keyboard: select step, switch pane, scroll output, quit; restores the terminal on exit and on an exception (AC-11); test that an exception restores state
- [x] **T-17** `watch(options)` entry: the live view and replay, with `--plain` and non-TTY choosing the plain renderer

## Console, the rest

- [x] **T-18** the CLI loads `@indaba/tui` with a dynamic import that may fail; `watch` uses it when present and prints how to install it when not; `run --tui` (child process, attach, detach or cancel); tests with a fake module and one end-to-end run
- [x] **T-19** `run --tui` closing: detach leaves the run going, cancel stops it and tears the worktree down; tests

## Tests

- [x] **T-20** every new module tested to the repo's floor (85% on all four metrics) and mutation-checked on `sanitize`, the reader, the writer's caps and `reduceRun`
- [x] **T-21** hostile-input tests: control sequences in agent output, a trace line with a huge field, a path-like run id, a record with unexpected types; hostile strings built from fragments

## Documentation

- [x] **T-22** `docs/getting-started.md` (the `watch` command, `--tui`, `--plain`, `NO_COLOR`, where the event file is and what it holds), `docs/README.md`, README, CHANGELOG, `specs/DEPENDENCY_MAP.md`, AGENTS.md repository map and the packages table
- [x] **T-23** `research.md` records the pinned versions and the re-run license check; `review.md` filled in with real output

## Stage 7: Verification

- [x] `pnpm qa`, `pnpm e2e`, `pnpm smoke` and the node gates green; output recorded in review.md
- [ ] a manual run on this Windows machine (Windows Terminal) and the result noted; Linux and macOS by CI

> T-10 to T-12 live in `@indaba/engine` (`sanitize`, `reduceRun`, the plain formatter) rather than in `@indaba/tui`,
> so the plain `watch` needs none of Ink; T-13's replay lives in `@indaba/tui`. Open: only the manual run in a real
> terminal (Windows Terminal) and the CI result on Linux and macOS; see `review.md`, Known gaps.
