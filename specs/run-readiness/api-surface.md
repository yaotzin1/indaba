# API surface contract: run-readiness

> **Immutable during stage 6.** Provisional until the maintainer confirms section 8 of the spec.

## Semver classification

**minor** (below 1.0). New optional workflow field `requires`, new optional exports, new CLI output and one new option. No
default changes: the report never stops a run (spec C-04).

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core` `attention` | type | `AttentionKind = 'runner' \| 'secret' \| 'input' \| 'artifact' \| 'workspace' \| 'permission' \| 'tool' \| 'file' \| 'env' \| 'account' \| 'decision' \| 'asset' \| 'finding' \| 'manual-check'` |
| `@indaba/core` `attention` | type | `AttentionState = 'ready' \| 'missing' \| 'needs-confirmation' \| 'confirmed' \| 'unknown'` |
| `@indaba/core` `attention` | interface | `AttentionItem { readonly id: string; readonly kind: AttentionKind; readonly state: AttentionState; readonly critical: boolean; readonly stepId?: string; readonly message: string; readonly how?: string }` |
| `@indaba/core` `readiness` | interface | `ReadinessReport { readonly items: readonly AttentionItem[]; readonly criticalMissing: number; readonly needsConfirmation: number }` |
| `@indaba/core` `readiness` | interface | `ReadinessProbe { isEnvSet(name: string): boolean; fileState(relativePath: string): 'file' \| 'directory' \| 'missing' \| 'outside'; hasExecutable(name: string): boolean; isRunnerRegistered(type: string, preset?: string): boolean; workspaceKind(): 'git' \| 'plain' }` |
| `@indaba/core` `readiness` | function | `analyzeReadiness(workflow: Workflow, inputs: ReadonlyMap<string, unknown>, probe: ReadinessProbe, confirmed: ReadonlySet<string>): ReadinessReport` |
| `@indaba/core` `workflow` | type | `Requirement { readonly kind: 'env' \| 'file' \| 'tool' \| 'account' \| 'decision' \| 'asset'; readonly name: string; readonly description: string; readonly how?: string; readonly critical?: boolean }` and `Workflow.requires?: readonly Requirement[]` |
| `@indaba/engine` `readiness` | function | `createReadinessProbe(root: string, env: Readonly<Record<string, string \| undefined>>, registry: RunnerLookup): ReadinessProbe` |
| `@indaba/engine` | re-export | every `@indaba/core` type above (the TUI's rule R-02) |

Ids are stable: `<kind>:<stepId or ->:<name>`, so a confirmation survives a re-computation.

`AttentionKind` already lists `finding` and `manual-check` because [`run-handover`](../run-handover/api-surface.md) reuses
`AttentionItem`; this feature produces neither.

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `RunRecord` (engine) | no readiness data | optional `readiness?: { items: readonly { id: string; state: AttentionState }[]}` | additive; no value of any item is stored |
| `StartRequest` (engine run control) | no confirmations | optional `confirmed?: readonly string[]` | additive |

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow schema | `requires` | new optional top-level list (spec AC-07 to AC-09) |
| CLI | `indaba plan` | prints a readiness section after the plan |
| CLI | `indaba run --confirm <id>` (repeatable) | new option |
| event | `ReadinessChecked` | new; fields `criticalMissing`, `needsConfirmation`, counts only |
| span attribute | `indaba.readiness.critical_missing`, `indaba.readiness.needs_confirmation` | new, on the run span; not part of the GenAI conventions, so namespaced `indaba.` |
| HTTP (server) | `GET /api/workflows/:id/readiness`, `POST /api/runs/:id/confirm` | new, token-protected like the others |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| `indaba run` with a missing item | starts | starts (unchanged), after printing the report |
| `critical` of a declared requirement | n/a | `false` |

## Checks

- [ ] Every type appearing in a new public signature is itself public
- [ ] `@indaba/core` imports no `node:` module; the machine is the probe
- [ ] No item, event or attribute carries a value of a secret, or its length (a test greps the serialised report for the fake value)
- [ ] `pnpm qa` passes with no suppression comment
