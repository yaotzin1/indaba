# API surface: Review gate

> **Semver impact**: minor (below 1.0). Every member is optional and new; nothing that has been released changes, and a
> workflow without `review.by` behaves as `step-verdicts` specifies. Classified under `.agents/skills/api_surface/SKILL.md`.
> `AnsweredBy` is a union that consumers may switch on, so adding a member to it is a major in practice (that skill, "union
> member"). It is a minor here only because `agent-conversation` has not been released; if it is released before this lands, the
> member is added in a major (or the gate records `policy` in a separate field and `AnsweredBy` is left alone).
> **Depends on**: `specs/step-verdicts` (`ReviewDefinition`, `StepOutcome`, `PromptBuilder`), `specs/agent-conversation`
> (`AnsweredBy`, the answerer kinds, the decider, the panel, the channel), `specs/run-blackboard` (the board) and
> `specs/workspace-without-git` (the change list). None is implemented yet.

## `@indaba/core`

```ts
/** The built-in labels (AC-06). The author's own labels come from `send_back`. */
export const BuiltInLabel = { Approve: 'approve', Revise: 'revise', Back: 'back', Stop: 'stop' } as const;
export type BuiltInLabel = (typeof BuiltInLabel)[keyof typeof BuiltInLabel];

/** A label: a built-in or one of the author's (1 to 20 of [a-z0-9_-], not a built-in, not a step id). */
export type GateLabel = string;

export type GateTrigger = 'always' | 'doubt' | { readonly paths: readonly string[] };

export const IfNobody = { Fail: 'fail', Reject: 'reject', Approve: 'approve', Advice: 'advice' } as const;
export type IfNobody = (typeof IfNobody)[keyof typeof IfNobody];

/**
 * New optional members of `ReviewDefinition` (step-verdicts api-surface); a review is a gate iff `by` is present.
 * `StepDefinition.review` is `ReviewDefinition | GateDefinition`, discriminated by `isGate`.
 */
export interface GateDefinition {
  /** `person`, or answerer kinds; `person` only last (AC-05). `decider` needs the `reviews` authority. */
  readonly by: readonly string[];
  readonly offer?: readonly string[];                  // only when `person` is in `by`
  readonly advise?: readonly string[];                 // panel | role:<name> | fresh:<name>, never the step's own role
  readonly panel?: readonly string[];                  // roles, as ask.panel
  readonly panelRounds?: number;                       // 1 to 10, default 3
  readonly decision?: 'consensus' | 'majority';
  readonly when: readonly GateTrigger[];               // default ['always']
  readonly sendBackTo?: string;                        // a step id, or the word 'previous'
  readonly sendBack: Readonly<Record<string, string>>; // label -> step id; each the step or an ancestor
  readonly maxIterations: number;                      // 1 to 10, default 3
  readonly ifNobody: IfNobody;                         // default 'fail'
  readonly timeoutSeconds?: number;                    // 1 to 604800; absent = never
  readonly workspace: 'keep';                          // 'restore' is a parse error in this version (AC-23)
}
export function isGate(review: ReviewDefinition | GateDefinition): review is GateDefinition;

/** `defaults.review`: a template; `by` is required, the rest optional (AC-03). */
export type DefaultsReview = Partial<GateDefinition> & { readonly by: readonly string[] };

/** What the engine computes (AC-13). Every list is bounded; nothing here is model-written except `agentSays` and `doubt`. */
export interface GateEvidence {
  readonly stepId: string;
  readonly attempt: number;
  readonly outputs: readonly string[];
  readonly changed: readonly { readonly path: string; readonly status: 'added' | 'modified' | 'deleted' }[]; // at most 50
  readonly changedMore: number;                        // how many beyond the listed
  readonly guardsPassed: readonly string[];
  readonly agentSays?: string;                         // cut at 2000; a front end labels it as the agent's
  readonly doubt?: string;                             // the DOUBT: reason, cut at 500
}

export interface GateLabelInfo {
  readonly label: GateLabel;
  /** Written by the engine from the file (AC-13); never model text. */
  readonly consequence: string;
}

/** The request every answerer of a gate receives. At most 6000 UTF-8 bytes in all (AC-13). */
export interface GateRequest {
  readonly id: string;                                 // from the injected IdGenerator
  readonly stepId: string;
  readonly attempt: number;
  readonly iteration: number;
  readonly evidence: GateEvidence;
  readonly labels: readonly GateLabelInfo[];
  readonly advice?: { readonly label: GateLabel; readonly via: string };
}

export interface GateAnswer {
  readonly label: GateLabel;
  readonly note?: string;                              // at most 4000, redacted
}

export type GateAnswerOutcome =
  | { readonly kind: 'answered'; readonly answer: GateAnswer; readonly answeredBy: AnsweredBy; readonly answerer: string }
  | { readonly kind: 'silent'; readonly reason: string }       // NO ANSWER, no person reachable, no quorum
  | { readonly kind: 'faulty'; readonly reason: string };      // call failed, budget stop, protocol not met (AC-07)

/** Implemented by person, panel, role, fresh and decider; a plugin kind implements it to serve gates (C-11). */
export interface GateAnswerer {
  readonly kind: string;
  answer(request: GateRequest, signal: AbortSignal): Promise<GateAnswerOutcome>;
}

/** Ends a wait (C-09). The composition root provides a real timer; tests provide a fake. */
export interface Deadline {
  after(ms: number): AbortSignal;
}

/** What a decision records. `source` is agent-conversation's AnsweredBy, which gains 'policy' (AC-18). */
export interface GateDecision {
  readonly label: GateLabel;
  readonly source: AnsweredBy;
  readonly decidedBy?: string;                         // a decider's role, or `policy:<step id>`
  readonly note?: string;
  readonly iteration: number;
  readonly rule?: IfNobody;                            // set when source is 'policy'
  readonly via?: string;                               // for advice: the advisor
}

/** AC-07: first-column `VERDICT: <label>` anywhere in the reply, outside code fences; pure. */
export function parseVerdictLine(
  reply: string,
  labels: readonly GateLabel[],
): { readonly label: GateLabel; readonly note: string } | 'none' | 'ambiguous' | 'unknown_label';

/** AC-11: first-column `DOUBT: <reason>` outside code fences; the first counts; cut at 500; pure. */
export function parseDoubtLine(reply: string): string | undefined;

/** AC-07, panel: the label a panel agreed on, per `decision`; undefined when there is no quorum on one label. Pure. */
export function panelLabelFrom(
  transcript: readonly AgentMessage[],
  labels: readonly GateLabel[],
  decision: 'consensus' | 'majority',
): { readonly label: GateLabel; readonly note: string } | undefined;

/** AC-03, AC-06, AC-08: the labels and targets of a gate for one step; an error names the field path and why. */
export function resolveGate(
  stepId: string,
  gate: GateDefinition | DefaultsReview,
  context: {
    readonly predecessors: readonly string[];
    readonly ancestors: ReadonlySet<string>;
    readonly stepIds: ReadonlySet<string>;
    readonly isTemplate: boolean;                      // a template leaves out labels that do not fit; a step errors
  },
): { readonly labels: Readonly<Record<GateLabel, string | undefined>> } | { readonly error: string };

/** AC-15, AC-17, AC-18: pure. `fail` returns undefined. */
export function applyIfNobody(
  ifNobody: IfNobody,
  context: {
    readonly stepId: string;
    readonly iteration: number;
    readonly labels: Readonly<Record<GateLabel, string | undefined>>;
    readonly advice: { readonly label: GateLabel; readonly via: string } | undefined;
  },
): GateDecision | undefined;

/** AC-10 to AC-12. Pure. `changedPaths` is undefined when there is no tracked workspace (armed, and `why` says so). */
export function isArmed(
  when: readonly GateTrigger[],
  facts: { readonly doubt: boolean; readonly changedPaths: readonly string[] | undefined },
): { readonly armed: boolean; readonly why: string };

/** AC-24: the most times each gate can be reached, from the definition alone. Pure. */
export function gateBound(workflow: WorkflowDefinition): Readonly<Record<string, number>>;

export const MAX_GATE_REQUEST_BYTES: number;           // 6000 (C-02)
```

Semver: new exports and optional members of a package below 1.0, minor. `GateDefinition` is an interface, so later members are
added as optional ones.

`AnsweredBy` (agent-conversation api-surface) gains one literal, `'policy'`. Mapping to `indaba.gate.source`: `person`,
`panel`, `role`, `decider` and `policy` as themselves; `same-model-instance` as `fresh`; `plugin:<kind>` as `plugin`;
`skipped` is not a gate source.

## Workflow file

New members of `review` (valid only with `by`, AC-01):

| Field | Meaning | Default |
| :--- | :--- | :--- |
| `by` | `person`, or a list of `panel`, `role:<name>`, `fresh:<name>`, `decider`, plugin kinds; `person` only last | none (not a gate) |
| `offer` | with `person` in `by`: what the person may delegate to | none |
| `advise` | `panel`, `role:<name>`, `fresh:<name>`; not the step's own role | none |
| `panel`, `panel_rounds`, `decision` | as `ask.panel`, `ask.panel_rounds`, `ask.decision` | as there |
| `when` | `always`, `doubt`, `{ paths: [globs] }`, or a list | `always` |
| `send_back` | map of label to step id (the step or an ancestor) | none |
| `send_back_to`, `max_iterations` | as `step-verdicts`; `send_back_to` may be `previous`; `max_iterations` defaults to `3` on a gate | |
| `if_nobody` | `fail`, `reject`, `approve`, `advice` | `fail` |
| `timeout_seconds` | integer 1 to 604800 | none (never) |
| `workspace` | `keep` (`restore` is rejected) | `keep` |

`review: none` turns a gate off for a step. `defaults.review` is a `review` map with a `by`. A parse error names the field path
and why for: a gate member without `by`; `person` anywhere but last; `offer` without `person`; `decider` when no decider with
`reviews` authority applies; an unknown answerer kind, a plugin kind that does not implement `GateAnswerer`, or an unknown role;
`advise` naming the step's own role; `send_back` naming a step that is not the step or an ancestor (on a step; in a template the
label is left out); a label that is a built-in, malformed or a step id; `send_back_to: previous` on a step without exactly one
predecessor; `if_nobody: advice` with no `advise`; `when: doubt` on a shell or debate step; `workspace: restore`;
`timeout_seconds` out of range.

