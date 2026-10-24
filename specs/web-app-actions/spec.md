# Specification: The local web view, delivery step 2 (Run and Stop)

> **Status**: Implemented on `feat/web-app-run-stop` (2026-10-22), except the real-browser check of AC-14 (see
> `review.md`); amended after the review of 2026-10-22 (see `plan-review.md`)
> **Stage entry**: 1
> **Semver impact**: minor (below 1.0): additive HTTP resources, additive contract types, additive `indaba ui`
> behaviour, and one tightening of an existing check (a write without an `Origin` is refused)
> **Parent**: [`specs/web-app`](../web-app/spec.md), C-09 step 2. Where this file is silent, that spec rules.

---

## 1. The problem

`indaba ui` shows the runs of a project and nothing else. A person who found a failed run, fixed the workflow file and
wants to try again has to leave the page, find a terminal, remember the command and its options, and come back. For the
people who run Indaba for regular tasks without git or a terminal, the page that shows a run is the page that should start
it, and stop it when it goes the wrong way.

Step 1 (read-only) is merged. C-09 names step 2 as "Run, Stop, Run this step, answer questions, apply or discard a
change". Most of that waits for features that are not built (`specs/workflow-inputs`, `single-step-run`,
`ruling-channel`, `workspace-without-git`, the workflow registry). This slice takes the two actions that need none of
them: **Run** a whole workflow and **Stop** a run the server started.

## 2. User stories

- **US-01.** As a person who runs Indaba, I see the workflows found in my project and start one with a button, without
  typing a command.
- **US-02.** As that person, the first time a workflow runs from the page I am told what it will use (runners, commands,
  permissions) and I confirm; the same content does not ask again, changed content does.
- **US-03.** As that person, I stop a run I started from the page, and its workspace is cleaned up the way Ctrl+C
  cleans it.
- **US-04.** As that person, when I close `indaba ui` the runs it started stop, and the page told me so before my first
  Run (parent C-12).
- **US-05.** As a developer, a run started from the page is an ordinary run: same files, same trace, same events, same
  `indaba watch`.

## 3. Acceptance criteria

**Finding workflows**

- [x] AC-01. `GET /api/v1/workflows` lists the workflows of the served roots: files named `*.workflow.ai.yml` or
  `*.workflow.ai.yaml`, and the project's default `.indaba/workflow.ai.yml`, found by a bounded scan of each root
  (depth, count and size limits; no `node_modules`, no `.git`; links not followed). The scan skips `.indaba/` except that
  one file, because `.indaba/worktrees/` and `.indaba/run-inputs/` hold copies. Each entry has an opaque `id`, the
  workflow's `name`, its path relative to the root, and `valid`; an invalid file is listed with the problems
  `indaba validate` would print and is never started.
- [x] AC-02. The page never sends a path. `id` is looked up in a fresh scan at the time of the request; an `id` the scan
  does not return is `404 workflow_not_found` (parent AC-18).

**Run**

