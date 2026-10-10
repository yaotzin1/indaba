# API surface contract: Step variants

> Builds on `specs/agent-mesh/api-surface.md` (`AgentMessage`, `ConsensusArbiter`, `ConsensusResult`),
> `specs/debate-arbiter/api-surface.md` (`Adjudicator`, `Ruling`, `RulingRequest`) and the existing `Workspace`,
> `WorkspaceManager` and `PatchService` of `@indaba/engine`. Siblings: `specs/step-budgets` and `specs/step-verdicts`
> (their fields are named here only where this feature meets them).

## Semver classification

**minor**. Everything is optional and additive: a workflow with no `variants` field, and a debate with no quorum rule
given, behave exactly as before.

- `AgentMessage`, `ConsensusResult`, `Ruling` and `RulingRequest` each gain an optional field. Code that constructs
  or reads them without the field is unaffected. An arbiter written before this change ignores `choice` and
  `ballot`.
- `ConsensusArbiterOptions` gains an optional `quorum`; the default is the current rule.
- `Workspace` gains one method and one optional parameter. The only implementer in this repository is `GitWorktree`;
  `Workspace` is documented as an engine seam, not an extension point, and the changelog says a third-party
  implementer must add `snapshot`.
- The maximum number of variants is an engine option, not part of the file format. Raising its default is a minor;
  lowering it, or lowering the default concurrency, is a major: a workflow that validated before would fail.

## Public symbols added

### `@indaba/core`

```ts
/** The default for the engine's `maxVariants`, and for a step's concurrency. Design choices; not measured. */
export const DEFAULT_MAX_VARIANTS = 3;
export const DEFAULT_VARIANT_CONCURRENCY = 2;

/** `variants: N` with its companion setting, normalised. Every variant uses the step's own configuration. */
export interface VariantsDefinition {
  readonly count: number;        // an integer of at least 2; the parser checks it against the engine's maxVariants
  readonly concurrency: number;  // 1 to count; default min(DEFAULT_VARIANT_CONCURRENCY, count)
}

/** The candidate ids a ballot can name, besides NONE. "variant-<index>". */
export const BALLOT_NONE = 'none';

/** A message's choice, when the reply's first line was `CHOICE: <id>`. */
export class AgentMessage {
  // existing constructor, with one optional trailing parameter:
  constructor(sender: string, type: MessageType, content: string, round: number, choice?: string);
  readonly choice?: string;                     // a candidate id or BALLOT_NONE; absent when the reply named none
  /** Parses `CHOICE: <id>` from the first line against the allowed ids; anything else yields no choice. */
  static fromBallotReply(sender: string, reply: string, round: number, allowed: readonly string[]): AgentMessage;
}

/** Counts the latest choice of each participant. Pure. */
export interface BallotTally {
  readonly counts: Readonly<Record<string, number>>; // only ids that were named
  readonly leader: string | null;                    // strictly the most; null on a tie or when no one chose
  readonly named: number;                            // how many participants have a choice
}
export function tallyBallot(board: Blackboard, participants: readonly Participant[]): BallotTally;

/** Decides, once per full round, whether the participants have settled. */
export interface QuorumRule {
  met(board: Blackboard, participants: readonly Participant[], decision: DecisionType): boolean;
}
export const AGREEMENT_QUORUM: QuorumRule;      // the current rule; the default
export const BALLOT_QUORUM: QuorumRule;         // met when the latest choices match, per consensus or majority

export interface ConsensusArbiterOptions {
  readonly maxRounds?: number;
  readonly pingPong?: PingPongDetector;
  readonly quorum?: QuorumRule;                 // added; default AGREEMENT_QUORUM
}

export class ConsensusResult {
  // existing constructor, with one optional trailing parameter:
  constructor(outcome: ConsensusOutcome, rounds: number, transcript: readonly AgentMessage[], ballot?: BallotTally);
  readonly ballot?: BallotTally;                // present only for a ballot quorum
  /** For a ballot that was reached: the choice all (or most) examiners named. */
  choice(): string | undefined;
}

export interface Ballot {                       // what an arbiter is shown beside the transcript
  readonly candidates: readonly string[];       // ids, in declaration order
  readonly counts: Readonly<Record<string, number>>;
  readonly leader: string | null;
}

export interface RulingRequest {
  // existing fields unchanged
  readonly ballot?: Ballot;                     // added: present only for a variants step's examination
}

export class Ruling {
  // existing constructor, with one optional trailing parameter:
  constructor(verdict: Verdict, note: string, source?: RulingSource, choice?: string);
  readonly choice?: string;                     // added: a candidate id; meaningful only with Verdict.Accept
}
```

