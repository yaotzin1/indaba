# Plan: Logging

## Approach

One contract in `@indaba/core`, sinks in `@indaba/engine`, one composition root in `indaba`. Each package receives a
`Logger` as an option and defaults to `noopLogger`, so nothing changes for an embedder who passes none. The order is chosen
so each slice is useful and mergeable on its own:

1. **Core** (done): the contract, the settings described once, tests.
2. **File sink and the command line:** `FileLogSink`, `--log-level`, `--log-dir`, `INDABA_LOG_LEVEL`, the `process.start`
   record, standard error for `warn` and above, flush on exit.
3. **Wiring:** the engine, the runners and the server log through the injected logger, with `runId`, `taskId`, `stepId`
   and `traceId` added through `child`. `indaba ui` (T-11 of `specs/web-app`) is written against it from its first line.
4. **Remote sinks:** `GelfLogSink` and `HttpJsonLogSink`, with the bounded queue, timeout and retries of AC-16.
5. **Plugin sinks:** `Plugin.logSinks`.
6. **`indaba report`** (second step) and the **settings screens** (with the actions step of `specs/web-app`).
7. **The rule** in `workflow.ai.yml`, with a `Workflow-Change:` trailer, once the contract and the layers tests exist.

## Decisions taken at plan time

- The redaction is a function passed to `createLogger`; the composition root builds it from the environment, because core
  reads none. The existing `redact.ts` of the command line is the starting point.
- A sink's `write` is synchronous and must not block; a remote sink queues and sends in the background.
- The settings are validated by `resolveLoggingSettings` in core, so the parser, the options help and both UIs share it.
- No dependency is added (`node:http`, `node:net`, `node:dgram`, `node:fs`).

## Risks

- A secret in a field the redaction does not know: mitigated by redacting in `createLogger` (not per sink), hostile-input
  tests, and not logging prompts or agent output below `debug`.
- A slow collector holding a command: mitigated by the queue, timeout and retry bounds; tested with a fake sink that never
  answers.
- Log volume: the file sink's size cap and file count, and the per-sink level.
