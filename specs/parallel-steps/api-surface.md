# API surface contract: Parallel steps

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An implementation that finds
> this wrong stops and returns to stage 3; it does not edit this file. Confirmed at stage 3 on 2026-10-27 against the
> code on `main` (`WorkflowEngine`, `GitWorktree`, `GitWorktreeManager`, `PluginHost`, `ProjectConfig`).

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
| `@indaba/core` (`workflow/model.ts`) | field | `WorkflowDefinition.maxWaits?: number` (from `max_waits`) |
| `@indaba/core` (`workflow/model.ts`) | field | `StepDefinition.touches?: readonly string[]` (from `touches`, shell steps only) |
| `@indaba/core` (`workflow/schedule.ts`) | function | `admit(input: AdmitInput): readonly Admission[]`, pure: what to start now, in the order of spec AC-08a |
| `@indaba/core` (`workflow/schedule.ts`) | type | `Admission = { readonly kind: 'step'; readonly stepId: string } \| { readonly kind: 'owner'; readonly role: string }` |
| `@indaba/core` (`workflow/schedule.ts`) | function | `mustWait(intent: Intent, working: readonly Intent[]): string \| undefined`, pure: the id of the working step an intent meets (spec AC-13), or `undefined` |
| `@indaba/core` (`workflow/schedule.ts`) | interface | `AdmitInput { readonly order: readonly StepDefinition[]; readonly states: ReadonlyMap<string, StepStatus>; readonly running: ReadonlySet<string>; readonly waiting: ReadonlyMap<string, number>; readonly limit: number; readonly maxWaits: number; readonly ownerQueue: readonly string[]; readonly runsInProject: (step: StepDefinition) => boolean; readonly halted: boolean }` (`waiting`: times each step was put back; `ownerQueue`: owner roles with a request waiting, in board order, empty without `owners`) |
| `@indaba/core` (`workflow/schedule.ts`) | function | `meets(a: Intent, b: Intent): boolean` (spec AC-12) |
| `@indaba/core` (`workflow/schedule.ts`) | function | `runsInProject(step: StepDefinition, isolated: ReadonlySet<string>): boolean`, today's rule (no isolation and no isolated dependency) |
| `@indaba/core` (`workflow/schedule.ts`) | function | `parallelGroups(order: readonly StepDefinition[], limit: number, runsInProject: (step: StepDefinition) => boolean): readonly (readonly string[])[]` |
| `@indaba/core` (`mesh/intent.ts`) | interface | `Intent { readonly stepId: string; readonly paths: readonly string[]; readonly provides: readonly { readonly name: string; readonly summary: string }[]; readonly needs: readonly string[]; readonly requests?: readonly { readonly owner: string; readonly text: string }[] }`; `requests` is filled only by `specs/path-ownership` and is absent in a workflow without `owners` |
| `@indaba/core` (`mesh/intent.ts`) | function | `parseIntent(stepId: string, text: string): { readonly intent: Intent; readonly ignored: number }`, reads at most the first 20,000 characters and at most 200 lines of each form (design choices) |
| `@indaba/core` (`mesh/intent.ts`) | constant | `INTENT_INSTRUCTION: string`, the fixed instruction of the intent call |
| `@indaba/core` (`mesh/intent.ts`) | function | `contractSection(contract: Contract): string`, the prompt section a work prompt carries |
| `@indaba/core` (`mesh/intent.ts`) | constant | `NEGOTIATION_INSTRUCTION: string`, the fixed instruction of a negotiation (`SPLIT` and `INTERFACE` lines) |
| `@indaba/core` (`mesh/intent.ts`) | function | `parseContract(text: string, steps: readonly string[], mayChange?: (stepId: string, path: string) => boolean): { readonly contract: Omit<Contract, 'decidedBy'> \| null; readonly ignored: number }`; `null` when the proposal is not valid (spec AC-14); with `mayChange`, a split that gives a step a path it may not change is not valid (used by `path-ownership`) |
| `@indaba/core` (`mesh/intent.ts`) | interface | `NegotiationDecider { decide(request: { readonly steps: readonly string[]; readonly transcript: readonly AgentMessage[] }, signal?: AbortSignal): Promise<'sequence' \| { readonly order: readonly string[] } \| 'stop' \| null> }`; `null` means nobody answered |
| `@indaba/core` (`mesh/intent.ts`) | interface | `Contract { readonly steps: readonly string[]; readonly paths: Readonly<Record<string, readonly string[]>>; readonly interfaces: readonly { readonly name: string; readonly shape: string }[]; readonly decidedBy: 'consensus' \| 'arbiter' }` |
| `@indaba/core` (board kinds, `specs/run-blackboard`) | enum members | `BoardKind.Intent = 'intent'`, `BoardKind.Contract = 'contract'`, engine-written only |
| `@indaba/engine` (`config/project-config.ts`) | field | `ProjectConfig.parallel: ResolvedParallel`, always present, defaults filled |
| `@indaba/engine` (`config/project-config.ts`) | interface | `ResolvedParallel { readonly maxSteps: number; readonly maxWaits: number }` (from `parallel.max_steps`, `parallel.max_waits`; defaults 1 and 3) |
| `@indaba/engine` (`config/project-config.ts`) | constant change | `PROJECT_CONFIG_SECTIONS` gains `'parallel'` |
| `@indaba/engine` (`engine/workflow-engine.ts`) | field | `WorkflowEngineOptions.maxParallelSteps?: number` (default 1) |
| `@indaba/engine` (`engine/workflow-engine.ts`) | field | `WorkflowEngineOptions.maxWaits?: number` (default 3) |
| `@indaba/core` (`extension/index.ts`) | method | `PluginHost.registerNegotiationDecider(decider: NegotiationDecider): void`; the last registration wins; with none, nobody answers and the steps run one after another |
| `@indaba/engine` (`engine/workflow-engine.ts`) | field | `WorkflowEngineOptions.negotiationDecider?: NegotiationDecider`: how the composition root passes what the host registered, as `adjudicators` is passed today; not an extension point of its own |
| `indaba` (`parallel.ts`) | constant | `PARALLEL_CONSEQUENCES: string`, the text of spec AC-04a |
| `@indaba/engine` (`engine/workflow-engine.ts`) | field | `RunOptions.onStepOutput?: (stepId: string, chunk: string) => void` |
| `@indaba/engine` (`workspace/workspace.ts`) | method | `Workspace.fork(name: string): Promise<Workspace>`: a worktree whose `HEAD` is a commit of this workspace's current state, so its `diff()` is its own change only |
| `@indaba/engine` (`workspace/workspace.ts`) | method | `Workspace.land(child: Workspace): Promise<LandResult>`: three-way apply of `child.diff()`; on success this workspace changes and nothing else is left; on conflict this workspace is unchanged and the result holds the conflicted landing workspace for the resolution |
| `@indaba/engine` (`workspace/workspace.ts`) | type | `LandResult = { readonly ok: true } \| { readonly ok: false; readonly conflicts: readonly ConflictHunk[]; readonly workspace: Workspace }`, paths project-relative; the caller destroys `workspace` |
| `@indaba/engine` (`workspace/workspace.ts`) | interface | `ConflictHunk { readonly path: string; readonly ours: string; readonly theirs: string }`, each text bounded and cleaned before it reaches a prompt |

