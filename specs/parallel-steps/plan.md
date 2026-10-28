# Plan: Parallel steps

> Stage 3. Contract: [`api-surface.md`](api-surface.md). Behaviour: [`spec.md`](spec.md).
> **Prerequisite:** `specs/run-blackboard` is implemented first (the board writer, `BoardKind`, the digest). Slices 1 and
> 2 below do not need it and can land before it; slices 3 and 4 do.

## Where each piece goes

| Piece | Package | Why there |
| :--- | :--- | :--- |
| `maxParallel`, `maxWaits` on `WorkflowDefinition`; `touches` on `StepDefinition` | `@indaba/core` (`workflow/model.ts`) | the model |
| `admit`, `meets`, `parallelGroups`, `runsInProject` | `@indaba/core` (new `workflow/schedule.ts`) | pure decisions, testable without I/O |
| `Intent`, `Contract`, `parseIntent`, `INTENT_INSTRUCTION`, `contractSection` | `@indaba/core` (new `mesh/intent.ts`) | text parsing and prompt text, no I/O |
| `BoardKind.Intent`, `BoardKind.Contract` | `@indaba/core` (the board module of `run-blackboard`) | closed set of kinds lives with the board |
| parse and validate `max_parallel`, `max_waits`, `touches` | `@indaba/engine` (`parser/`) | existing parser and validator |
| `parallel:` section of `indaba.config` | `@indaba/engine` (`config/project-config.ts`) | where `logging:` is read |
| `Workspace.fork`, `Workspace.land`, `ConflictHunk` | `@indaba/engine` (`workspace/`) | the only code that runs git for a task |
| the pool: admission, per-step abort controllers, settling | `@indaba/engine` (new `engine/step-pool.ts`) | keeps `WorkflowEngine.run` readable; reusable by other engine features |
| intent call, negotiation, resolution | `@indaba/engine` (new `engine/coordination.ts`) | needs the executor, the board writer and the workspace |
| the run loop over the pool | `@indaba/engine` (`engine/workflow-engine.ts`) | the existing composition point |
| `--parallel`, `INDABA_PARALLEL`, resolving the limit and its source, the consequences text | `indaba` (`main.ts`, new `parallel.ts`) | the composition root resolves configuration |
| groups in `indaba plan` | `indaba` (`main.ts`, plan output) | existing command |
| several running steps, waiting steps, intents and contracts | `@indaba/engine` (run view model), `@indaba/tui`, `@indaba/server`, `@indaba/web` | the views read the stream and the board |

## The run loop

`WorkflowEngine.run` keeps its preamble (MCP preflight, permissions, the DAG, the root span) and its teardown. The `while`
over `order` is replaced by a loop over a `StepPool`:

1. Ask `admit(...)` which steps to start. With `limit` 1 it returns at most the first ready step in order, and the
   `projectDir` rule cannot bite, so the sequence is today's.
2. For each admitted step, start `runOne(step)` as a promise in the pool, with its own `AbortController` chained to the
   run's signal.
