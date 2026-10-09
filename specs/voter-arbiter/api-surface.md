# API surface contract: Voter arbiter

> Builds on `specs/debate-arbiter/api-surface.md` (`Adjudicator`, `Ruling`, `RulingRequest`, `PluginHost`).

## Semver classification

**minor**. Everything is optional: a workflow with no `voters` field and a single `arbiter` name behaves as
before. `arbiter` accepting a list is additive. `PluginHost` gains a method (safe for callers; the CLI's
`RegistryPluginHost` is the only implementer in this repository, as with `registerAdjudicator`).

## Public symbols added

### `@indaba/core`

```ts
/** One voter's opinion. A score is 0 to 10; an abstention says why it could not give one. */
export type Vote =
  | { readonly kind: 'score'; readonly score: number; readonly reason: string }
  | { readonly kind: 'abstain'; readonly reason: string };

/** Scores a failed debate from its transcript. Pure: no I/O, no clock, no randomness. */
export interface Voter {
  readonly name: string;                       // what `voters.use` writes
  vote(request: RulingRequest): Vote;
  readonly description?: string;              // one line a wizard shows next to the name
}

export class VoterRegistry {
  register(voter: Voter, options?: { readonly replace?: boolean }): void; // duplicate without replace: IndabaError
  get(name: string): Voter | undefined;
  names(): readonly string[];                  // in registration order
  describe(): readonly { readonly name: string; readonly description: string }[]; // "" when a voter has none
}

export const AGREEMENT_VOTER: Voter;           // name "agreement"
export const OVERLAP_VOTER: Voter;             // name "overlap"
export const BUILT_IN_VOTERS: readonly Voter[]; // [agreement, overlap]

export interface VotersDefinition {
  readonly use?: readonly string[];            // default: every built-in voter, in order
  readonly acceptAt: number;                   // default 7
  readonly rejectBelow: number;                // default 4
}

/** The `voters` arbiter: the mean of the cast scores against two thresholds. */
export class VotersAdjudicator implements Adjudicator {
  constructor(voters: VoterRegistry);
  /** Needs the step's settings, so it reads them from the request (below). */
  rule(request: RulingRequest, signal?: AbortSignal): Promise<Ruling | null>;
}
```

`RulingRequest` gains `readonly voters: VotersDefinition` (always present; the defaults when the step has no
`voters` block). Adjudicators written against `specs/debate-arbiter` ignore it.

`StepDefinition` gains `readonly fallbackArbiters?: readonly string[]` beside the existing `arbiter?: string`
(the first name, as `runner` and `fallbackRunners`), and `readonly voters?: VotersDefinition`.

`PluginHost` gains `registerVoter(voter: Voter, options?: { readonly replace?: boolean }): void`.

### `@indaba/engine`

`StepExecutorOptions` gains `readonly voters?: VoterRegistry` (the registry `VotersAdjudicator` reads is the same
object, so a plugin's override is seen). `runConsensus` tries `[arbiter, ...fallbackArbiters]` in order.

### `indaba` (CLI)

`RegistryPluginHost.registerVoter`; `createEngine` registers `BUILT_IN_VOTERS` through it and registers a
`VotersAdjudicator` as the arbiter `voters`.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow file | step field `arbiter` | now a name or a list of names (`arbiter: [voters, human]`) |
| workflow file | step field `voters` | added: `use`, `accept_at`, `reject_below` |
| workflow file | validation errors | added: empty `arbiter` list, bad `voters` numbers, `voters` without the `voters` arbiter |
| CLI | none | no new option |
| span attribute | `indaba.arbiter.score` | added: the mean of the cast scores (a number) |
| span attribute | `indaba.arbiter.votes` | added: how many scores were cast |
| span attribute | `indaba.arbiter.kind` | meaning refined: the arbiter that ruled (was: the one asked) |

## Defaults introduced

- Built-in voters, in order: `agreement`, `overlap`.
- `accept_at` 7, `reject_below` 4, on a 0 to 10 scale. Changing any of these is a major (it changes which
  debates are decided without a person).
- A voter's reason is cut at 300 characters.
- The cited-file token for `overlap` is `[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,5}`, `:line` suffix removed. Changing it
  is a major for the same reason.

## Checks

- [ ] `@indaba/core` imports no `node:` module (`architecture.test.ts`)
- [ ] The built-in voters and the `voters` arbiter register through `PluginHost`, like a plugin's
- [ ] `docs/workflow-format.md` documents `arbiter` lists, `voters`, the voters, and says what the scores do not mean
- [ ] No `any`, no `!`, no suppression comment
- [ ] Determinism test: the same request twice gives the same ruling, in any registration order of unrelated voters
- [ ] No span attribute holds a reason or transcript text
