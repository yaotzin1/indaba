# Tasks: Parallel steps

> Stage 4. Each task is independently checkable and ships with its tests. Slices 1 and 2 need nothing unimplemented;
> slices 3 and 4 need `specs/run-blackboard` implemented first.

## Slice 1: the pool, with nothing new switched on

The limit exists but no workflow sees a difference unless it asks for more than 1, and worktree steps still share the
run worktree. Ships the scheduling and the configuration.

- [x] T-01. `@indaba/core`: `maxParallel`, `maxWaits`, `touches` on the model. Tests: literals without them compile.
- [x] T-02. `@indaba/core`: `schedule.ts` (`admit`, `runsInProject`, `parallelGroups`). Tests: limit 1 reproduces
  today's order on every example workflow; project-directory steps alone; halted admits nothing.
- [x] T-03. `@indaba/engine`: parse and validate `max_parallel`, `max_waits`, `touches` (shell steps only); schema and
  catalog descriptions. Tests: every validation message names the field.
- [x] T-04. `@indaba/engine`: `parallel:` in `indaba.config`, `ResolvedParallel`. Tests: defaults, problems naming the key.
- [x] T-05 (done 2026-11-07; `StepPool` in `engine/step-pool.ts`, the run loop over `admit`, the cap is `PARALLEL_STEP_CAP`; the golden trace differs by the two root attributes and nothing else). `@indaba/engine`: `StepPool` and the run loop over it; `maxParallelSteps`, `maxWaits`, `onStepOutput`.
  Without forks (slice 2), worktree steps still share the run worktree and project-directory steps run alone, so the
  pool keeps worktree steps to one at a time (a constant cap, removed in T-08). Slice 1 is the plumbing; it changes no
  run. Tests: the trace-file byte-for-byte test at limit 1 and at limit 3; retries, halting and cancellation through the
  pool with fake runners.
- [x] T-06 (done 2026-11-07 for `indaba run` and `indaba plan`; **open: `indaba ui --parallel` and the limit in the Settings screens (AC-01, AC-04)**, which need the run control and the Settings screens and are left for the next change of slice 1; a request above the cap prints a notice instead of the consequences text, see the amendment of `api-surface.md`). `indaba`: `--parallel`, `INDABA_PARALLEL`, resolution order and source, the root span attributes,
  `PARALLEL_CONSEQUENCES` printed when the limit is above 1, plan groups. Tests: resolution order and errors.
- [x] T-07 (done 2026-11-07; `docs/workflow-format.md` holds the consequences text word for word, a test pins it). Docs: `docs/workflow-format.md` (fields, the consequences text), `docs/logging.md`'s neighbour section for
  `parallel:` in `indaba.config`, CHANGELOG under Unreleased (minor).

## Slice 2: forks and landing

- [x] T-08 (done 2026-11-09; `fork` and `land` on `GitWorktree` behind the optional `ForkableWorkspace` and `isForkable`, see the amendment of `api-surface.md`; **the slice-1 cap stays until T-09**, because without `runOne` forking, worktree steps would still share the run worktree). `@indaba/engine`: `Workspace.fork`, `Workspace.land`, `ConflictHunk`, in `GitWorktree`. Tests against
  temporary repositories: clean land, conflict with hunks, binary, new and deleted files, confinement, guards in a fork
  see only the fork's change. Remove the slice-1 cap.
- [x] T-09 (done 2026-11-10; the step's fork, the landing and the fork itself under one workspace lock, `land` hook in `execute`, retry aborts of running descendants; **the release cap stays**, lifted for tests by `WorkflowEngineOptions.maxParallelCap`, see the amendment of `api-surface.md`). `@indaba/engine`: `runOne` forks, lands under the landing lock, writes `patch` after each landing; a
  conflicting landing fails the step with the files named (the resolution of slice 4 is not there yet). Tests: every
  row of spec section 9 that does not involve the board.
- [x] T-10 (done 2026-11-10; the view model, `watch --plain`, the dashboard and the web run screen were already per step, so the change is the shared `activeSteps`, the header's "N running" and the web line "Running at the same time", with tests of two running steps in each view; **the waiting half of AC-30 is T-13**, it needs the board's intents). Views: several running steps in the run view model, the TUI and the web run view (spec AC-30).

At the end of slice 2 parallel runs work without coordination. **Slice 2 is not released on its own**: the maintainer
decided that agents in parallel steps always talk (C-11), so a release with slice 2 and without slice 3 would break that
promise. Slices 2 to 4 merge to `main` behind the slice-1 cap kept on for releases until slice 4 is in (a constant, not
a setting, removed in T-15).

## Slice 3: intents and negotiation (needs `run-blackboard`)

- [x] T-11 (done 2026-11-11; `mesh/intent.ts` with `parseContract`, `NEGOTIATION_INSTRUCTION` and the shared path comparison, `meets` and `mustWait` in `schedule.ts`, the board kinds kept out of every digest, the host method and `RegistryPluginHost.registeredNegotiationDecider()`; the TUI board pane marks the two new kinds; nothing runs yet, the engine side is T-12). `@indaba/core`: `intent.ts` (`Intent`, `Contract`, `parseIntent`, `INTENT_INSTRUCTION`, `contractSection`,
  `NegotiationDecider`, `PluginHost.registerNegotiationDecider` and `RegistryPluginHost`), `meets`, the two board
  kinds; changelog entries naming the `PluginHost` addition and the union members (`api-surface.md`). Tests: parsing forms and bounds; meeting rules.
- [x] T-12 (done 2026-11-11; `engine/coordination.ts`, `StepExecutor.intent`, `StepRunOptions.contract` and `debate`, the engine's `negotiationDecider` option passed by the CLI from `RegistryPluginHost`; deviations and gaps in the amendment of `api-surface.md` and in `review.md`; **the cap stays**). `@indaba/engine`: the intent call, posting the intent, putting back with `maxWaits`, the negotiation through
  a synthetic debate, posting the contract, the decider seam with its default. Tests with fake participants.
- [x] T-13 (done 2026-11-12; the engine records each wait as an `indaba.step.wait` span, the view model reads it into `StepView.waitingFor`, and `watch --plain`, the dashboard and the web run screen say which step waits for which; the dashboard's board pane already marks intents and contracts since T-11, the web view has no board, see `review.md`). Views: waiting steps, intents and contracts.

## Slice 4: resolution and review before landing

- [ ] T-14. `@indaba/engine`: resolution in the landing workspace (agent, guards, debate of the two roles, arbiter); one
  per landing; does not count against `max_retries`. Tests with fake participants and real git.
- [ ] T-15. Review before landing (spec AC-21) wired to whatever review `step-verdicts` provides at that time, or noted
  as pending in `review.md` if it has not shipped. Remove the release cap.
- [ ] T-16. `review.md` against the seven dimensions with the gates' actual output; DEPENDENCY_MAP status; positioning
  page row moves to "Works".
