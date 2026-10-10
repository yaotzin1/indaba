# API surface contract: Budgets

> Builds on `specs/transport-priority/api-surface.md` (`Runner`, `RunRequest`, `RunResult`, span events),
> `specs/observability/api-surface.md` (`TokenUsage`, `PricingTable`, `Tracer`, the event dispatcher),
> `specs/debate-arbiter/api-surface.md` (`Adjudicator`, `Ruling`, `PluginHost`) and
> `specs/ruling-channel/api-surface.md` (the file channel; see spec section 8, item 11).

## Semver classification

Two parts, classified separately.

**1. Budgets, money and rates, the question, resume and the CLI options: minor** (below 1.0 also what 0.x calls
a feature). Every member is optional: a workflow without `budget`, `rates` or `display_currency`, a caller that
passes no `onUsage`, no resolver and no rates behave as before, except that a stop with no resolver ends
`escalated` and keeps a directory. The money additions to published types are all optional and additive:
`RunResult.reportedCost` and `RunResultInit.reportedCost`, `ModelRate.currency`, `PricingTable.cost`. The
existing USD members (`reportedCostUsd`, `PricingTable.costUsd`, the span attribute `indaba.cost.usd`) keep
their type and meaning. `max_cost_usd` stays, so a USD-only workflow is unaffected.

**2. The metering obligation: breaking.** Three changes, each observable by someone who changed nothing:

| Change | Who is affected |
| :--- | :--- |
| `Runner.metering` is required, and `PluginHost.registerRunner` refuses a runner without it | a third-party runner published against `0.1.0-alpha.x` |
| `Adjudicator`, `Guard` and listener registrations require a declaration | a third-party plugin that registers them (`Adjudicator` is unreleased, so only the others are published surface) |
| `metering_policy` defaults to `required`, so `validate` fails a step whose runner is declared `unmetered` | every existing workflow that names `claude-code`, `codex`, `cursor` or `antigravity` and says nothing about metering |

By this repository's rule ("a changed default or workflow field meaning is a major") this is a **major**. Below
1.0 it can ship as the next preview version (`0.2.0-alpha.0`), because 0.x and `docs/using-the-alpha.md` promise
no stability; the CHANGELOG lists it under a breaking heading and the alpha guide gets the migration (declare
metering; add `metering_policy: optional`). **What would make it a minor:** a missing declaration loads as
`{ kind: 'unmetered', reason: 'undeclared' }` with a warning, and the default policy is `optional`, for one
release, then the strict form. The choice is the maintainer's (spec section 8, item 15). The extensibility rule
holds either way: built-ins register through the same calls and get no exemption.

## Public symbols added

### `@indaba/core`

#### Money and rates (pure; no clock, locale, environment or network)

```ts
/** An amount in a currency, exactly as a source reported it. */
export interface Money {
  readonly amount: number;        // finite, >= 0; never rounded
  readonly currency: string;      // an ISO 4217 code from the bundled table
}
export function money(amount: number, currency: string): Money;   // IndabaError on an invalid amount or code
export function currencyInfo(code: string): { readonly code: string; readonly minorUnits: number } | undefined;
export function isCurrencyCode(value: unknown): value is string;

/** One unit of `from` is `rate` units of `to`. `asOf` is a label for a reader, never an input to a decision. */
export interface Rate {
  readonly from: string;
  readonly to: string;
  readonly rate: number;          // finite, > 0
  readonly asOf: string;          // a real calendar date, YYYY-MM-DD
}

export interface ConvertedMoney {
  readonly original: Money;
  readonly converted: Money;      // in the target currency, unrounded
  readonly rate: number;          // the multiplier applied (for an inverse, 1 / the supplied rate)
  readonly asOf: string;
  readonly inverse: boolean;      // true when only the opposite pair was supplied
}

export class RateTable {
  /** At most 200 entries; a duplicate ordered pair, a pair of one currency, or a bad entry is an IndabaError. */
  constructor(rates: readonly Rate[]);
  /** Entries of `preferred` win over `fallback` for the same ordered pair. Pure. */
  static layered(preferred: RateTable, fallback: RateTable): RateTable;
  /** Direct pair, else the reciprocal of the opposite pair, else undefined. Never goes through a third currency. */
  convert(value: Money, to: string): ConvertedMoney | undefined;   // same currency: rate 1, no entry needed
  has(from: string, to: string): boolean;
  entries(): readonly Rate[];
}

/** `0.42 USD`: the code, never a symbol; the currency's own number of minor units; no locale. */
export function formatMoney(value: Money): string;
/** `0.42 USD (≈ 4.24 PLN at 10.1, as of 2026-10-01)`; an inverse reads `at 1/0.099 (inverse of PLN to USD), as of …`. */
export function formatConverted(value: ConvertedMoney): string;
```