`StepDefinition` gains:

```ts
readonly variants?: VariantsDefinition;
readonly examineWith: readonly string[];        // role names; empty unless the step has variants
```

New events (`@indaba/core`):

```ts
export class VariantFinished {
  constructor(readonly taskId: string, readonly stepId: string, readonly index: number,
              readonly outcome: 'passed' | 'failed' | 'cancelled') {}
}
export class SelectionMade {
  constructor(readonly taskId: string, readonly stepId: string,
              readonly choice: number | null,            // the chosen variant's index; null for none
              readonly source: 'examiners' | 'arbiter') {}
}
```

No new `PluginHost` method, no new registry and no new error class: the examination is a debate, so its arbiter is an
`Adjudicator` already registered; a failure surfaces as a failed step with a message, as an arbiter's does.

### `@indaba/engine`

```ts
export interface Workspace {
  path(): string;
  /** Unified diff of everything changed since `since` (a value from `snapshot`), or since the base commit when omitted. */
  diff(since?: string): Promise<string>;        // optional parameter added
  /** A handle for the workspace's current contents (a git tree id), usable with `diff(since)`. Needs no commit. */
  snapshot(): Promise<string>;                  // added
  destroy(): Promise<void>;
}

export interface WorkspaceManager {
  create(taskId: string, variant?: string): Promise<Workspace>;   // unchanged; `variant` already exists
}
```

The maximum is an engine option: `maxVariants?: number` on the parser's options (where it is enforced, with the message
of the validation table) and on `WorkflowEngineOptions`, defaulting to `DEFAULT_MAX_VARIANTS`. `StepExecutorOptions` gains
`readonly workspaces: WorkspaceManager` and `readonly patches: PatchService` (the engine already owns both). `StepExecutor.run` is unchanged in signature; a step with `variants` takes a new internal path, as
debate steps do. Variant worktrees are created with `create(taskId, "<stepId>-v<n>")`.

### `indaba` (CLI)

The composition root passes `maxVariants` (the default; no command-line flag in this spec, so changing it for the CLI is a
later, deliberate addition) to the parser and the engine. The terminal arbiter, given a `RulingRequest` with a `ballot`, prints the candidates with their counts and the leader,
and accepts `accept` (the leader), a candidate id (accept that candidate), or `reject`. Without a ballot it behaves
exactly as before. `indaba plan` prints the variants (below).

## Workflow schema

```yaml
steps:
  - id: implement
    role: coder
    isolation: git_worktree       # required with variants, on the step itself
    variants: 3                   # an integer of at least 2; the engine's maxVariants is the ceiling
    variants_concurrency: 2       # optional
    examine_with: [reviewer_a, reviewer_b]
    decision_type: consensus      # existing; consensus (default) or majority
    arbiter: human                # existing; asked when the examination stalls or runs out of rounds
    goal: "Implement the feature."
```

| Field | Meaning |
| :--- | :--- |
| `variants` | An integer of at least 2. There is no upper bound in the file format; the engine's `maxVariants` (default 3) is the ceiling, and a workflow above it fails validation. A mapping, a list or any other value is a validation error |
| `variants_concurrency` | Integer from 1 to the count. Default 2 (or the count, if smaller). Its own setting, apart from the maximum |
| `examine_with` | Non-empty list of role names that cross-examine the candidates. Required with `variants`; invalid without it. The step's own role is not an examiner unless listed |
| `decision_type`, `arbiter` | Existing fields. `arbiter` was valid only on a debate step (`consensus_with`); it is now also valid on a step with `examine_with` |

