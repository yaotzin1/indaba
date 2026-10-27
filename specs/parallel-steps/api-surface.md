# API surface contract: Parallel steps

> **Provisional (stage 2).** Written with the specification so the surface can be reviewed with it. It becomes the
> contract at stage 3, after the decisions in `spec.md` section 12 are confirmed; from then on it is immutable during
> stage 6, and an implementation that finds it wrong stops and returns to stage 3.

## Semver classification

**minor** (below 1.0).

Reasoning: every addition is optional. `WorkflowDefinition.maxParallel` is optional, so code that builds a
`WorkflowDefinition` literal still compiles. The limit defaults to 1, which reproduces today's order, workspace
handling and events (spec AC-01). The one new span attribute is additive. Consumers that assumed at most one `RUNNING`
step are not broken by this release, because with the default they never see two; they are broken by whichever later
release raises the default, which ships as a labelled change (spec C-01).

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core` (`workflow/model.ts`) | field | `WorkflowDefinition.maxParallel?: number` (from `max_parallel`) |
| `@indaba/core` (`workflow/model.ts`) | field | `StepDefinition.touches?: readonly string[]` (from `touches`, shell steps only) |
| `@indaba/core` (`workflow/schedule.ts`) | function | `admit(input: AdmitInput): readonly string[]`, pure: the step ids to admit now |
| `@indaba/core` (`workflow/schedule.ts`) | interface | `AdmitInput { readonly order: readonly StepDefinition[]; readonly states: ReadonlyMap<string, StepStatus>; readonly running: ReadonlySet<string>; readonly waiting: ReadonlyMap<string, number>; readonly limit: number; readonly runsInProject: (step: StepDefinition) => boolean; readonly halted: boolean }` (`waiting`: times each step was put back) |
| `@indaba/core` (`workflow/schedule.ts`) | function | `meets(a: Intent, b: Intent): boolean` (spec AC-12) |
| `@indaba/core` (`workflow/schedule.ts`) | function | `parallelGroups(order: readonly StepDefinition[], limit: number, runsInProject: (step: StepDefinition) => boolean): readonly (readonly string[])[]` |
| `@indaba/core` (`mesh/intent.ts`) | interface | `Intent { readonly stepId: string; readonly paths: readonly string[]; readonly provides: readonly { readonly name: string; readonly summary: string }[]; readonly needs: readonly string[] }` |
| `@indaba/core` (`mesh/intent.ts`) | function | `parseIntent(stepId: string, text: string): { readonly intent: Intent; readonly ignored: number }` |
| `@indaba/core` (`mesh/intent.ts`) | interface | `Contract { readonly steps: readonly string[]; readonly paths: Readonly<Record<string, readonly string[]>>; readonly interfaces: readonly { readonly name: string; readonly shape: string }[]; readonly decidedBy: 'consensus' \| 'arbiter' }` |
| `@indaba/core` (board kinds, `specs/run-blackboard`) | enum members | `BoardKind.Intent = 'intent'`, `BoardKind.Contract = 'contract'`, engine-written only |
| `@indaba/engine` (`config/project-config.ts`) | field | `ProjectConfig.parallel?: { readonly maxSteps: number }` (from `parallel.max_steps`) |
| `@indaba/engine` (`engine/workflow-engine.ts`) | field | `WorkflowEngineOptions.maxParallelSteps?: number` (default 1) |
| `@indaba/engine` (`engine/workflow-engine.ts`) | field | `RunOptions.onStepOutput?: (stepId: string, chunk: string) => void` |
| `@indaba/engine` (`workspace/workspace.ts`) | method | `Workspace.fork(name: string): Promise<Workspace>` |
| `@indaba/engine` (`workspace/workspace.ts`) | method | `Workspace.land(child: Workspace): Promise<LandResult>` |
| `@indaba/engine` (`workspace/workspace.ts`) | type | `LandResult = { readonly ok: true } \| { readonly ok: false; readonly conflicts: readonly ConflictHunk[] }`, paths project-relative |
| `@indaba/engine` (`workspace/workspace.ts`) | interface | `ConflictHunk { readonly path: string; readonly ours: string; readonly theirs: string }`, each text bounded and cleaned before it reaches a prompt |

`Workspace` is an interface implemented in this repository by `GitWorktree` (and by the copy workspace of
`specs/workspace-without-git` when that ships). Adding two methods to it breaks a third-party implementation; there is
none outside this repository today, and `WorkspaceManager` is not a `PluginHost` extension point. To be confirmed at
stage 3; if a public implementer is found, the methods move to a separate optional interface instead.

Adding members to `BoardKind` is additive for readers that treat an unknown kind as unknown, which the board reader
does (`specs/run-blackboard` AC-30).

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
| workflow file | step field `touches` (list of paths or globs; shell steps) | added |
| JSON schema (`indaba schema`) and catalog | `max_parallel`, `touches` | added, with descriptions |
| `indaba.config` | section `parallel:` with `max_steps` | added |
| environment | `INDABA_PARALLEL` | added |
| CLI | `indaba run --parallel <n>`, `indaba ui --parallel <n>` | added |
| CLI | `indaba plan` | prints the groups of spec AC-32 (added output; existing lines unchanged) |
| prompt | the intent instruction (`INTENT`, `PROVIDES`, `NEEDS` lines) and the contract section of a work prompt | added; the text is part of the contract once released |
| board | entries of kind `intent` and `contract` | added |
| span attributes | `indaba.workflow.max_parallel`, `indaba.workflow.max_parallel.source` on the root span | added |
| spans | child spans of a step for the intent call, the negotiation, the landing and the resolution | added (names fixed at stage 3 under the GenAI conventions) |
| events | none | unchanged classes; events of different steps interleave (spec AC-30) |
| filesystem | step and resolution worktrees under `.indaba/worktrees/` | added (naming confirmed at stage 3 against `GitWorktreeManager`) |
| log records | spec AC-33 | added |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| the limit (`--parallel`, `INDABA_PARALLEL`, `parallel.max_steps`, `maxParallelSteps`) | (none: one at a time) | 1 |
| `max_parallel` | (none) | unset: the resolved limit applies |
| put back before admitted alone | (none) | 3 (a design choice, spec C-08) |

## Checks

- [ ] Every type appearing in a new public signature is itself public (or deliberately marked `@internal` and not re-exported from the package index)
- [ ] Implementations are not exported for subclassing; the extension point is an interface
- [ ] Collections are typed precisely and read-only where they are not mutated (`readonly T[]`, `Readonly<Record<string, V>>`)
- [ ] `pnpm qa` (Biome, `tsc` strict, Vitest) passes with no suppression comment