## Engine

- `StepRunOptions` gains `gateNote?: string`; `feedback?: string` keeps its meaning (the failure). `PromptBuilder.build(step,
  feedback?, gateNote?)` gains a third optional parameter and renders the gate note first, each labelled and as data (AC-22).
  A step with neither has a prompt byte-identical to today. The engine's feedback map becomes two maps keyed by target; each entry is
  consumed on the target's next execution.
- `isReviewStep(step)` of `step-verdicts` is true only for a review without `by` (C-10).
- The engine takes a `Deadline` in its options (default: a real timer created by the composition root).

## Events

`GateDecided { taskId, stepId, label, source, iteration, rule? }`, dispatched for every decision, a policy decision and a skipped
gate included (`label` is `skipped` and `source` is `policy` with `rule: not-armed`). It carries no note or evidence text. New
event: minor.

## Span attributes

| Attribute | Value |
| :--- | :--- |
| `indaba.gate.label` | the label decided |
| `indaba.gate.source` | `person`, `panel`, `role`, `fresh`, `decider`, `plugin` or `policy` |
| `indaba.gate.iteration`, `indaba.gate.max_iterations` | numbers |
| `indaba.gate.when` | the triggers, as fixed words (`always`, `doubt`, `paths`) |
| `indaba.gate.if_nobody` | the value in force |
| `indaba.gate.wait_ms` | how long the gate waited |

