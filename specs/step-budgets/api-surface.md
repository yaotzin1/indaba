# API surface contract: Budgets

> Builds on `specs/transport-priority/api-surface.md` (`Runner`, `RunRequest`, `RunResult`, span events),
> `specs/observability/api-surface.md` (`TokenUsage`, `PricingTable`, `Tracer`, the event dispatcher),
> `specs/debate-arbiter/api-surface.md` (`Adjudicator`, `Ruling`, `PluginHost`) and
> `specs/ruling-channel/api-surface.md` (the file channel; see spec section 8, item 11).

## Semver classification

Two parts, classified separately.

**1. Budgets, the question, resume and the CLI options: minor** (below 1.0 also what 0.x calls a feature). Every
member is optional: a workflow without `budget`, a caller that passes no `onUsage` and no resolver behave as
before, except that a stop with no resolver ends `escalated` and keeps a directory.

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

#### Budgets and the meter

```ts
/** A ceiling. At least one key is set. */
export interface Budget {
  readonly maxCostUsd?: number;   // finite, > 0
  readonly maxTokens?: number;    // integer, >= 1
}

export const BudgetLimit: { readonly MaxCostUsd: 'max_cost_usd'; readonly MaxTokens: 'max_tokens' };
export type BudgetLimit = (typeof BudgetLimit)[keyof typeof BudgetLimit];
export type BudgetScope = 'step' | 'run';

/** What one call has spent so far. Cumulative for that call, never a delta. */
export interface UsageObservation {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
}

export interface BudgetTotals {
  readonly tokens: number;          // sum over calls that reported tokens
  readonly costUsd: number;         // sum over calls that reported a cost; with unmeteredCalls > 0 it is a lower bound
  readonly estimatedCalls: number;  // calls whose figures have basis 'estimated'
  readonly unmeteredCalls: number;
}

export type BudgetVerdict =
  | { readonly kind: 'ok' }
  | {
      readonly kind: 'exceeded';
      readonly scope: BudgetScope;
      readonly limit: BudgetLimit;
      readonly spent: number;
      readonly cap: number;
      readonly stepId?: string;       // present for scope 'step'
      readonly final: boolean;        // the cap came from the operator
    };

/** Pure bookkeeping for one run: no clock, randomness, environment or I/O. Same calls, same verdicts. */
export class BudgetMeter {
  constructor(options: {
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
  | { readonly mode: 'raise_to'; readonly maxCostUsd?: number; readonly maxTokens?: number } // new absolute caps
  | { readonly mode: 'add';      readonly maxCostUsd?: number; readonly maxTokens?: number } // headroom above what is spent
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
      readonly tokens: 'yes' | 'maybe' | 'no'; readonly costUsd: 'yes' | 'maybe' | 'no' } // not both 'no'
  | { readonly kind: 'unmetered'; readonly reason: string };         // allowed, counted, shown; reason <= 300 chars

/** What one call spent. */
export type MeteringReport =
  | { readonly kind: 'metered'; readonly basis: 'reported' | 'estimated';
      readonly inputTokens?: number; readonly outputTokens?: number; readonly costUsd?: number } // at least one figure
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

export interface RunResultInit { readonly metering?: MeteringReport; /* usage, reportedCostUsd unchanged */ }
export class RunResult {
  readonly metering: MeteringReport;      // ALWAYS set. Derived when not given: from `usage` / `reportedCostUsd` as
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
  readonly resolver?: BudgetResolver;               // normally from the host; injectable for tests
  readonly resume?: ResumeFile;                     // continue a saved run
}

export interface WorkflowResult {
  readonly spend?: SpendReport;                     // totals plus the unmetered, estimated and gap lists
  readonly resume?: { readonly taskId: string; readonly stepId: string; readonly workspace?: string };  // set when work was kept
}
export interface SpendReport extends BudgetTotals {
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

export interface WorkspaceManager {
  /** Takes over a kept directory. Refuses a path that is not a worktree under .indaba/worktrees/<taskId>. */
  adopt(taskId: string, path: string): Promise<Workspace>;
  /** Releases a workspace without removing it. */
  keep(workspace: Workspace): string;               // returns its path relative to the project
}

export class WorkflowValidator {
  warnings(workflow: WorkflowDefinition, meteringOf?: (runner: string) => Metering | undefined): string[];
  /** New: errors for `required` policy against an `unmetered` source. Needs the registry's declarations. */
  meteringErrors(workflow: WorkflowDefinition, meteringOf: (source: string) => Metering | undefined): string[];
}
```

### `@indaba/runners`