`PricingTable` (existing) gains, additively:

```ts
export interface ModelRate { /* input, output unchanged */ readonly currency?: string; }   // default 'USD'
export class PricingTable {
  cost(model: string, usage: TokenUsage): Money | undefined;          // new: in the model's currency
  costUsd(model: string, usage: TokenUsage): number | undefined;      // unchanged; undefined unless the currency is USD
}
```

#### Budgets and the meter

```ts
/** A ceiling. At least one key is set. */
export interface Budget {
  readonly maxCost?: Money;         // amount finite and > 0; currency from `currency`, else USD. `max_cost_usd` is USD
  readonly maxTokens?: number;      // integer, >= 1
}

export const BudgetLimit: { readonly MaxCost: 'max_cost'; readonly MaxTokens: 'max_tokens' };
export type BudgetLimit = (typeof BudgetLimit)[keyof typeof BudgetLimit];
export type BudgetScope = 'step' | 'run';

/** What one call has spent so far. Cumulative for that call, never a delta. */
export interface UsageObservation {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cost?: Money;            // in the currency the source reports; cumulative for the call
}

export interface BudgetTotals {
  readonly tokens: number;          // sum over calls that reported tokens
  readonly cost: Readonly<Record<string, number>>;  // sum per ORIGINAL currency code; nothing is converted here
                                                    // with unmeteredCalls > 0 each sum is a lower bound
  readonly estimatedCalls: number;  // calls whose figures have basis 'estimated'
  readonly unmeteredCalls: number;
}

export type BudgetVerdict =
  | { readonly kind: 'ok' }
  | {
      readonly kind: 'exceeded';
      readonly scope: BudgetScope;
      readonly limit: BudgetLimit;
      readonly spent: number;         // in `currency` for max_cost (converted to the cap's currency), else tokens
      readonly cap: number;
      readonly currency?: string;     // the cap's currency, for max_cost
      readonly stepId?: string;       // present for scope 'step'
      readonly final: boolean;        // the cap came from the operator
    };

/** Pure bookkeeping for one run: no clock, randomness, environment or I/O. Same calls, same verdicts. */
export class BudgetMeter {
  constructor(options: {
    readonly rates?: RateTable;                        // injected; the meter converts spend to a cap's currency with it
    readonly run?: Budget;
    readonly operator?: Budget;                        // final
    readonly steps?: Readonly<Record<string, Budget>>; // effective budget by step id
    readonly restore?: BudgetSnapshot;
  });
  begin(stepId: string, share?: number): CallMeter;    // share: 0 < share <= 1, the fraction of the step cap
  check(stepId: string): BudgetVerdict;
  /** Applies a person's grant to the cap that tripped. Refuses a grant on a final cap or one that leaves no room. */
  grant(stepId: string, verdict: Extract<BudgetVerdict, { kind: 'exceeded' }>, grant: BudgetGrant): void;
  totals(): BudgetTotals;
  stepTotals(stepId: string): BudgetTotals;
  snapshot(): BudgetSnapshot;                          // plain data; see data-model.md
}

export interface CallMeter {
  /** Records spend so far. Figures that are missing, negative, NaN, infinite or lower than the call's earlier figure are ignored. */
  observe(observation: UsageObservation): BudgetVerdict;
  /** Closes the call with its metering report. */
  end(report: MeteringReport): void;
}
```

#### The question and the answer

