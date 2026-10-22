# Plan: The local web view, delivery step 2 (Run and Stop)

The spec is [`spec.md`](spec.md), the signatures [`api-surface.md`](api-surface.md). Amended after the review of
2026-10-22 ([`plan-review.md`](plan-review.md)). This is how the pieces fit.

## Where each piece goes

| Piece | Package | Why there |
| :--- | :--- | :--- |
| Contract types | `@indaba/core` `web-contract` | shared by page and server, declarations only |
| Three resources, request checks, `RunControl` interface | `@indaba/server` | HTTP is its job; it must not spawn or write (layers test) |
| Workflow scan, summary of use, content hash, run copy, confirmation store | `indaba` `run-control/` | file reads and writes, and the parser, are the composition root's |
| The child process, its cancellation and `kill()` | `indaba` (`createRunStarter`, already there) | `run --tui` uses it; one way to start a run |
| Run a workflow panel, confirmation, starting state, Stop | `@indaba/web` | the page |

## How a run starts

1. The page asks `GET /workflows`; `RunControl.list` scans each root (bounded; `.indaba/` skipped except the default
   file) and parses each file with the engine's `WorkflowParser` for its name and problems. The id is a hash of root
   index and relative path: stable between calls, and it says nothing about the disk.
2. The page sends `POST /runs { workflowId }`. The server checks token, `Host`, `Origin` (now required), body size and
   type, then calls `RunControl.start`.
3. `start` re-scans and finds the id (else `workflow_not_found`), **reads the file into one buffer**, hashes that buffer
   and parses it. It looks the hash up in the confirmation store (the user config folder, keyed by the root's
   realpath). Unknown hash and no matching `confirmedHash`: `confirmation_required` with the summary built from the
   parsed definition. Nothing is written to the project for a `409`.
4. Confirmed: it records the hash (atomic write; failure is `not_saved`), generates the `startId` from the fixed
   alphabet, and writes the **same buffer** to `<root>/.indaba/run-inputs/<startId>.yml` with `wx`. It starts
   `indaba run --workdir <root> --task-id <startId> -- <that copy, relative to the root>` through `RunStarter` with
   `cwd: root` and the server's environment. It keeps the `RunChild` in a map by start id, answers `202 { startId }`,
   and on exit deletes the copy and logs the exit code.
5. The correlation: the child's engine opens a trace and writes the root `span_started` record, with `indaba.task.id`,
   as the first line of `<traceId>.events.jsonl` (`RunEventWriter.onSpanStarted`). `startStatus` reads the
   `startId`-to-trace mapping from the run source, which already follows the traces folder; the first record that
   carries the id gives `runId`. This does not race when several runs start together, which diffing the folder (what
   `run-tui.ts` does for one run) would. Until then the status is `starting`; if the child exits non-zero before it, it
   is `failed` with the sanitised first line of the child's error stream.

**What was checked and what was not.** The correlation was read in `event-writer.ts` and `view.ts`; T-10 proves it with a
real trace file before anything depends on it. Whether the copy under `.indaba/run-inputs/` changes anything a
workflow does (the engine resolves artifacts against `--workdir`, not the file) is checked in T-12, not assumed. The
limits (1 MiB, 200 files, depth 4, `STOP_GRACE_MS`, `MAX_CONCURRENT_RUNS`) are starting values, not measurements.

## How a run stops

`POST /runs/{id}/stop` finds the child by trace id and calls `RunChild.cancel()` (the IPC message `bin.ts` listens for;
it works on Windows), answering `202 stopping`; a repeat while alive is the same, after exit `200 ended`.
`stopAll`, called by `ServerHandle.close()` before the listener closes, cancels every child and waits for their `exited`
promises, bounded by `STOP_GRACE_MS`. Only a child still alive then gets `kill()`, which ends the tree (the child is
detached, so its own children would survive a plain kill): `taskkill /PID <pid> /T /F` as an argument array with
`windowsHide` on Windows, `SIGKILL` to the process group elsewhere. `createRunStarter` tracks the child's own `close` and
`error`, so `kill()` after exit is a no-op and a reused pid is never signalled.

The child has `stdin: 'ignore'` and no terminal, so a step that needs a login or `arbiter: human` ends escalated. The
summary lists such steps (`needsPerson`) and the Run screen says it.

## The page

- `RunsScreen` gets the **Run a workflow** button and a `RunPanel` (a dialog, focus trapped, Escape closes): the list,
  the invalid ones disabled with their problems, the once-per-session notice (closing stops the runs), then the
  confirmation view (runners, commands as plain text, permissions, who is needed, the stated limit) with **Run** and
  **Cancel**.
- After `202` the panel shows "Starting" and polls `GET /starts/{startId}` (the interval is the stream's, injected for
  tests) until `runId` appears, then opens the Run screen; on `failed` it shows the reason and stays.
- `RunScreen` gets **Stop** while `canStop`, with its own confirmation naming the run, and a "stopping" state.
- `client.ts` gains `listWorkflows`, `startRun`, `startStatus`, `stopRun`; `messages.ts` the strings; errors map from
  `code` to a message and a next action, never a status.

## Decisions recorded

- **`RunControl` mirrors `LoggingSettingsBackend`.** The server defines the interface, the command line implements it,
  and a server without it is the read-only one of step 1. No flag.
- **A child per run, not an in-process engine.** An in-process engine would tie a run's memory, plugins and Ctrl+C
  handling to the server; the child exists and is tested (`run-child.ts`).
- **The confirmed bytes are what runs.** A copy under `.indaba/run-inputs/` closes the window between the hash and the
  child's own read without a new CLI option (`--expect-hash` was considered and rejected: a public surface change for a
  loopback tool).
- **The confirmation lives outside the project.** A project that ships its own `.indaba/` must not arrive confirmed.
- **No new runtime dependency.** SHA-256 is `node:crypto`; the scan uses `node:fs`; the config folder is a parameter.
- **A separate `starts` resource**, not an overloaded `GET /runs/{startId}` (spec C-07).
- **The server's `layers.test.ts` is not edited.** The rule it enforces holds.

## Analysis (stage 5)

- Published signature broken: no. Additions only, and one tightened check (a write needs an `Origin`), recorded as such.
- `node:` in core: no, types only.
- New runtime dependency: none.
- Untrusted data reaching a shell, path, URL or log: `workflowId` and `confirmedHash` only, matched against a scan and a
  hash. `startId` is the server's, from a fixed alphabet, validated by shape wherever it comes back from a URL; it
  names a file, so a `taskId` in a body is ignored and tested (`../x`). The relative path is the scan's.
- Clock, randomness, environment in decision logic: the id generator, the clock and the config folder are injected into
  `RunControl`; the environment of the child is passed in, not read.
- Unbounded loop, retry or buffer: scan depth and count, hashes per workflow, concurrent runs, stderr, body size, copies
  swept at start. All named constants.
- Process lifetime: no orphan on the normal path (cancel, grace, kill the tree); a crashed `indaba ui` leaves children
  running, which is the stated cost of C-12's choice and is logged as such in the docs.
- Security audit: `spawn('taskkill', [...])` and `process.kill(-pid, ...)` are checked against
  `scripts/security-audit.mjs` in T-10 before the code relies on them.