- [x] AC-03. `POST /api/v1/runs` with `{ workflowId }` (and nothing else is read from the body) starts the confirmed
  workflow as `indaba run --workdir <root> --task-id <startId> -- <path>` in a process of its own, with an argument array
  and no shell, **with `cwd` set to the root** and `<path>` relative to it (`loadWorkflow` resolves the file against the
  process's working directory, not against `--workdir`). It answers `202` with a `startId` before the run ends. A test
  with two roots proves each child starts in its own. *Amended by `agent-permissions` AC-05:* the body may also carry
  `fullAccessConfirmedHash`, the content hash the person saw listed with the steps whose agent has `full` access; a file with
  such a step and no matching value is refused with `409 full_access_required` (the steps in the answer), and with a matching
  value the child is started with `--allow-full-access=page`. The value is a hash, never a task id, a path or a flag.
- [x] AC-04. The first run of content the person has not confirmed is refused with `409 confirmation_required` carrying
  a summary of what it will use and the `contentHash` it describes. The same request with `confirmedHash` equal to that
  hash starts it and records the confirmation. Content that changed between the summary and the start is `409` again
  with the new summary. The summary lists: the runner of every step, the command line of every `shell` step, every
  `agent.command` of a role or step, every local MCP server command, the permission rules each step declares (a step
  with none is shown as "runner default (unrestricted)"), and the steps that need a person (`arbiter: human`). It states
  as a limit, in plain words on the page, that it covers only what the workflow file declares: not scripts a command
  calls, `indaba.config`, plugins, or what an agent CLI then does with its own tools. The confirmation is kept per
  workflow and per SHA-256 of the file's bytes (parent C-12, confirmed 2026-10-22).
- [x] AC-05. The bytes that were hashed, parsed and summarised are the bytes that run. After confirmation the server
  writes that exact buffer to `<root>/.indaba/run-inputs/<startId>.yml` (flag `wx`: an existing file or link is an
  error) and the child runs that copy. The copy is deleted when the child exits, and `indaba ui` removes any left
  over at start. No copy is written for a request that ends in `409`.
- [x] AC-06. At most `MAX_CONCURRENT_RUNS` runs started by this server are alive at once; one more is `429
  too_many_runs` naming the limit.
- [x] AC-07. Nothing starts a run on page load; every start is a click on a button that names the workflow (parent
  AC-13). A second click while the request is in flight sends nothing.
- [x] AC-08. **Identity.** The run the page opens is identified by its trace id (what `GET /runs/{id}` already uses). The
  server cannot know it at start: `--task-id` sets the task id, and the engine returns the trace id separately. So the
  start answers with a `startId` (the task id, generated by the server from the fixed alphabet `[A-Za-z0-9_-]`, never
  taken from the request), and `GET /api/v1/starts/{startId}` answers `{ state: 'starting' | 'running' | 'failed',
  runId?, failure? }`. `RunControl` learns the trace id from the `indaba.task.id` attribute of the root `span_started`
  record, the first line of `<traceId>.events.jsonl`, not by diffing the traces folder (which races when runs start
  together). Every id taken from a URL is checked for shape before it is used.

**Stop**

- [x] AC-09. `POST /api/v1/runs/{id}/stop` asks the run to stop as Ctrl+C does (the engine's teardown, the worktree
  removed). It answers `202 { state: 'stopping' }` while the child is alive, whether this call or an earlier one asked,
  and `200 { state: 'ended' }` once it has exited. A run this server did not start is `409 not_started_here`: the page
  offers no Stop for it and the server never signals a process it does not own.
- [x] AC-10. `GET /api/v1/runs/{id}` also answers `canStop`: true only while a run this server started is alive.
- [x] AC-11. Ending `indaba ui` (Ctrl+C or the command's signal) stops every run it started. `stopAll` first asks each
  to cancel, as Stop does, and waits at most `STOP_GRACE_MS`; only a child still alive after that is killed, with its
  process tree (the child is detached, so its own children would otherwise survive), and a child that has already
  exited is never signalled. What was killed is logged. The page says, before the first Run of a session, that closing
  `indaba ui` stops its runs.
- [x] AC-12. The child has no terminal and no standard input. A step that needs a person (a login, or `arbiter: human`)
  ends as escalated, as `indaba run` does without a TTY. The summary of AC-04 and the Run screen say so before Run.

**The page**

- [x] AC-13. The Runs screen has a **Run a workflow** button that opens the list of workflows (name, path, valid or not
  and why). Choosing one shows the confirmation of AC-04 when asked for, then starts the run and, when `GET /starts/{id}`
  reports the trace id, opens its Run screen. The Run screen has a **Stop** button while `canStop`, which names the run
  and asks before it acts. *Amended by `agent-permissions` AC-05:* when the file has a step at `full` access, the confirmation
  lists those steps in plain words **every time a run starts**, whether or not the file's hash was confirmed before, and the
  press that starts the run is the person's acknowledgement.
- [ ] AC-14. Every new control is reachable with the keyboard, labelled, announced when its state changes, usable at
  320 px, and its words come from the message catalogue. A refusal (`429`, `409`, `422`, a start that fails) is shown in
  plain words with the next action, never as a status code.
- [x] AC-15. A run that fails before it writes a trace shows its reason: `GET /starts/{id}` answers `failed` with the
  first line of the child's error stream passed through the same `sanitize(redact(...))` as the dashboard's
  (`run-tui.ts`), not a `404` and not an endless wait.

**Safety**

- [x] AC-16. Both new resources need the token, the `Host` check and the same-origin check of every write (parent AC-02,
  AC-22). **A write without an `Origin` is refused** (`originAllowed` returns false for `undefined`; a browser always sends
  one on `POST` and `PUT`). This also tightens the existing settings `PUT`, and the error messages that said "settings"
  are made general. No body field reaches a command line, a path or a log except through the checks of AC-02 and AC-08.
- [x] AC-17. `@indaba/server` still spawns nothing and writes nothing: the scan, the child, the run copy and the
  confirmation store are the work of a `RunControl` the command line supplies, as it supplies the logging-settings
  backend. The layers test of `@indaba/server` stays green.
- [x] AC-18. The environment of the child is the environment `indaba ui` started with and nothing the page sent. No
  secret reaches the page, a log, the confirmation store or the run copy's name.

## 4. Non-goals

- **Run this step, a form for workflow inputs, questions and answers, apply or discard a change.** Each waits for its own
  spec and is a later slice of C-09 step 2.
- **A workflow registry** (import, copy, remove, health). The scan is a stopgap that reads the served roots, keeps no
  list, and is replaced when `specs/workflow-registry` is built.
- **Runs that outlive the server** (parent C-12, confirmed). No supervisor.
- **Choosing options for a run** (`--timeout`, plugins, verbosity) from the page.
- **Hashing what the workflow file only points at** (scripts, `indaba.config`, plugins). AC-04 says so instead.
- **Editing.** Step 3; see `specs/web-app/plan-step-3.md`.
- **Remote or hosted use.** Loopback only (parent AC-03).

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the workflow file is invalid | listed with its problems; `POST /runs` is `422 workflow_invalid` with them |
| the file changed after the summary | `409 confirmation_required` again, with the new summary |
| the child cannot be started | `500 start_failed`, plain words, no copy left behind, nothing running |
| the child exits before writing a trace | `GET /starts/{id}` says `failed` with the reason (AC-15) |
| a step needs a person | the run ends escalated; the summary warned (AC-12) |
| too many runs | `429 too_many_runs` |
| stop a run that ended | `200 { state: 'ended' }` |
| the server ends while runs live | cancel, wait `STOP_GRACE_MS`, kill the tree of any still alive, log it (AC-11) |
| `indaba ui` crashed earlier and left copies | removed at the next start |
| the confirmation store cannot be written | the run does not start: `409 not_saved`, because an unrecorded confirmation would ask again forever and hide the problem |
| a request without an `Origin` | `403 origin_not_allowed`, even with the token |

## 6. Security and data handling

- Untrusted: the request body (`workflowId`, `confirmedHash`), the workflow file's content, the child's error stream, and
  any id in a URL.
- `workflowId` is matched against a fresh scan; the path used is the one the scan found, confined to its root (also
  through links). A hostile `workflowId` cannot name a file the scan did not return. A `taskId` or any other field in
  the body is ignored.
- The command line is built from the scan's relative path and the server's own ids: an argument array, `--` before the
  positional file so a name that starts with `-` is not an option, no shell (`application_security`). Killing a tree on
  Windows is `taskkill` with an argument array and `windowsHide`; on POSIX the process group; both are checked against
  `scripts/security-audit.mjs` before they are written.
- The summary of AC-04 shows commands as text only (parent AC-16) and is cut to a bounded length.
- The confirmation store holds hashes keyed by the realpath of a root, **outside every root** in the user's config
  folder, so a project that is cloned or zipped with its own `.indaba/` arrives unconfirmed. It holds no secret.
- The child's error stream is bounded (already) and redacted and sanitised before the page or a log sees it.
- A write is a state change by the person: it carries the token and a same-origin `Origin`.

## 7. Where it lives

- `@indaba/core` `web-contract`: the request and response types (declarations only, no `node:`).
- `@indaba/server`: the resources, the `RunControl` interface, the check changes; no process, no file write.
- `indaba` (the CLI): `RunControl` implemented with the scan, `createRunStarter` extended with `kill()`, the run copy and
  the confirmation store, and the teardown at the end of `indaba ui`.
- `@indaba/web`: the Run a workflow panel, the confirmation, the starting state, the Stop button and the messages.

## 8. Clarifications

- **C-01. One process per run** (resolves parent C-12 as confirmed). The server starts `indaba run` as a child, as
  `indaba run --tui` does, so a run started from the page and one started in a terminal are the same thing, and one
  failing never takes the page down. `release()` is not used: closing `indaba ui` cancels, then kills what remains.
- **C-02. Two ids.** `startId` is the task id and exists from the start; `runId` is the trace id and exists once the
  engine opens the trace. AC-08 says how one becomes the other. `isRunId` validates shape for both.
- **C-03. Where the confirmation is kept.** A file in the user's config folder (the folder is a parameter, so a test
  passes a temporary one), `{ "<realpath of root>": { "<relative path>": ["<sha256>", ...] } }`, at most 10 hashes per
  workflow (oldest dropped), written atomically. The hash covers the file's bytes, so a change of whitespace asks again;
  that is the safe direction.
- **C-04. What the summary lists.** Derived from the parsed definition of the same buffer that is hashed and run, so what
  is shown is what will run. See AC-04 for the items and the stated limit.
- **C-05. Limits are starting values, not measurements.** `MAX_CONCURRENT_RUNS = 4`, `STOP_GRACE_MS = 5000`, scan depth
  4, at most 200 workflow files, files over 1 MiB skipped and listed as invalid. Each is a named constant whose comment
  says it is a starting value; none was measured.
- **C-06. Contract version.** `CONTRACT_VERSION` goes from `1.0.0` to `1.1.0` (additive). A page of major 1 keeps working.
- **C-07. Why a separate `starts` resource** (a decision taken while applying the review, which proposed overloading
  `GET /runs/{startId}`). A start that has no trace has no `RunSnapshot`, and a response that is sometimes a run and
  sometimes not would make every client branch on it. `GET /starts/{startId}` has one shape.

## Artifacts not written

- `research.md`: nothing here needs a comparison; parent C-12 was the decision.
- `data-model.md`: the stored file is described in C-03.
- `events.md`: the slice emits no engine event and adds no span; the server and the command line write log records
  (`server.runs`, `cli.ui`) under the existing logging contract.
