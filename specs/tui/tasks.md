# Tasks: Terminal UI

Ordered by dependency. Domain first, infrastructure second, console and documentation last. Each task
independently checkable; tests are written with each task.

## Event stream (`@indaba/core`, `@indaba/engine`)

- [ ] **T-01** core: `StepOutput` event; exported; test
- [ ] **T-02** engine: `StepExecutorOptions.events`; `invoke` dispatches `StepOutput` for each streamed chunk with the span's ids and a per-span sequence number; no change when no dispatcher is given; tests
- [ ] **T-03** engine `trace/records.ts`: `RunRecord` union, `parseRecord(line)` (total: unknown or malformed becomes an `unknown` record), a hex run-id check; tests incl. hostile lines
- [ ] **T-04** engine `trace/event-writer.ts`: `RunEventWriter` (clock, redactor, caps injected); task-to-trace mapping from the root span; whole-line appends; first write error reported once, never thrown; the 4096 and 2 MiB caps with one `truncated` record; tests with a temporary directory
- [ ] **T-05** engine `trace/trace-reader.ts`: `readAll`, `follow` (100 ms poll, abortable), `listRuns`; partial last line, malformed lines, a file that appears late, a run id escaping the directory; tests incl. a real file being appended to
- [ ] **T-06** the existing `<traceId>.jsonl` is byte-identical with the writer on and off (snapshot test); layers test: engine imports no `ink` or `react`

## Console wiring (`indaba`)

- [ ] **T-07** `createEngine` registers the writer on the events (and passes `events` to the executor), with a redactor built from the environment; a `run` writes the event file; end-to-end test through the built CLI
- [ ] **T-08** a plain `indaba watch [run] --plain` that needs no TUI package: lists runs, follows one, prints state lines, exits with the run's status (0, 1, 2, 3); tests

## `@indaba/tui` (pure part)

- [ ] **T-09** new package `packages/tui`: manifest (`ink` and `react` pinned exactly, nothing else), tsconfig, build, `files`, added to the workspace, `smoke-pack`, release workflow, `check-workflow`
- [ ] **T-10** `sanitize` moved here from the CLI (the CLI re-exports it); hostile and split-sequence tests carried over
- [ ] **T-11** `reduceRun`: total over every record type including unknown; steps, attempts, runner chain and skips, tool calls, permission decisions, output tail (bounded), cost with the `unknown` and partial rules, elapsed; property-style tests with shuffled and truncated input
- [ ] **T-12** plain renderer `formatPlain(state)`: glyph, word and colour never the only carrier; `NO_COLOR`; ASCII fallback; tests
- [ ] **T-13** replay: `play`, pause, 1x and 10x over `readAll`, driven by an injected clock; tests

## `@indaba/tui` (Ink)

- [ ] **T-14** `h` helper over `React.createElement` and the single adapter folder that imports `ink` and `react`; layers test that nothing else does
- [ ] **T-15** components: header, DAG list, step detail (runners and skips, tool calls, permissions, output tail), key legend; resize and minimum-size notice; every agent string through `sanitize`; rendered with `ink-testing-library`-style output capture (no extra dependency: use Ink's own `render` with a fake stdout)
- [ ] **T-16** keyboard: select step, switch pane, scroll output, quit; restores the terminal on exit and on an exception (AC-11); test that an exception restores state
- [ ] **T-17** `watch(options)` entry: the live view and replay, with `--plain` and non-TTY choosing the plain renderer

## Console, the rest

- [ ] **T-18** the CLI loads `@indaba/tui` with a dynamic import that may fail; `watch` uses it when present and prints how to install it when not; `run --tui` (child process, attach, detach or cancel); tests with a fake module and one end-to-end run
- [ ] **T-19** `run --tui` closing: detach leaves the run going, cancel stops it and tears the worktree down; tests

## Tests

- [ ] **T-20** every new module tested to the repo's floor (85% on all four metrics) and mutation-checked on `sanitize`, the reader, the writer's caps and `reduceRun`
- [ ] **T-21** hostile-input tests: control sequences in agent output, a trace line with a huge field, a path-like run id, a record with unexpected types; hostile strings built from fragments

## Documentation

- [ ] **T-22** `docs/getting-started.md` (the `watch` command, `--tui`, `--plain`, `NO_COLOR`, where the event file is and what it holds), `docs/README.md`, README, CHANGELOG, `specs/DEPENDENCY_MAP.md`, AGENTS.md repository map and the packages table
- [ ] **T-23** `research.md` records the pinned versions and the re-run license check; `review.md` filled in with real output

## Stage 7: Verification

- [ ] `pnpm qa`, `pnpm e2e`, `pnpm smoke` and the node gates green; output recorded in review.md
- [ ] a manual run on this Windows machine (Windows Terminal) and the result noted; Linux and macOS by CI
