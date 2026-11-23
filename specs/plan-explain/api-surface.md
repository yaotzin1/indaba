# API surface contract: Explaining a plan

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**minor** (below 1.0). Provisional until section 8 of the spec is confirmed.

Reasoning: two new optional options of an existing command and new optional exports. The output of `indaba plan` without them is
unchanged byte for byte (AC-01), no default changes, no event and no span attribute is added, and no existing type gains a
required member. A reader of the JSON is told to ignore keys it does not know, so a later optional key is a minor.

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core`, workflow/explain | function | `explainPlan(workflow: WorkflowDefinition, origins: OriginMap, facts: ExplainFacts): PlanExplanation` |
| `@indaba/core`, workflow/explain | interface | `PlanExplanation { readonly steps: readonly ExplainedStep[] }` |
| `@indaba/core`, workflow/explain | interface | `ExplainedStep { readonly id: string; readonly kind: 'shell' \| 'agent' \| 'debate'; readonly settings: readonly ExplainedSetting[]; readonly gaps: readonly ExplainedGap[] }` |
| `@indaba/core`, workflow/explain | interface | `ExplainedSetting { readonly key: SettingKey; readonly value: SettingValue; readonly origin: Origin }` (`value` may be `{ unknown: reason }`) |
| `@indaba/core`, workflow/explain | union | `SettingKey` (the keys of AC-02) |
| `@indaba/core`, workflow/explain | interface | `Origin { readonly kind: 'file' \| 'role' \| 'workflow_defaults' \| 'fallback' \| 'preset'; readonly by?: string; readonly ref?: string; readonly line?: number; readonly column?: number }` |
| `@indaba/core`, workflow/explain | interface | `ExplainedGap { readonly code: GapCode; readonly text: string; readonly mitigatedBy: readonly string[] }` |
| `@indaba/core`, workflow/explain | union | `GapCode`: `no_permission_level`, `no_write_scope`, `no_check_on_result`, `failure_stops_run`, `full_access` |
| `@indaba/core`, workflow/explain | interface | `ExplainFacts`, the read-only facts core cannot hold (a runner's default in words, the run's timeout and limits, the rounds bound of a non-default arbiter, each with its origin) |
| `@indaba/core`, workflow/explain | type | `OriginMap`, a read-only map from a path in the document (`$.steps[0].isolation`) to where it was written |
| `@indaba/core`, mesh/consensus | constant | `DEFAULT_MAX_ROUNDS` (the value `ConsensusArbiter` uses when no `maxRounds` is given; C-07) |
| `@indaba/engine`, editor | function | `readOrigins(source: string, workflow: WorkflowDefinition): OriginMap` |
| `indaba`, plan rendering | functions (internal to the package) | `renderExplanationText`, `renderExplanationJson`; not exported from the package index |

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `ConsensusArbiter` constructor | `options.maxRounds ?? 4` (literal in the file) | `options.maxRounds ?? DEFAULT_MAX_ROUNDS`, the same value | none: behaviour is identical; the number is now readable by the explanation (AC-04) |
| `effectiveGuards` and the other resolvers of a default that the explanation shares with the run (the permission, timeout and retry resolution) | in `@indaba/engine`, `effectiveGuards` exported there, the others private | the pure ones move to `@indaba/core` (`workflow/resolve.ts`) and are exported from it; the engine imports them and keeps re-exporting `effectiveGuards` | new public symbols of `@indaba/core` (a minor, to be listed here with signatures before stage 6; the engine's export is unchanged); this is what keeps the explanation equal to the run (AC-04, AC-14). A resolver that needs a fact core cannot hold stays in the engine and arrives through `ExplainFacts` |

## Removed or deprecated

| Name | Replacement | Removed in |
| :--- | :--- | :--- |
| nothing | | |

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| CLI | `indaba plan --explain` | new option: prints the explanation as text |
| CLI | `indaba plan --json` | new option: prints the explanation as JSON; implies `--explain` (C-01) |
| CLI | `indaba plan` | output unchanged without the new options |
| JSON | `schema: "indaba.plan-explain"`, `version: 1` | new contract (AC-10) |
| workflow schema | none | no field is added or changes meaning |
| events, span attributes | none | |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| none | | |

## Checks

- [ ] Every type appearing in a new public signature is itself public (or deliberately marked `@internal` and not re-exported from the package index)
- [ ] Implementations are not exported for subclassing; the extension point is an interface
- [ ] Collections are typed precisely and read-only where they are not mutated (`readonly T[]`, `Readonly<Record<string, V>>`)
- [ ] `pnpm qa` (Biome, `tsc` strict, Vitest) passes with no suppression comment