Declared `metering` of the built-ins; the table is part of the contract (a change to a row is a minor, except
moving a runner to `unmetered`, which is a major):

| Runner | `metering` | Calls `onUsage` |
| :--- | :--- | :--- |
| `openrouter`, OpenAI-compatible | `metered`: tokens `yes` (when the endpoint returns usage; `stream_options.include_usage` is already requested), cost `maybe` (a priced model) | at the end of the stream |
| `acp` | `metered`: tokens `no` (context numbers are not an input/output split), cost `maybe` (only if the agent sends `cost`) | on each `usage_update` carrying a USD cost |
| `claude-code`, `codex`, `cursor`, `antigravity` | `unmetered`: "the CLI prints no usage that Indaba reads" | never |
| `shell` | `free` | never |

No runner enforces a budget.

### `indaba` (CLI)

| Option | Meaning |
| :--- | :--- |
| `run --max-cost <usd>` | the operator run cap `max_cost_usd`: a positive finite number; final |
| `run --max-tokens <n>` | the operator run cap `max_tokens`: a positive integer; final |
| `run <file> --resume <taskId>` | continue a run whose work was kept; `<taskId>` is `[A-Za-z0-9_-]+` |
| `run --rulings terminal\|files\|none` | existing (`specs/ruling-channel`): also selects how the budget question is asked |

Exit codes: unchanged. A stop is `2` (escalated), a cancel `130`, a resumed run that completes `0`, a `--resume`
refusal `1`, a malformed value `2`. `validate` prints the warnings and fails on `meteringErrors`; `plan` prints
each step's effective budget and policy and the run caps; `run` ends with the spend line and, when work was
kept, its path and the resume command.

The terminal resolver prompts, in the terminal the run was started in, with the same input rules as the human
arbiter: `r <usd|tokens>` raise to, `a <n>` add, `o` one more call, `s` stop. The file resolver and `indaba rule`
additions are in spec section 8, item 11, and are written when `specs/ruling-channel` is.

## Workflow file additions

```yaml
budget:                       # the whole run (the author's cap; a person may raise it at the question)
  max_cost_usd: 5
  max_tokens: 2000000

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
| `budget.max_cost_usd` | top level, `defaults`, a step | USD ceiling over the metered cost; unknown cost adds nothing |
| `budget.max_tokens` | top level, `defaults`, a step | ceiling over input plus output tokens of metered calls |
| `metering_policy` | `defaults`, a step | `required` (default): `validate` fails when the step may use an `unmetered` source. `optional`: allowed, counted and shown |

## Defaults introduced

No budget unless written. `metering_policy: required`. `MAX_RESUMES_PER_STEP = 5`. The CLI options have no
default. Changing the policy default or the constant after release is a major and a minor respectively.

## Errors

| Situation | Error |
| :--- | :--- |
| unknown key, zero, negative, `NaN`, `Infinity`, a non-number, `max_tokens` not an integer | validation error naming the field path |
| neither key present in a `budget` | `budget needs max_cost_usd or max_tokens` |
| `budget` on a shell step | validation error naming the step |
| an `unmetered` source on a step whose policy is `required` | validation error: step, source, reason, and the two ways out |
| `--max-cost`, `--max-tokens` malformed; `--resume` with a bad id | usage error, exit 2 |
| `--resume` with no file, an unknown version, a changed workflow digest, or a missing or foreign directory | `IndabaError` naming why, exit 1; nothing changed |
| a missing or malformed `metering` at registration | `MeteringNotDeclaredError` naming the plugin and the extension |
| a stop | not an exception: `WorkflowResult.status` is `ESCALATED` (or `CANCELLED`), `failureReason` names scope, limit, spent and cap |

## Span attributes and events

See [`events.md`](events.md). Names are public contract: a rename later is a major.

## Checks

- [ ] `@indaba/core` imports no `node:` module (`architecture.test.ts`); `BudgetMeter` and `checkMeteringContract` use only numbers and strings
- [ ] every built-in runner, adjudicator, guard and listener registers through `PluginHost` with a declaration and none is exempt (a test registers each through a host that refuses)
- [ ] `ResumeStore` and `WorkspaceManager.adopt` are the only code that builds a path under `.indaba/resume/` or adopts a directory; the id and the path are validated before use (a `../` test)
- [ ] no `any`, no `!`, no suppression comment
- [ ] `docs/workflow-format.md`, `docs/extending.md`, `docs/using-the-alpha.md`, `docs/getting-started.md`, `README.md`, `CHANGELOG.md` (with the breaking heading) and `specs/DEPENDENCY_MAP.md` updated