`Workspace` is an interface implemented in this repository by `GitWorktree` (and by the copy workspace of
`specs/workspace-without-git` when that ships). Adding two methods to it breaks a third-party implementation; there is
none outside this repository today, and neither `Workspace` nor `WorkspaceManager` is a `PluginHost` extension point
(`PluginHost` registers runners, guards, adjudicators and listeners). Confirmed: minor.

`PluginHost` gains `registerNegotiationDecider`. Under `specs/DEPENDENCY_MAP.md` ("What breaks what"), adding a
method to `PluginHost` breaks no plugin, only another implementation of the host, of which the CLI's is the only one:
below 1.0 a minor, named in the changelog.

`BoardKind` gains `intent` and `contract`. The board's own readers treat an unknown kind as unknown (`run-blackboard`
AC-30), but a third party switching over `BoardKind` exhaustively stops compiling: a major in practice, which below 1.0
takes the next minor, and the changelog lists it under a "Breaking" note so nobody upgrades past it unaware. If
`run-blackboard` has not been released when this ships, the members are part of its first release and nothing breaks.

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
| `indaba.config` | section `parallel:` with `max_steps` and `max_waits` | added |
| workflow file | top-level `max_waits` (integer, at least 1; lowers the configured value) | added |
| environment | `INDABA_PARALLEL` | added |
| CLI | `indaba run --parallel <n>`, `indaba ui --parallel <n>` | added |
| CLI | `indaba plan` | prints the groups of spec AC-32 (added output; existing lines unchanged) |
| prompt | the intent instruction (`INTENT`, `PROVIDES`, `NEEDS` lines) and the contract section of a work prompt | added; the text is part of the contract once released |
| board | entries of kind `intent` and `contract` | added |
| span attributes | `indaba.workflow.max_parallel`, `indaba.workflow.max_parallel.source` on the root span; `indaba.land.sequence` on each landing span (spec AC-22) | added |
| spans | child spans of a step for the intent call, the negotiation, the landing and the resolution | added (names fixed at stage 3 under the GenAI conventions) |
| events | none | unchanged classes; events of different steps interleave (spec AC-30) |
| filesystem | step and resolution worktrees under `.indaba/worktrees/` | added (naming confirmed at stage 3 against `GitWorktreeManager`) |
| log records | spec AC-33 | added |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| the limit (`--parallel`, `INDABA_PARALLEL`, `parallel.max_steps`, `maxParallelSteps`) | (none: one at a time) | 1 |
| `max_parallel` | (none) | unset: the resolved limit applies |
| `parallel.max_waits` (put back before admitted alone) | (none) | 3 (a design choice, spec C-08) |

## Checks

- [ ] Every type appearing in a new public signature is itself public (or deliberately marked `@internal` and not re-exported from the package index)
- [ ] Implementations are not exported for subclassing; the extension point is an interface
- [ ] Collections are typed precisely and read-only where they are not mutated (`readonly T[]`, `Readonly<Record<string, V>>`)
- [ ] `pnpm qa` (Biome, `tsc` strict, Vitest) passes with no suppression comment