3. Await the first promise of the pool to settle (`Promise.race` over the pool's entries, each tagged with its step id).
4. Apply its result exactly as the body of today's loop does: `ok` → mark complete; failure → retry target and
   descendants (aborting running descendants, spec AC-28), or halt (spec AC-27); cancelled → halt and abort all.
5. Repeat until nothing runs and nothing can be admitted.

`runOne` with `limit` 1 is today's body: workspace choice, staging, `execute`, `exportPatch`. With `limit` above 1 and a
worktree step it is the stages of spec section 3:

```
intent call → post intent → meets? → wait (return "put back") | negotiate → fork → execute in fork →
guards (inside execute, as today) → review (inside execute when step-verdicts ships) → land → resolve if needed
```

"Put back" is a result of `runOne`, not an exception: the loop moves the step back to `PENDING` without a transition
(it never left `PENDING`: the intent call happens before `RUNNING`, see below) and increments its wait count.

**State transitions.** The intent call and the negotiation happen while the step is still `PENDING`, so a step that is
put back has nothing to undo. The step moves to `RUNNING` when its fork is created. Landing and resolution happen while
it is `VALIDATING`, before `COMPLETED`; a landing that fails moves it to `FAILED` as a guard failure does.

**Determinism.** `admit` sorts by topological position. The only non-deterministic input is which promise settles
first, and every decision taken on a settlement depends only on the states, never on time. Tests drive the pool with
fake runners whose completion order the test controls.

## Workspaces: fork and land

The run worktree is today's `GitWorktree`, created by `WorkspaceManager.create(taskId)`. Its changes are not committed:
it is a detached worktree with a working tree that differs from `HEAD`.

- **`fork(name)`**: `diff()` the parent (already stages everything and returns a binary diff against `HEAD`), create a
  worktree at the parent's `HEAD` through `create(taskId, name)` (the existing `variant` parameter gives
  `.indaba/worktrees/<taskId>-<name>`), `git apply --binary --index` the parent's diff there, and commit it on the
  child's detached `HEAD` (`-c user.name=indaba -c user.email=indaba@localhost -c commit.gpgsign=false commit
  --no-verify --allow-empty -m "indaba fork base"`). The child's `HEAD` is then the fork point, so today's `diff()` of
  the child is exactly its own change, and `git status` in it shows only its own change. The commit lives only on a
  detached head of a worktree that is removed; nothing reaches a branch, and the user's hooks are not run.
- **`land(child)`**: under the pool's landing lock,
  1. take the child's change: the child's `diff()`;
  2. fork a *landing* worktree from the run worktree;
  3. `git apply --3way --index` the child's change there;
  4. if `git diff --name-only --diff-filter=U` is empty, apply the landing worktree's `diff()` to the run worktree (clean by construction: nothing else lands while the lock is held) and remove the landing
     worktree; return `{ ok: true }`;
  5. otherwise keep the landing worktree (it holds the conflict markers) and return `{ ok: false, conflicts }`, with
     the hunks read from the conflicted files, bounded per hunk and per file, paths made relative and confined.
- **Resolution** happens in the landing worktree of step 5: it is the "fresh fork from the run worktree" of spec AC-24,
  already holding both sides. After the agent and the guards, its `diff()` lands as in step 4.

Every git call goes through `Git` with argument arrays. `diff_within_scope` and `git_diff_empty` read `git status` in
the step's working directory; because the fork point is the fork's `HEAD`, they see only the step's own change, with no
change to either guard.

## Coordination

- **Intent call.** A `RunRequest` to the step's runner chain (same role, model, permissions and MCP as the step) with
  the step's goal, the board digest and `INTENT_INSTRUCTION`; read-only permission level for that call when
  `agent-permissions` offers one, otherwise the step's own level and a prompt that says not to edit. Its output is parsed
  by `parseIntent`; a shell step's intent is its `touches`. The call is a child span `indaba.step.intent`.
- **Negotiation.** A synthetic debate `StepDefinition` built from the steps that meet: `id` the first of `negotiate-<first>`,
  `negotiate-<first>-2`, `negotiate-<first>-3`, ... that no step of the workflow (and no earlier synthetic step of the
  run) uses, so it cannot collide with a declared id and is still deterministic;
  `role` of the first in order, `consensusWith` the others' roles, `goal` from the intents, `arbiter` of the first step
  or the workflow default. It runs through `StepExecutor.run` in the run worktree (read-only by instruction), so the
  transcript, the decision ledger, the arbiter and the redaction work as for any debate. The agreed contract is the last
  `PROPOSAL` the closing `AGREEMENT`s answered, parsed into a `Contract`; a proposal that does not parse is treated as
  no agreement. The debate runs once, under its own span; each step involved gets a child span
  `indaba.step.negotiation` linked to it, so every participant's trace shows the negotiation, not only the first's.
- **The decider after a failed negotiation (spec AC-16).** `PluginHost.registerNegotiationDecider`, stored by the
  CLI's `RegistryPluginHost` and passed to the engine as `WorkflowEngineOptions.negotiationDecider`, exactly as
  adjudicators are registered and passed today. With none registered the answer is the default (one after another,
  topological order). `agent-conversation` registers its decider through the same call.
- **Resolution.** The step's runner chain in the landing worktree with its own diff, the hunks, and the other step's
  intent, contract and board notes as fenced sections; then the guards; then a synthetic debate of the two roles over
  the combined diff, as for a negotiation.

## The limit and the consequences text

`indaba` resolves the limit as it resolves the log level: flag, variable, file, default, recording the source. The
consequences text (spec AC-04a) is one exported constant in `indaba` (`PARALLEL_CONSEQUENCES`), printed at the start of
a run with a limit above 1, shown by the TUI Settings and the run panel. A test asserts that `docs/workflow-format.md`
contains the same text, so the documentation cannot drift from it.

## Tests

- `@indaba/core`: `admit` (limit 1 equals today's order; project-directory steps alone; topological order among
  ready steps; halted admits nothing; anti-starvation at `maxWaits`), `meets` (paths, globs by literal prefix,
  provides/needs), `parseIntent` (forms, ignored lines, bounds), `parallelGroups`.
- `@indaba/engine`: the trace-file byte-for-byte test at limit 1 (spec AC-05); pool tests with fake runners and a
  controlled completion order for every row of spec section 9; `fork` and `land` against temporary git repositories
  (clean land, conflict with hunks, binary file, new and deleted files, path confinement); negotiation and resolution
  with fake participants; cancellation and teardown counting worktrees.
- `indaba`: limit resolution order and errors; the consequences text appears exactly when the limit is above 1; plan
  groups.
- Views: two running steps and a waiting step in the TUI and the web run view.

## Analysis (stage 5)

- **Published signatures.** `Workspace` gains two methods; it has no implementer outside this repository and is not a
  `PluginHost` extension point (checked: `PluginHost` registers runners, guards, adjudicators and listeners, not
  workspaces). Minor, recorded in `api-surface.md`.
- **The domain stays pure.** `schedule.ts` and `intent.ts` import only `@indaba/core`; glob matching by literal prefix
  needs no library.
- **No new runtime dependency.** Git, the existing YAML parser and the existing mesh suffice.
- **Untrusted data.** Intent lines, contracts and conflict hunks are agent or git output: bounded, cleaned, redacted,
  fenced in prompts; paths confined before use; ids validated before they reach a worktree name. Nothing reaches a
  shell.
- **Clock, randomness, environment.** None in `admit` or `meets`; `INDABA_PARALLEL` is read only in the CLI composition
  root.
- **Bounded.** The pool is bounded by the limit; waits by `maxWaits`; negotiations and resolutions by the debate round
  limit; one resolution per landing; hunks by size. Worktrees at once: limit + one landing + the run worktree.
- **Guards in a fork.** `diff_within_scope` and `git_diff_empty` read `git status`, which in a fork compares with the
  fork-point commit, so a fenced step is judged on its own change, not its siblings'. No guard changes. A test pins it.
- **Performance.** A landing creates and removes one worktree. On a large repository that is the dominant cost of
  landing; measured in the e2e run before any optimisation (a shared landing worktree reset between landings is the
  obvious next step, not taken without a measurement).

Nothing failed the analysis; no return to stage 3.