```ts
export type BudgetGrant =
  | { readonly mode: 'raise_to'; readonly maxCost?: number; readonly maxTokens?: number } // new absolute caps; maxCost in the CAP's currency
  | { readonly mode: 'add';      readonly maxCost?: number; readonly maxTokens?: number } // headroom above what is spent; same currency
  | { readonly mode: 'one_call' };

export type BudgetDecision =
  | { readonly kind: 'resume'; readonly grant: BudgetGrant }
  | { readonly kind: 'stop' };

/** Numbers, ids and a relative path. No prompt, output, transcript or secret. */
export interface BudgetQuestion {
  readonly taskId: string;
  readonly stepId: string;
  readonly scope: BudgetScope;
  readonly limit: BudgetLimit;
  readonly spent: number;
  readonly cap: number;
  readonly currency?: string;            // the cap's currency, for max_cost
  /** Present when a display currency is selected and a usable rate exists: the same figures converted. */
  readonly shown?: { readonly spent: ConvertedMoney; readonly cap: ConvertedMoney };
  readonly unmeteredCalls: number;
  readonly resumesUsed: number;
  readonly resumesLeft: number;
  readonly keptWorkspace?: string;       // relative to the project; absent when the step has no isolation
}

/** Asks a person (or a program standing in for one). Extension point. */
export interface BudgetResolver {
  readonly metering: Metering;           // a person's answer spends nothing: { kind: 'free' }
  readonly description?: string;
  /** Resolves to a decision, or null when it cannot answer; the step then ends escalated, its work kept. */
  resolve(question: BudgetQuestion, signal?: AbortSignal): Promise<BudgetDecision | null>;
}

export const MAX_RESUMES_PER_STEP = 5;

export class BudgetExceeded {            // dispatched when a cap is reached, before the question
  constructor(readonly taskId: string, readonly stepId: string, readonly scope: BudgetScope,
              readonly limit: BudgetLimit, readonly spent: number, readonly cap: number, readonly final: boolean);
}
export class BudgetResolved {            // dispatched when the question is settled
  constructor(readonly taskId: string, readonly stepId: string,
              readonly decision: 'stop' | 'resume' | 'unanswered',
              readonly mode?: 'raise_to' | 'add' | 'one_call');
}
```

#### Metering: the obligation

```ts
/** How an extension meters. There is no default and no fourth state. */
export type Metering =
  | { readonly kind: 'free' }                                        // never spends
  | { readonly kind: 'metered';                                      // reports what it spends
      readonly tokens: 'yes' | 'maybe' | 'no'; readonly cost: 'yes' | 'maybe' | 'no'      // not both 'no'
      /** The ISO codes a cost is reported in, or 'any' for whatever the agent sends. Required unless cost is 'no'. */
      readonly currencies?: readonly string[] | 'any' }
  | { readonly kind: 'unmetered'; readonly reason: string };         // allowed, counted, shown; reason <= 300 chars

/** What one call spent. */
export type MeteringReport =
  | { readonly kind: 'metered'; readonly basis: 'reported' | 'estimated';
      readonly inputTokens?: number; readonly outputTokens?: number; readonly cost?: Money } // at least one figure
  | { readonly kind: 'unmetered'; readonly reason: string }
  | { readonly kind: 'none' };                                       // only from a `free` extension

/** Handed to code that spends but has no result to carry a report (a listener). */
export interface UsageReporter {
  report(source: string, report: MeteringReport, stepId?: string): void;
}

export class MeteringNotDeclaredError extends IndabaError {}         // thrown by PluginHost
export function isMetering(value: unknown): value is Metering;       // well-formedness, used by the host and the check
```

Changes to existing core types:

```ts
export interface Runner {
  readonly metering: Metering;                                       // was: absent. REQUIRED.
}

export interface RunRequest {
  /** Cumulative spend of this call whenever the runner learns it while running. Optional. Must not throw. */
  readonly onUsage?: (observation: UsageObservation) => void;
}

export interface RunResultInit {
  readonly metering?: MeteringReport;     // usage and reportedCostUsd unchanged
  readonly reportedCost?: Money;          // NEW: the cost in its original currency, any ISO code
}
export class RunResult {
  /** The cost as reported, in its original currency. When only `reportedCostUsd` was given it is that amount in USD.
   *  When it is USD, `reportedCostUsd` is set to match. Both given and unequal is an IndabaError. A cost in another
   *  currency is never copied into `reportedCostUsd`. */
  readonly reportedCost?: Money;
  readonly metering: MeteringReport;      // ALWAYS set. Derived when not given: from `usage` / `reportedCost` as
                                          // { kind: 'metered', basis: 'reported', ... }, otherwise
                                          // { kind: 'unmetered', reason: 'the runner reported no usage' }.
}

export interface Adjudicator { readonly metering: Metering; }        // REQUIRED
export class Ruling { readonly metering: MeteringReport; }           // defaults to { kind: 'none' } for a `free` adjudicator
export interface Guard { readonly metering: Metering; }              // REQUIRED
export interface GuardResult { readonly metering?: MeteringReport; } // a `metered` guard fills it

export interface StepDefinition {
  readonly budget?: Budget;                                          // absent: defaults.budget, if any
  readonly meteringPolicy?: MeteringPolicy;                          // absent: the workflow default
}
export interface WorkflowDefinition {
  readonly budget?: Budget;                                          // the whole run
  readonly defaultBudget?: Budget;                                   // defaults.budget
  readonly defaultMeteringPolicy: MeteringPolicy;                    // 'required' unless defaults.metering_policy says otherwise
  readonly rates: readonly Rate[];                                   // the top-level `rates`; empty when absent
  readonly displayCurrency?: string;                                 // the top-level `display_currency`
}
export const MeteringPolicy: { readonly Required: 'required'; readonly Optional: 'optional' };
export type MeteringPolicy = (typeof MeteringPolicy)[keyof typeof MeteringPolicy];

export class StepState {
  /** Rebuilds a step from a resume file; the only way a step starts anywhere but PENDING with 0 attempts. */
  static restore(stepId: string, saved: { status: StepStatus; attempts: number; reason?: string }): StepState;
}
```

