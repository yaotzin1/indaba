# API surface contract: run-handover

> **Immutable during stage 6.** Provisional until the maintainer confirms section 8 of the spec.
> Reuses `AttentionItem`, `AttentionKind` and `AttentionState` from [`run-readiness`](../run-readiness/api-surface.md).

## Semver classification

**minor** (below 1.0). One optional workflow field, new optional exports, new run files and CLI commands. No default changes.

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core` `handover` | type | `HandoverReason = 'production' \| 'external-console' \| 'device' \| 'payment' \| 'credentials' \| 'visual' \| 'other'` |
| `@indaba/core` `handover` | interface | `HandoverItem extends AttentionItem { readonly fingerprint: string; readonly reason?: HandoverReason; readonly acceptedEarlier?: boolean }` |
| `@indaba/core` `handover` | type | `HandoverAnswerKind = 'fix' \| 'accept' \| 'defer' \| 'done' \| 'skipped'` |
| `@indaba/core` `handover` | interface | `HandoverAnswer { readonly itemId: string; readonly fingerprint: string; readonly kind: HandoverAnswerKind; readonly text?: string; readonly at: string }` |
| `@indaba/core` `handover` | interface | `Handover { readonly runId: string; readonly items: readonly HandoverItem[]; readonly answers: readonly HandoverAnswer[]; readonly open: number; readonly forYou: number; readonly acceptedEarlier: number }` |
| `@indaba/core` `handover` | interface | `HandoverSource { readonly name: string; collect(run: RunSummary): readonly HandoverItem[] }` |
| `@indaba/core` `handover` | interface | `HandoverStore { accepted(workflow: string): ReadonlySet<string>; record(workflow: string, answer: HandoverAnswer): void; deferred(): readonly DeferredEntry[] }` |
| `@indaba/core` `handover` | function | `buildHandover(run: RunSummary, sources: readonly HandoverSource[], store: HandoverStore, clock: Clock): Handover` |
| `@indaba/core` `workflow` | type | `HandoverCheck { readonly check: string; readonly reason: HandoverReason; readonly how?: string; readonly afterStep?: string }` and `Workflow.handover?: { readonly checks?: readonly HandoverCheck[]; readonly fixWorkflow?: string }` |
| `@indaba/engine` `handover` | function | `createHandoverStore(root: string): HandoverStore` (files under `.indaba/handover/`, confined, atomic) |
| `@indaba/engine` | re-export | every `@indaba/core` type above |

`RunSummary` and `DeferredEntry` are declared at stage 3 against the run record that exists then; this file is not final until they are.

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `PluginHost` (core) | registers runners, guards, listeners | also `registerHandoverSource(source: HandoverSource)` | additive |

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow schema | `handover` | new optional top-level mapping: `checks` (spec AC-03) and `fix_workflow` (workflow name) |
| CLI | `indaba handover <run>` | new command; exit 0 none open, 1 some open |
| CLI | `indaba handover <run> --answer <id>=<kind>[:text]` | new option, repeatable |
| CLI | `indaba handover deferred` | new subcommand, lists the ledger |
| files | `<run dir>/handover.json`, `.indaba/handover/accepted.jsonl`, `.indaba/handover/deferred.jsonl` | new run artifacts |
| event | `HandoverBuilt`, `HandoverAnswered` | new; counts, item ids and answer kinds only, never text |
| span attribute | `indaba.handover.open`, `indaba.handover.for_you` | new, on the run span |
| HTTP (server) | `GET /api/runs/:id/handover`, `POST /api/runs/:id/handover/answers`, `GET /api/handover/deferred` | new, token-protected |

## Defaults introduced or changed

None.

## Checks

- [ ] Every type appearing in a new public signature is itself public
- [ ] `@indaba/core` imports no `node:` module; the file store is the engine's
- [ ] No answer text or finding text is placed in an event or span attribute
- [ ] A built-in source registers through `PluginHost` exactly as a plugin's would
- [ ] `pnpm qa` passes with no suppression comment
