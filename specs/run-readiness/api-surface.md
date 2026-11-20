# API surface contract: run-readiness

> **Immutable during stage 6.** Section 8 of the spec was confirmed on 2026-11-20. Stage 5 corrected the names below (see `plan.md`).

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
| `@indaba/core` `readiness` | function | `analyzeReadiness(workflow: WorkflowDefinition, inputs: ReadonlyMap<string, unknown>, probe: ReadinessProbe, confirmed: ReadonlySet<string>): ReadinessReport` |
| `@indaba/core` `workflow` | type | `Requirement { readonly kind: 'env' \| 'file' \| 'tool' \| 'account' \| 'decision' \| 'asset'; readonly name: string; readonly description: string; readonly how?: string; readonly critical?: boolean }` and `WorkflowDefinition.requires?: readonly Requirement[]` |
| `@indaba/engine` `readiness` | function | `createReadinessProbe(root: string, env: Readonly<Record<string, string | undefined>>, registry: RunnerPresence, options?: ReadinessProbeOptions): ReadinessProbe` and `readinessAttributes(report: ReadinessReport): SpanAttributes` |
| `@indaba/engine` `RunOptions` | field | `readiness?: ReadinessReport`, recorded on the run span |
| `@indaba/engine` | re-export | every `@indaba/core` type above (the TUI's rule R-02) |

Ids are stable: `<kind>:<stepId or ->:<name>`, so a confirmation survives a re-computation.

`AttentionKind` already lists `finding` and `manual-check` because [`run-handover`](../run-handover/api-surface.md) reuses
`AttentionItem`; this feature produces neither.

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| run span (engine) | no readiness data | one span event `indaba.readiness`, and the same attributes on the run span: `indaba.readiness.items` (one JSON text of `[id, state]` pairs: span attributes are scalars), `indaba.readiness.critical_missing`, `indaba.readiness.needs_confirmation`; `RunRecord` is the trace wire union and is not changed | additive; no value of any item is stored |
| `StartRunRequest` (`@indaba/core` web contract) | no confirmations | optional `confirmed?: readonly string[]` | additive |
| `ReadinessRequest`, `ReadinessResponse`, `ReadinessItemView` (`@indaba/core` web contract) | none | `{ workflowId, confirmed? }` and the report as the wire carries it, declared inside the contract folder (the page imports it, so it imports nothing outside it); a `ReadinessReport` is assignable to it | additive (slice 2) |
| `describeAttention`, `plainText` (`@indaba/core`, re-exported by `@indaba/engine`) | none | one line of plain words for an item, and the neutraliser of control characters, so the CLI and the TUI use the same words (AC-11) | additive (slice 2) |
| `RunControlPort.readiness?` (`@indaba/tui`), `UiRunControl.readiness?` (`indaba`) | none | `readiness(request): Promise<ReadinessResponse>`, optional: a control without it gives a start with no report | additive (slice 2) |
| `createRunControl` (`indaba`) | `UiRunControl` | also `readiness`, and an option `readiness(workflow, root, confirmed)` that the composition root builds with the probe; a start passes `confirmed` to the child as `--confirm <id>` options (at most 50, each a printable id starting with a letter) | additive (slice 2) |
| `RunControl` of `@indaba/server` | no readiness | optional `readiness(request)` | minor (optional member); a control without it answers 404 `readiness_unavailable` |
| `Client` of `@indaba/web` (private) | no readiness | `readiness(workflowId, confirmed?)`, and `startRun` takes `confirmed` | none (the package is never published) |

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow schema | `requires` | new optional top-level list (spec AC-07 to AC-09) |
| CLI | `indaba plan` | prints a readiness section after the plan |
| CLI | `indaba run --confirm <id>` (repeatable) | new option |
| event | `ReadinessChecked` | new, the span event `indaba.readiness`; counts and `[id, state]` pairs only |
| span attribute | `indaba.readiness.critical_missing`, `indaba.readiness.needs_confirmation` | new, on the run span; not part of the GenAI conventions, so namespaced `indaba.` |
| HTTP (server) | `GET /api/v1/workflows/:id/readiness[?confirm=<id>...]`; optional `confirmed` in the body of `POST /api/v1/runs` | new, token-protected like the others. At most 50 ids of 1 to 300 characters; a longer list is 400. The planned `POST /api/runs/:id/confirm` is not built: a confirmation travels with its start |

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