`PluginHost`:

```ts
export interface PluginHost {
  registerRunner(runner: Runner): void;            // throws MeteringNotDeclaredError without a well-formed `metering`
  registerGuard(guard: Guard): void;               // same
  registerAdjudicator(name: string, adjudicator: Adjudicator): void;   // same
  addListener<E extends object>(type: new (...a: never[]) => E, listener: (event: E) => unknown,
                                options: { readonly metering: Metering }): void;   // `options` REQUIRED
  /** The one active way to ask a budget question; a second registration throws unless { replace: true }. */
  registerBudgetResolver(resolver: BudgetResolver, options?: { readonly replace?: boolean }): void;
  /** For code that spends outside a result. */
  readonly usage: UsageReporter;
}
```

`PluginHost` is implemented only by `RegistryPluginHost` in this repository; plugins call it. The refusal is
per registration: the plugin loader reports it against the plugin and the others still load (the extensibility
skill's "extensions fail alone").

#### The conformance check (`@indaba/core/testing`, an `exports` subpath; a packaging decision for review)

```ts
export interface MeteringCheckOptions<S> {
  readonly subject: S;                               // a Runner, Adjudicator, Guard, BudgetResolver or listener options
  /** Produces one successful sample: a RunResult, Ruling or GuardResult. Not needed for `free`. */
  readonly sample?: () => Promise<{ readonly metering: MeteringReport }>;
  /** A runner that streams: exercises onUsage and returns the figures it reported. */
  readonly streamed?: () => Promise<readonly UsageObservation[]>;
}
export interface MeteringCheckResult { readonly ok: boolean; readonly problems: readonly string[]; }
export function checkMeteringContract<S extends { readonly metering: Metering }>(
  options: MeteringCheckOptions<S>): Promise<MeteringCheckResult>;
```

It checks: the declaration is well formed (an `unmetered` reason is non-empty and at most 300 characters); a
`metered` subject's sample reports at least one finite, non-negative figure; a `free` subject's sample is
`none`; an `unmetered` sample carries no figure; streamed figures are finite, non-negative and non-decreasing.
It depends on no test framework (the caller asserts `problems` is empty). This is the runner contract helper of
`specs/transport-priority` T-22: one helper, with the unavailable-versus-failed checks already specified there.

### `@indaba/engine`

```ts
export interface WorkflowEngineOptions {
  /** The operator run cap (final). The CLI's --max-cost / --max-tokens, or any front end's own setting. */
  readonly runBudget?: Budget;
  /** Rates the operator supplies (the CLI's --rates). They win over the workflow's for the same ordered pair. */
  readonly rates?: readonly Rate[];
  /** Currency to show costs in, next to their original; the CLI's --currency. The workflow's display_currency otherwise. */
  readonly displayCurrency?: string;
  readonly resolver?: BudgetResolver;               // normally from the host; injectable for tests
  readonly resume?: ResumeFile;                     // continue a saved run
}

export interface WorkflowResult {
  readonly spend?: SpendReport;                     // totals plus the unmetered, estimated and gap lists
  readonly resume?: { readonly taskId: string; readonly stepId: string; readonly workspace?: string };  // set when work was kept
}
/** One cost line: an original currency, its sum, and the conversion when one was asked for and possible. */
export interface CostLine {
  readonly original: Money;
  readonly converted?: ConvertedMoney;               // absent: no display currency, or no usable rate (then `noRate` is true)
  readonly noRate: boolean;
  readonly calls: number;
}
export interface SpendReport extends BudgetTotals {
  readonly displayCurrency?: string;
  readonly costLines: readonly CostLine[];
  /** Present only when every line is in, or converted to, one currency. Never a partial sum. */
  readonly total?: Money;
  readonly sources: readonly { readonly source: string; readonly kind: 'unmetered' | 'estimated' | 'gap';
                               readonly reason: string; readonly calls: number }[];
}

export interface ResumeFile { /* data-model.md */ }
export class ResumeStore {
  constructor(projectDir: string, deps: { readonly clock: Clock; readonly redact: (t: string) => string });
  write(file: Omit<ResumeFile, 'createdAt'>): Promise<void>;     // atomic; id validated before a path is built
  read(taskId: string): Promise<ResumeFile>;                      // IndabaError naming why it cannot be used
  remove(taskId: string): Promise<void>;
}
export function definitionDigest(workflow: WorkflowDefinition): string;   // SHA-256 of the canonical JSON

// WorkspaceManager is unchanged. `TrackedWorkspace.keep()` and the kept record come from specs/workspace-without-git,
// whose TrackedWorkspaceManager also carries the matching adoption:
export interface TrackedWorkspaceManager {
  /**
   * Takes over a kept workspace of this manager's kind by its name. Refuses a name with no record, a record that is not
   * valid, or a directory that is not under .indaba/worktrees. The run tears it down normally when it ends.
   */
  adopt(name: string): Promise<TrackedWorkspace>;
}

export class WorkflowValidator {
  warnings(workflow: WorkflowDefinition, meteringOf?: (runner: string) => Metering | undefined): string[];
  /** New: errors for `required` policy against an `unmetered` source, and for a cost cap with no usable rate from a
   *  currency a declared source reports in. Needs the registry's declarations and the layered rates. */
  meteringErrors(workflow: WorkflowDefinition, meteringOf: (source: string) => Metering | undefined): string[];
}
```

### `@indaba/runners`

Declared `metering` of the built-ins; the table is part of the contract (a change to a row is a minor, except
moving a runner to `unmetered`, which is a major):

| Runner | `metering` | Calls `onUsage` |
| :--- | :--- | :--- |
| `openrouter`, OpenAI-compatible | `metered`: tokens `yes` (when the endpoint returns usage; `stream_options.include_usage` is already requested), cost `maybe` in the currency of the model's rate (USD unless the table says otherwise) | at the end of the stream |
| `acp` | `metered`: tokens `no` (context numbers are not an input/output split), cost `maybe`, currencies `any` (only if the agent sends `cost`; kept in the currency it sends) | on each `usage_update` carrying a cost, in its own currency |
| `claude-code`, `codex`, `cursor`, `antigravity` | `unmetered`: "the CLI prints no usage that Indaba reads" | never |
| `shell` | `free` | never |

No runner enforces a budget.

### `indaba` (CLI)

| Option | Meaning |
| :--- | :--- |
| `run --max-cost <amount>[<code>]` | the operator run cap: a positive finite amount and an optional ISO code (`20PLN`, `"20 PLN"`; bare is USD); final |
| `run --currency <code>` | the display currency for this run; wins over the workflow's `display_currency`; changes what is shown, never what a cap means |
| `run --rates <file>` | operator-supplied rates: a YAML or JSON list of `{ from, to, rate, as_of }`, read as data, at most 200 entries; wins over the workflow's rates for the same pair |
| `run --max-tokens <n>` | the operator run cap `max_tokens`: a positive integer; final |
| `run <file> --resume <taskId>` | continue a run whose work was kept; `<taskId>` is `[A-Za-z0-9_-]+` |
| `run --rulings terminal\|files\|none` | existing (`specs/ruling-channel`): also selects how the budget question is asked |

Exit codes: unchanged. A stop is `2` (escalated), a cancel `130`, a resumed run that completes `0`, a `--resume`
refusal `1`, a malformed value `2`. `validate` prints the warnings and fails on `meteringErrors`; `plan` prints
each step's effective budget and policy and the run caps; `run` ends with the spend line and, when work was
kept, its path and the resume command.

The terminal resolver prompts, in the terminal the run was started in, with the same input rules as the human
arbiter: `r <amount|tokens>` raise to, `a <n>` add, `o` one more call, `s` stop. The file resolver and `indaba rule`
additions are in spec section 8, item 11, and are written when `specs/ruling-channel` is.

## Workflow file additions

```yaml
budget:                       # the whole run (the author's cap; a person may raise it at the question)
  max_cost: 20
  currency: PLN               # default USD; `max_cost_usd: 5` is the same as `max_cost: 5` + `currency: USD`
  max_tokens: 2000000

rates:                        # supplied, never fetched; 1 USD = 4.2 PLN (a label for the reader: as_of)
  - { from: USD, to: PLN, rate: 4.2, as_of: 2026-10-01 }
  - { from: EUR, to: PLN, rate: 4.3, as_of: 2026-10-01 }
display_currency: PLN         # costs shown in their own currency and converted to this one; `--currency` overrides

defaults:
  budget: { max_cost_usd: 1 } # every agent step without its own, key by key
  metering_policy: optional   # allow sources that do not meter; default required

steps:
  - id: review
    role: reviewer
    consensus_with: [second]
    budget: { max_cost_usd: 0.50, max_tokens: 200000 }
    metering_policy: required # overrides the default for this step
```

| Field | Where | Meaning |
| :--- | :--- | :--- |
| `budget.max_cost`, `budget.currency` | top level, `defaults`, a step | ceiling over the metered cost, in `currency` (default `USD`); spend in another currency is converted with a supplied rate; a cost with no rate adds nothing and is counted unmetered |
| `budget.max_cost_usd` | same | exactly `max_cost` with `currency: USD`; giving it with `max_cost` or `currency` is an error |
| `rates` | top level | list of `{ from, to, rate, as_of }`; at most 200; a duplicate ordered pair, equal codes, an unknown code, a rate that is not finite and above zero, or an `as_of` that is not a real date is a validation error |
| `display_currency` | top level | an ISO code; costs are shown in their own currency first, then converted to this one where a rate exists |
| `budget.max_tokens` | top level, `defaults`, a step | ceiling over input plus output tokens of metered calls |
| `metering_policy` | `defaults`, a step | `required` (default): `validate` fails when the step may use an `unmetered` source. `optional`: allowed, counted and shown |

## Defaults introduced

No budget unless written. `currency: USD` for a cap that names none. No rates, no conversion and no display
currency unless supplied or selected: with none, every figure is shown in its own currency. `metering_policy:
required`. `MAX_RESUMES_PER_STEP = 5`. The CLI options have no default. Changing the policy default or the constant after release is a major and a minor respectively.

## Errors

| Situation | Error |
| :--- | :--- |
| unknown key, zero, negative, `NaN`, `Infinity`, a non-number, `max_tokens` not an integer | validation error naming the field path |
| neither key present in a `budget` | `budget needs max_cost, max_cost_usd or max_tokens` |
| `max_cost` with `max_cost_usd`, or `currency` without `max_cost` | validation error naming the step and the fields |
| an unknown currency code, anywhere | validation error naming the field and the code |
| a bad rate entry (see the `rates` row), or a bad `--rates` file | validation error naming the entry; nothing runs |
| a cost cap whose currency has no usable rate from a currency a source declares | error when `metering_policy` is `required`, warning when `optional` or the source's currencies are `any` |
| `budget` on a shell step | validation error naming the step |
| an `unmetered` source on a step whose policy is `required` | validation error: step, source, reason, and the two ways out |
| `--max-cost`, `--max-tokens` malformed, an unknown code in `--max-cost` or `--currency`; `--resume` with a bad id | usage error, exit 2 |
| `--resume` with no file, an unknown version, a changed workflow digest, or a missing or foreign directory | `IndabaError` naming why, exit 1; nothing changed |
| a missing or malformed `metering` at registration | `MeteringNotDeclaredError` naming the plugin and the extension |
| a stop | not an exception: `WorkflowResult.status` is `ESCALATED` (or `CANCELLED`), `failureReason` names scope, limit, spent and cap |

## Span attributes and events

See [`events.md`](events.md). Names are public contract: a rename later is a major.

## Checks

- [ ] `@indaba/core` imports no `node:` module (`architecture.test.ts`); `BudgetMeter` and `checkMeteringContract` use only numbers and strings
- [ ] every built-in runner, adjudicator, guard and listener registers through `PluginHost` with a declaration and none is exempt (a test registers each through a host that refuses)
- [ ] `ResumeStore` and `TrackedWorkspaceManager.adopt` are the only code that builds a path under `.indaba/resume/` or adopts a directory; the id and the path are validated before use (a `../` test)
- [ ] no `any`, no `!`, no suppression comment
- [ ] `docs/workflow-format.md`, `docs/extending.md`, `docs/using-the-alpha.md`, `docs/getting-started.md`, `README.md`, `CHANGELOG.md` (with the breaking heading) and `specs/DEPENDENCY_MAP.md` updated
