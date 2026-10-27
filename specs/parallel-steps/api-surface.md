# API surface contract: Parallel steps

> **Provisional (stage 1).** Written with the specification so the surface can be reviewed with it. It becomes the
> contract at stage 3, after the decisions in `spec.md` section 8 are confirmed; from then on it is immutable during
> stage 6, and an implementation that finds it wrong stops and returns to stage 3.

## Semver classification

**minor** (below 1.0).

Reasoning: every addition is optional. `WorkflowDefinition.maxParallel` is optional, so code that builds a
`WorkflowDefinition` literal still compiles. `maxParallelSteps` defaults to 1, which reproduces today's order, workspace
handling and events (spec AC-01). The one new span attribute is additive. Consumers that assumed at most one `RUNNING`
step are not broken by this release, because with the default they never see two; they are broken by whichever later
release raises the default, which ships as a labelled change (spec C-01).

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core` (`workflow/model.ts`) | field | `WorkflowDefinition.maxParallel?: number` (from `max_parallel`) |
| `@indaba/core` (`workflow/schedule.ts`) | function | `nextSteps(input: ScheduleInput): readonly string[]`, pure: the step ids to start now |
| `@indaba/core` (`workflow/schedule.ts`) | interface | `ScheduleInput { readonly order: readonly StepDefinition[]; readonly states: ReadonlyMap<string, StepStatus>; readonly running: ReadonlySet<string>; readonly limit: number; readonly runsInProject: (step: StepDefinition) => boolean; readonly halted: boolean }` |
| `@indaba/core` (`workflow/schedule.ts`) | function | `parallelGroups(order: readonly StepDefinition[], limit: number, runsInProject: (step: StepDefinition) => boolean): readonly (readonly string[])[]`, for `indaba plan` |
| `@indaba/engine` (`engine/workflow-engine.ts`) | field | `WorkflowEngineOptions.maxParallelSteps?: number` (default 1) |
| `@indaba/engine` (`engine/workflow-engine.ts`) | field | `RunOptions.onStepOutput?: (stepId: string, chunk: string) => void` |
| `@indaba/engine` (`workspace/workspace.ts`) | method | `Workspace.fork(name: string): Promise<Workspace>`: a worktree of this one's current state |
| `@indaba/engine` (`workspace/workspace.ts`) | method | `Workspace.land(child: Workspace): Promise<LandResult>`: three-way apply of the child's diff since its fork |
| `@indaba/engine` (`workspace/workspace.ts`) | type | `LandResult = { readonly ok: true } \| { readonly ok: false; readonly conflicts: readonly string[] }` (project-relative paths) |

`Workspace` is an interface implemented in this repository by `GitWorktree` (and by the copy workspace of
`specs/workspace-without-git` when that ships). Adding two methods to it breaks a third-party implementation; there is
none outside this repository today, and `WorkspaceManager` is not a `PluginHost` extension point. To be confirmed at
stage 3; if a public implementer is found, the methods move to a separate optional interface instead.

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `RunOptions.onOutput` | live output of the running step | live output of every running step, interleaved; unchanged when one step runs | none at the default; a consumer that needs to tell steps apart uses `onStepOutput` |

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow file | top-level `max_parallel` (integer, at least 1) | added |
| JSON schema (`indaba schema`) and catalog | `max_parallel` | added, with its description |
| CLI | `indaba run --parallel <n>`, `indaba ui --parallel <n>` | added |
| CLI | `indaba plan` | prints the groups of spec AC-19 (added output; existing lines unchanged) |
| span attribute | `indaba.workflow.max_parallel` on the root span | added |
| events | none | unchanged classes; events of different steps interleave (spec AC-17) |
| filesystem | `.indaba/worktrees/<taskId>-<stepId>` for step worktrees | added (exact naming confirmed at stage 3 against `GitWorktreeManager`) |
| log records | step started, landed, landing conflicted, aborted for a retry | added (spec AC-21) |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| `maxParallelSteps` | (none: one at a time) | 1 |
| `max_parallel` | (none) | unset: the engine's limit applies |

## Checks

- [ ] Every type appearing in a new public signature is itself public (or deliberately marked `@internal` and not re-exported from the package index)
- [ ] Implementations are not exported for subclassing; the extension point is an interface
- [ ] Collections are typed precisely and read-only where they are not mutated (`readonly T[]`, `Readonly<Record<string, V>>`)
- [ ] `pnpm qa` (Biome, `tsc` strict, Vitest) passes with no suppression comment
