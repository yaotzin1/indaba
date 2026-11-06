# Plan: step stalls

> The first part covers **release 1** (`timeout_seconds`), implemented. Release 2 (`stall`, its retry, `StallCapable`) is planned
> in the last part, "Release 2 plan". Paths in the release 1 part were read in the repository on 2026-11-05.

## Modules touched

| File | Change |
| :--- | :--- |
| `packages/core/src/workflow/model.ts` | `StepDefinition.timeoutSeconds?: number` (absent, never `undefined`, under `exactOptionalPropertyTypes`); `MAX_TIMEOUT_SECONDS = 86400`. `defineStep` needs no change: it spreads `init`. |
| `packages/core/src/mesh/runner-participant.ts` | `RunnerParticipantOptions.timeoutSeconds?: number`; `respond` adds it to the `RunRequest` only when set. |
| `packages/core/src/index.ts` | exports `MAX_TIMEOUT_SECONDS` (already re-exports the mesh and workflow modules; confirm). |
| `packages/engine/src/parser/parser.ts` | reads `timeout_seconds` (a whole number 1 to 86400) beside `isolation` (around line 290); the message in `api-surface.md`. The existing refusal inside `permissions` (line 414) is untouched (C-01). |
| `packages/engine/src/engine/step-executor.ts` | the effective limit of a step is `step.timeoutSeconds ?? this.timeoutSeconds`; used in `runShell` (line 250) and `runAgent` (line 315), and passed to `RunnerParticipant` in the debate branch (line 568). |
| `packages/engine/src/engine/workflow-engine.ts` | sets `indaba.step.timeout_seconds` on the step span (line 319) only when the step has the field. |
| `packages/engine/src/editor/schema.ts` | adds `timeout_seconds` to the step schema (what `indaba schema` prints). |
| `packages/cli/src/main.ts` | `plan` prints `timeout Ns` in a step's extras (around line 880) when set. |
| `docs/workflow-format.md`, `docs/playbook.md`, `docs/ai-playbook.md`, `docs/README.md`, `site/` page build, `llms.txt`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md` | documentation moves with the change (the docs-site rule). |

No new package, no new runtime dependency, no change in `@indaba/runners`: every runner already honours
`RunRequest.timeoutSeconds` (checked: `process-runner.ts`, `acp-runner.ts`, `openrouter-runner.ts`).

## Where the behaviour lives

The field is data on the step (pure domain, no `node:`). The precedence rule (step, then `--timeout`, then 900) is one
expression in the executor, which already receives the global option; the `900` default stays where it is
(`DEFAULT_TIMEOUT_SECONDS`). The parser validates the number before anything runs. The runners are untouched.

## Trade-offs taken

- **Debates get the step's limit but not the global one.** A debate does not use `--timeout` today (the participant sends
  no limit, so each runner applies 900). Extending the global to debates would change runs that work today; only a step
  that writes the field gets a new behaviour. Cost accepted: `--timeout 60` still does not bound a debate.
- **`timeout_seconds` is not refused anywhere except by range.** It is valid on shell, agent and debate steps (AC-14).
- **The limit is per call, not per step** (AC-02). A step that retries its runner chain, or a debate with many rounds, can
  take longer than the number. This is today's meaning of `--timeout` and the docs say so.

## Risks

| Risk | Mitigation |
| :--- | :--- |
| A workflow that has a `timeout_seconds` key today (the parser may ignore unknown keys, or reject them) changes behaviour | analysed 2026-11-05: the parser does not reject unknown step keys (`unknownKeys` is used only for the board block), so a file that already carries a `timeout_seconds` is silently ignored today and will start to apply. Accepted (it is what the author wrote); stated in the CHANGELOG. A test pins a file without the field to today's result (AC-20). |
| Reading `permissions.timeout_seconds` and `timeout_seconds` is confusing | the refusal message is unchanged; `workflow-format.md` says the two are different things (C-01). |
| `RunnerParticipant` is exported from `@indaba/core`; a new optional option is a minor | classified in `api-surface.md` (R1 surface); no existing field changes. |

## Out of scope for this change

Everything marked R2: `stall`, the retry and restore, `StallCapable`, `RunRequest.stallSeconds`, `RunResult.stalled`,
`STALL_EXIT_CODE`, the event and the status reasons; a "last activity" signal (spec section 11, open); live thinking for
`claude-code`; the follow-up of C-08; applying `--timeout` to debates.

## Release 2 plan: `stall` and its retry

> Written 2026-11-06, after the measurement in [`research.md`](research.md) met the condition of spec section 11. Paths were read
> in the repository on that date. The contract is `api-surface.md` and `events.md`, amended the same day (60-second floor, a
> boolean `canReportActivity`, `RestorableWorkspace`).

### Modules touched

| File | Change |
| :--- | :--- |
| `packages/core/src/workflow/model.ts` | `StallPolicy`, `StepDefinition.stall?`, `MIN_STALL_SECONDS = 60`, `MAX_STALL_SECONDS = 3600`, `MAX_STALL_RETRIES = 3`. |
| `packages/core/src/runner/index.ts` | `RunRequest.stallSeconds?`; `RunResult.stalled?: true` and `RunResultInit.stalled?: true`, set only when true. |
| `packages/core/src/extension/stall.ts` (new) | `StallCapable`, `isStallCapable`; exported from `extension/index.ts` and the package index. |
| `packages/runners/src/process.ts` | `ProcessSpec.stallSeconds?`, `ProcessOutcome.stalled?`, `STALL_EXIT_CODE = 125`; `supervise` gains a silence timer that every chunk of either stream restarts, and a `'stall'` trip handled like a timeout (the tree is killed). Both the piped and the PTY path. |
| `packages/runners/src/process-runner.ts` | `executeProcess` passes `request.stallSeconds`; a stalled outcome becomes a result with `stalled: true` and `Stalled: no activity for N seconds.` in `errorOutput`. |
| `packages/runners/src/claude-runner.ts` | implements `StallCapable` (`canReportActivity` = `reportsUsage`). Nothing is added to the command line. |
| `packages/runners/src/index.ts` | exports `STALL_EXIT_CODE`. |
| `packages/engine/src/parser/parser.ts` | reads `stall`; the messages in `api-surface.md`; refuses AC-11 (shell, no agent, debate) and AC-13 (`retries` above 0 without `isolation: git_worktree` on the step itself). |
| `packages/engine/src/engine/stall.ts` (new) | `checkStalls(workflow, runners)`: AC-12, a runner of the chain that is not `StallCapable`; returns findings, no English. |
| `packages/engine/src/engine/step-executor.ts` | `runAgent` sends `stallSeconds` and turns `result.stalled` into a failed outcome carrying `stalled`; `invoke` sets `indaba.stall.silent_seconds` on that attempt's span; `stallFindings(workflow)`. |
| `packages/engine/src/engine/outcome.ts` | `StepOutcome.stalled?: { silentSeconds: number }` set by `StepOutcome.stalledFor(seconds)`; it is a failure for every consumer that ignores it. |
| `packages/engine/src/engine/workflow-engine.ts` | `run` refuses AC-12 findings beside the permission findings; `execute` loops over stall attempts inside the step span (see below). |
| `packages/engine/src/workspace/workspace.ts`, `git-worktree.ts` | `RestorableWorkspace`, `WorkspaceCheckpoint`, `isRestorable`; `GitWorktree.checkpoint` and `restore`. |
| `packages/engine/src/editor/schema.ts` | `stall` in the step schema. |
| `packages/cli/src/main.ts` | `validate`, `plan` and the run gate report AC-12 findings; `plan` prints `stall Ns` and `stall retries k`. A finding formatter in `stall-report.ts`, beside `permission-report.ts`. |
| `docs/workflow-format.md`, `docs/playbook.md`, `docs/ai-playbook.md`, `docs/cost-experiments.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md` | documentation moves with the change. |

No new package and no new runtime dependency.

### The attempt loop (`WorkflowEngine.execute`)

The loop lives in `execute`, not in the run loop, because the retry is "within the attempt" (AC-08, events.md): one step span,
several `invoke_agent` spans. For a step with `stall`:

1. Before each attempt: if `retries > 0`, take `checkpoint()` of the step's workspace.
2. Run the executor. If the outcome is not a stall, behave as today.
3. On a stall with retries left: end the attempt (the `invoke_agent` span is already an error with `silent_seconds`); `restore(checkpoint)`;
   re-stage the step's input artifacts (a restore removes untracked files the attempt did not find, and they are copied in
   again); add the `indaba.step.stalled` event with `retry: "restored"`; move `RUNNING -> FAILED` (`Stalled: no activity for N seconds.`)
   then `FAILED -> PENDING` (`... (retry k of n).`) then `PENDING -> RUNNING`; the next prompt's feedback is
   `Your previous attempt stalled: no activity for N seconds. Nothing it did was kept.`
4. On a stall with none left: event `retry: "exhausted"`, the step fails with `Stalled: no activity for N seconds.`, and `on_failure`
   applies as for any failure.
5. If the workspace is not `RestorableWorkspace`, or `checkpoint` or `restore` throws: event `retry: "restore_failed"`, the step
   fails with `The worktree could not be restored after a stall.`, no further attempt.

The counter is a local of `execute`, so it starts at zero each time the step is executed (AC-09). Cancellation: the signal is
checked before every attempt; a restore in progress is not interrupted, and the run's teardown removes the worktree anyway.

### The restore

`GitWorktree.checkpoint()` records `HEAD` and the list of untracked, non-ignored files (`git rev-parse HEAD`;
`git ls-files -z --others --exclude-standard`), refusing with a `WorkspaceError` above 10 000 untracked files (bounded).
`restore()` runs `git reset --hard <head>` and `git clean -f -d -- <the untracked files that are not in the checkpoint>`, in chunks.
Both use the `Git` wrapper (argument arrays, `shell: false`). The hash is checked against `^[0-9a-f]{40,64}$` and the paths come
from git's own list, so nothing from a workflow or a model reaches the command. Ignored files are never touched (spec section 6).
What this cannot undo, and the docs say: an untracked file that existed before the attempt and was **changed** by it (git has no
copy of it). The cookbooks' checkpoint steps, which commit, are what keep that set small.

### Where silence is measured

In the process layer, once, for every process runner: `supervise` already owns the timeout and the abort; it gains one more timer.
A chunk from stdout or stderr restarts it; it does nothing else. This is the same place a timeout kills the tree, so a stalled
process dies exactly as a timed-out one does (`killTree`, then the forced kill, then the close wait). Starting the clock at spawn
is spec C-16.

### Built-in runners (AC-17)

| Runner | Offers `StallCapable`? | Why |
| :--- | :--- | :--- |
| `claude-code` | yes, while it reads `stream-json` (the default) | its stream carries `thinking_tokens`, assistant messages and `tool_progress`; measured 2026-11-06 in `research.md`. In plain mode (`reportUsage: false`, or its own `--output-format`) it answers `false`: nothing arrives before the end |
| `codex`, `antigravity`, `cursor`, `opencode` | no | their output is read on a terminal or plain pipes and its silence while healthy has not been measured; a guess here would stop working calls. They are refused in a step that sets `stall`, by name |
| `acp` | no | the protocol carries updates, but which of them mean progress, and their spacing, is unmeasured |
| `openrouter` and other OpenAI-compatible runners | no | an HTTP stream; `timeout_seconds` bounds it, and these runners change no files, so there is nothing to restore |
| `shell` | no | refused by AC-11; a shell step is limited by `timeout_seconds` only |

A plugin's runner is refused unless it implements `StallCapable` (AC-21).

### Trade-offs taken

- **One timer, two streams.** stderr text counts as activity. A tool that only logs to stderr is alive.
- **Not reset by the engine.** Only the runner sees data; the engine never learns of activity (C-04).
- **No grace for startup.** The 60-second floor covers it (C-16).
- **The checkpoint is git's, not a copy.** Cheaper, and honest about what it cannot restore.

### Analysis (stage 5), before any code

| Question | Answer |
| :--- | :--- |
| A published signature broken without the right version? | No. Every addition is optional: `RunRequest.stallSeconds?`, `RunResult.stalled?`, `ProcessSpec.stallSeconds?`, `ProcessOutcome.stalled?`, `StepDefinition.stall?`, a new interface `StallCapable`, a new optional `RestorableWorkspace`. Minor. |
| A `node:` import or I/O in `@indaba/core`? | No. The core gains types, constants and one guard function. The timer and the git calls are in `runners` and `engine`. |
| A new runtime dependency? | No. |
| Untrusted data reaching a shell, a path, a URL or a log? | The numbers are validated whole numbers within bounds before anything runs. Reasons contain numbers and fixed text. The restore passes a validated hash and git's own file list as arguments, never a shell string. No prompt or output is copied to a span or event (AC-19). |
| A wall clock, randomness or environment read in decision logic? | The silence timer uses `setTimeout` in the process layer, as the timeout already does. The engine decides on a flag in the outcome, not on a clock. |
| An unbounded loop, retry or buffer? | Attempts are at most `1 + retries` (3 retries at most) per execution; the untracked-file snapshot is capped at 10 000 entries; the restore runs in chunks. |
| Does a failure surface a sentence a person can act on? | Yes: the three fixed reasons, and the validation messages name the step and the runner. |
| Can a healthy call be stopped? | Only if it is silent for the whole `after_seconds`, at least 60. The measurement found 30 s as the longest healthy gap; the docs tell authors to set it several times above the longest tool call a step makes. |
