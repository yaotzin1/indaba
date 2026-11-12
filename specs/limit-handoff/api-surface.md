# API surface contract: Limit handoff

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**minor** (below 1.0)

Reasoning: every addition is optional. `RunResult.limit` is an optional member, so a runner that does not set it
compiles and behaves as before. `on_limit` and `max_wait` are optional workflow fields whose absence means `fail`, which is
today's behaviour. Two events and four attributes are new. No default changes. One behaviour does change for a
consumer who reads failures: a failure caused by a limit now carries `limit` and does not count as a retry attempt
(AC-15). That is a corrected misclassification inside a failing step, not a change to a documented contract; a retry into the
same limit could not have worked, so nothing depended on it (spec, clarification 9).

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core`, `runner` | type | `type LimitKind = 'session' \| 'weekly' \| 'rate' \| 'unknown'` |
| `@indaba/core`, `runner` | interface | `interface RunLimit { readonly kind: LimitKind; readonly resetsAt?: number; readonly source: 'structured' \| 'text' }` (`resetsAt` is epoch milliseconds, absent when unknown) |
| `@indaba/core`, `runner` | type | `type LimitSignal = { readonly status?: number; readonly retryAfterSeconds?: number; readonly resetsAtMs?: number; readonly exitCode?: number; readonly structuredKind?: string; readonly textTail?: string; readonly succeeded: boolean }` |
| `@indaba/core`, `runner` | function | `classifyLimit(signal: LimitSignal, patterns: readonly LimitPattern[], nowMs: number): RunLimit \| undefined` |
| `@indaba/core`, `runner` | interface | `interface LimitPattern { readonly kind: LimitKind; readonly pattern: RegExp }` (anchored; supplied by a runner) |
| `@indaba/core`, `runner` | class | `class RunnerLimitError extends RunnerUnavailableError { readonly limit: RunLimit }` |
| `@indaba/core`, `runner` | class | `class LimitLedger { constructor(); markCooling(runner: string, limit: RunLimit): void; coolingUntil(runner: string, nowMs: number): number \| 'run' \| undefined; isCooling(runner: string, nowMs: number): boolean; snapshot(): ReadonlyMap<string, RunLimit> }` |
| `@indaba/core`, `workflow` | type | `type OnLimit = 'fail' \| 'handoff' \| 'wait'` |
| `@indaba/core`, `workflow` | type | `type LimitDecision = { readonly action: 'run'; readonly runner: string } \| { readonly action: 'wait'; readonly untilMs: number } \| { readonly action: 'ask' } \| { readonly action: 'fail'; readonly reasons: readonly LimitReason[] }` |
| `@indaba/core`, `workflow` | interface | `interface LimitReason { readonly runner: string; readonly limit: RunLimit }` |
| `@indaba/core`, `workflow` | function | `decideOnLimit(input: { policy: OnLimit; maxWaitSeconds: number; list: readonly string[]; tried: readonly string[]; ledger: LimitLedger; nowMs: number }): LimitDecision` |

All are pure and take the clock as a number; none reads `Date.now()`.

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `RunResult` | `{ output, exitCode, usage?, ... }` | adds `readonly limit?: RunLimit` | none for existing code; optional |
| `StepDefinition` (and role) | no limit fields | adds `readonly onLimit?: OnLimit` and `readonly maxWait?: number` | none; optional |

## Removed or deprecated

| Name | Replacement | Removed in |
| :--- | :--- | :--- |
| none | | |

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| Workflow field | `on_limit` (step, role) | new, optional: `fail` (default), `handoff`, `wait` |
| Workflow field | `max_wait` (step, role) | new, optional integer seconds, `>= 0`, default `0`; valid only with `on_limit: wait` |
| Validation | parse time | rejects unknown `on_limit`, negative or non-integer `max_wait`, `max_wait` without `wait`, `handoff` with a one-entry `runner` list; each with the field path |
| Span event | `indaba.runner.limit` | new, on the step span: `indaba.limit.kind`, `indaba.limit.resets_at` (ISO 8601, only when known), `indaba.limit.source`, `indaba.runner.name` |
| Span event | `indaba.runner.handoff` | new: `indaba.runner.from`, `indaba.runner.to`, `indaba.handoff.changed_paths` (count) |
| Span events | `indaba.limit.wait.start`, `indaba.limit.wait.end` | new: `indaba.limit.wait_seconds` on the end event |
| Skip event | existing runner skip event of `transport-priority` | gains reason value `cooling` with `indaba.limit.resets_at` when known |
| CLI | `indaba watch`, `indaba report` | show limit and handoff lines; no new option |

Attribute names stay under `indaba.*`: the OpenTelemetry GenAI conventions define no rate-limit attribute that fits.

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| `on_limit` | (none: a limit was an ordinary failure) | `fail` (the same outcome, now recorded as a limit) |
| `max_wait` | (none) | `0` (ask now) |

## Checks

- [ ] Every type appearing in a new public signature is itself public (or deliberately marked `@internal` and not re-exported from the package index)
- [ ] Implementations are not exported for subclassing; the extension point is an interface (`LimitLedger` is a final class, not a point of extension; a runner's contribution is its `LimitPattern` list and `RunResult.limit`)
- [ ] Collections are typed precisely and read-only where they are not mutated (`readonly T[]`, `Readonly<Record<string, V>>`)
- [ ] `@indaba/core` imports no `node:` module and reads no clock, randomness or environment
- [ ] `pnpm qa` (Biome, `tsc` strict, Vitest) passes with no suppression comment
