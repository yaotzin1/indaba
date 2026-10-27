# API surface contract: Step fan-out

> **Provisional (stage 1).** Written with the specification so the surface can be reviewed with it. It becomes the
> contract at stage 3; from then on it is immutable during stage 6, and an implementation that finds it wrong stops and
> returns to stage 3.

## Semver classification

**minor** (below 1.0).

Reasoning: `for_each` is optional and a workflow without it runs as today. `PluginHost` gains one method: safe for
callers, and the CLI's `RegistryPluginHost` is the only implementer in this repository, as with
`registerAdjudicator`. The engine option and the events are additive.

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core` (`workflow/model.ts`) | field | `StepDefinition.forEach?: string` (from `for_each`, an artifact key) |
| `@indaba/core` (`extension/graph.ts`) | interface | `GraphExpander { readonly name: string; expand(step: StepDefinition, context: ExpansionContext): Promise<Expansion \| null> }` |
| `@indaba/core` (`extension/graph.ts`) | interface | `ExpansionContext { readonly workflow: WorkflowDefinition; readonly readArtifact: (key: string) => Promise<string \| undefined>; readonly signal?: AbortSignal }` |
| `@indaba/core` (`extension/graph.ts`) | interface | `Expansion { readonly steps: readonly StepDefinition[]; readonly replacesStep: boolean }` |
| `@indaba/core` (`extension/index.ts`) | method | `PluginHost.registerGraphExpander(expander: GraphExpander): void` |
| `@indaba/engine` (`engine/workflow-engine.ts`) | field | `WorkflowEngineOptions.maxFanOut?: number` (default 8, a design choice) |

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `PluginHost` | four registration methods | gains `registerGraphExpander` | minor: callers unaffected; a third-party implementer of `PluginHost` must add it |

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow file | step field `for_each` | added |
| interpolation | `${{ item.<field> }}` in a template's goal, outputs, `touches` and guard parameters | added |
| JSON schema and catalog | `for_each` | added, with its description |
| span attributes | `indaba.fanout.items`, `indaba.fanout.digest` on the template's span | added |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| `maxFanOut` | (none) | 8 |

## Checks

- [ ] Every type appearing in a new public signature is itself public (or deliberately marked `@internal` and not re-exported from the package index)
- [ ] Implementations are not exported for subclassing; the extension point is an interface
- [ ] Collections are typed precisely and read-only where they are not mutated (`readonly T[]`, `Readonly<Record<string, V>>`)
- [ ] `pnpm qa` (Biome, `tsc` strict, Vitest) passes with no suppression comment