None carries a note, a reason or evidence text. The wait is a child span `gate <step>` of the step span. New attributes: minor.

## Trace structure

`indaba.workflow.structure` gains one optional key per step, `gate`, holding the labels and their targets and `when` as fixed words,
so that `watch` and the page can draw the loop before the run starts. `readStructure` must read the key in the same release that
writes it (it rejects a whole structure on a malformed step).

## CLI

`indaba plan` prints, per step: the gate in force; `when` (with the sentence of AC-11 for `doubt`); the labels and the steps each would
run again (AC-21); `if_nobody` with the plain sentence of AC-18 when it is not `fail`; the bound of AC-24 and the worst wait; the
channel warning of the security section when it applies. No new command: a person answers with the prompt, commands and dashboard of
`agent-conversation`, extended to render a `GateRequest` (AC-14).

## Changes to other specs (made when this one is accepted)

- `step-verdicts` AC-01 and AC-02: `review` with a `by` is allowed on any step; AC-05 and C-05: "without a `by`, two verdicts; with one,
  a closed set of labels written in the file"; §5.3 row "one feedback slot per target" becomes "one gate note and one failure per target";
  api-surface: `isReviewStep` (C-10), `PromptBuilder.build`.
- `agent-conversation` AC-08 and C-24: `reviews` authority is taken by naming `decider` in a gate's `by`; AC-06 and AC-15: a person times
  out only if a gate sets `timeout_seconds`; `AnsweredBy` gains `'policy'`; the `reviews` request and outcome stay for the review
  without `by`; `Answerer` gains a gate counterpart in the extension contract.
- `run-blackboard`: an engine entry with the scope `gate:<step>` is `accepted` when posted (C-12).
- `workspace-without-git`: nothing, except that the change list between two snapshots of one attempt is what AC-12 uses.
- `docs/workflow-format.md`: every field above.
