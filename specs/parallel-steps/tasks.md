# Tasks: Parallel steps

> Stage 4. Each task is independently checkable and ships with its tests. Slices 1 and 2 need nothing unimplemented;
> slices 3 and 4 need `specs/run-blackboard` implemented first.

## Slice 1: the pool, with nothing new switched on

The limit exists but no workflow sees a difference unless it asks for more than 1, and worktree steps still share the
run worktree. Ships the scheduling and the configuration.

- [ ] T-01. `@indaba/core`: `maxParallel`, `maxWaits`, `touches` on the model. Tests: literals without them compile.
- [ ] T-02. `@indaba/core`: `schedule.ts` (`admit`, `runsInProject`, `parallelGroups`). Tests: limit 1 reproduces
  today's order on every example workflow; project-directory steps alone; halted admits nothing.
- [ ] T-03. `@indaba/engine`: parse and validate `max_parallel`, `max_waits`, `touches` (shell steps only); schema and
  catalog descriptions. Tests: every validation message names the field.
- [ ] T-04. `@indaba/engine`: `parallel:` in `indaba.config`, `ResolvedParallel`. Tests: defaults, problems naming the key.
- [ ] T-05. `@indaba/engine`: `StepPool` and the run loop over it; `maxParallelSteps`, `maxWaits`, `onStepOutput`.
  Without forks (slice 2), worktree steps still share the run worktree and project-directory steps run alone, so the
  pool keeps worktree steps to one at a time (a constant cap, removed in T-08). Slice 1 is the plumbing; it changes no
  run. Tests: the trace-file byte-for-byte test at limit 1 and at limit 3; retries, halting and cancellation through the
  pool with fake runners.
- [ ] T-06. `indaba`: `--parallel`, `INDABA_PARALLEL`, resolution order and source, the root span attributes,
  `PARALLEL_CONSEQUENCES` printed when the limit is above 1, plan groups. Tests: resolution order and errors.
- [ ] T-07. Docs: `docs/workflow-format.md` (fields, the consequences text), `docs/logging.md`'s neighbour section for
  `parallel:` in `indaba.config`, CHANGELOG under Unreleased (minor).

## Slice 2: forks and landing

- [ ] T-08. `@indaba/engine`: `Workspace.fork`, `Workspace.land`, `ConflictHunk`, in `GitWorktree`. Tests against
  temporary repositories: clean land, conflict with hunks, binary, new and deleted files, confinement, guards in a fork
  see only the fork's change. Remove the slice-1 cap.
- [ ] T-09. `@indaba/engine`: `runOne` forks, lands under the landing lock, writes `patch` after each landing; a
  conflicting landing fails the step with the files named (the resolution of slice 4 is not there yet). Tests: every
  row of spec section 9 that does not involve the board.
- [ ] T-10. Views: several running steps in the run view model, the TUI and the web run view (spec AC-30).

At the end of slice 2 parallel runs work without coordination. **Slice 2 is not released on its own**: the maintainer
decided that agents in parallel steps always talk (C-11), so a release with slice 2 and without slice 3 would break that
promise. Slices 2 to 4 merge to `main` behind the slice-1 cap kept on for releases until slice 4 is in (a constant, not
a setting, removed in T-15).

## Slice 3: intents and negotiation (needs `run-blackboard`)

- [ ] T-11. `@indaba/core`: `intent.ts` (`Intent`, `Contract`, `parseIntent`, `INTENT_INSTRUCTION`, `contractSection`,
  `NegotiationDecider`, `PluginHost.registerNegotiationDecider` and `RegistryPluginHost`), `meets`, the two board
  kinds; changelog entries naming the `PluginHost` addition and the union members (`api-surface.md`). Tests: parsing forms and bounds; meeting rules.
- [ ] T-12. `@indaba/engine`: the intent call, posting the intent, putting back with `maxWaits`, the negotiation through
  a synthetic debate, posting the contract, the decider seam with its default. Tests with fake participants.
- [ ] T-13. Views: waiting steps, intents and contracts.

## Slice 4: resolution and review before landing

- [ ] T-14. `@indaba/engine`: resolution in the landing workspace (agent, guards, debate of the two roles, arbiter); one
  per landing; does not count against `max_retries`. Tests with fake participants and real git.
- [ ] T-15. Review before landing (spec AC-21) wired to whatever review `step-verdicts` provides at that time, or noted
  as pending in `review.md` if it has not shipped. Remove the release cap.
- [ ] T-16. `review.md` against the seven dimensions with the gates' actual output; DEPENDENCY_MAP status; positioning
  page row moves to "Works".