| Validation | Message names |
| :--- | :--- |
| not an integer, below 2 | the step and `variants` |
| above the engine's `maxVariants` | the step and the limit: `step "implement": variants 5 exceeds the maximum of 3` |
| `variants` on a shell step, on a debate step, or without `isolation: git_worktree` on the step itself | the step and the reason |
| `variants` without `examine_with`, or `examine_with` without `variants`, or an empty list | the step |
| `examine_with` names an undefined role | the step and the role |
| `variants` given as a list or mapping | the step: `variants` is one integer |
| `variants_concurrency` out of range or without `variants` | the step |

### The examiners' reply

Each examiner replies, every round, with a first line exactly `CHOICE: variant-<n>` or `CHOICE: none` (case of
`CHOICE` ignored, surrounding whitespace ignored), then free text. The engine compares that line with the known ids; no
other part of the reply is read as a choice.

## Surfaces changed

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow file | step fields `variants`, `variants_concurrency`, `examine_with` | added |
| workflow file | step field `arbiter` | now also valid with `examine_with` |
| CLI | `indaba plan` | prints variants (below) |
| CLI | options | none |
| artifact | `.indaba/artifacts/<step>.variant-<n>.diff` | added; overwritten on a retry |
| artifact | `.indaba/artifacts/<step>.selection.md` | added |
| artifact | `<step>.transcript.md`, `<step>.ruling.md` | unchanged format; also written for an examination |
| worktrees | `.indaba/worktrees/<taskId>-<stepId>-v<n>` | added; removed when the step ends |
| span | child span `indaba.variant <step>#<n>` and attributes | added; see `events.md` |
| events | `VariantFinished`, `SelectionMade` | added; see `events.md` |
| event stream | `variant_finished`, `selection_made` | added; see `events.md` |
| decision ledger | none | not read or written for a variants step (spec C-08) |

### `indaba plan` output

```
implement   role coder   isolation git_worktree
  variants 3 (maximum 3, concurrency 2, at most 3 worktrees at once)
    runner chain and model: the step's own (all variants)
  examine_with reviewer_a, reviewer_b   decision consensus   arbiter human
```

Candidates, costs and diffs do not exist at plan time and are not printed.

## Defaults introduced

- `maxVariants` 3 (engine option) and concurrency `min(2, count)`. Design choices, not measured.
- `decision_type` for an examination defaults to `consensus`, as for any debate.
- Attempts are numbered `variant-<n>` from 1; there are no labels.
- The default quorum of `ConsensusArbiter` stays `AGREEMENT_QUORUM`.
- A variants step is not recorded in the ledger and not reused.

## Checks

- [ ] `@indaba/core` imports no `node:` module (`architecture.test.ts`)
- [ ] A debate step without `variants` produces byte-identical transcripts, outcomes and spans to before (a
      regression test pins one)
- [ ] `docs/workflow-format.md` documents `variants`, `variants_concurrency`, `examine_with`, the reply line, says that
      variants share a machine and a user and are not a security boundary, that examiners are not told who wrote
      what, and that the limits are not measured
- [ ] `docs/extending.md` documents `Ruling.choice` and `RulingRequest.ballot` for arbiter authors, and how a
      third-party `Workspace` implementer gains `snapshot`
- [ ] No `any`, no `!`, no suppression comment
- [ ] Determinism test: the same workflow, ids and runner results give the same worktree names, numbering, offer
      order and ballot whatever order the variants finish in; the tally has no randomness
- [ ] No span attribute, event or log line holds a diff, a summary, a reason or a note
- [ ] Teardown test: every variant worktree is gone after completion, failure, escalation, cancellation and a throw
- [ ] A chosen diff is applied only after `canApply`, and a failed check applies nothing
- [ ] A reply that smuggles a second `CHOICE:` line, a path, or a candidate id with extra text yields no choice
