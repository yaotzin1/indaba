# API surface: Review gate

> **Semver impact**: minor (below 1.0). Every member is optional and new; nothing that has been released changes, and a
> workflow without `review.by` behaves as `step-verdicts` specifies. Classified under `.agents/skills/api_surface/SKILL.md`.
> `AnsweredBy` is a union that consumers may switch on, so adding a member to it is a major in practice (that skill, "union
> member"). It is a minor here only because `agent-conversation` has not been released; if it is released before this lands, the
> member is added in a major (or the gate records `policy` in a separate field and `AnsweredBy` is left alone).
> **Depends on**: `specs/step-verdicts` (`ReviewDefinition`, `StepOutcome`, `PromptBuilder`), `specs/agent-conversation`
> (`AnsweredBy`, the answerer kinds, the decider, the panel, the channel, metering), `specs/run-blackboard` (the board) and
> `specs/workspace-without-git` (`ChangeKind`, the change list between snapshots). None is implemented yet.

## `@indaba/core`

```ts
/** The built-in labels (AC-06). The author's own labels come from `send_back`. */
export const BuiltInLabel = { Approve: 'approve', Revise: 'revise', Back: 'back', Stop: 'stop' } as const;
export type BuiltInLabel = (typeof BuiltInLabel)[keyof typeof BuiltInLabel];

/** A label: a built-in or one of the author's (1 to 20 of [a-z0-9_-]; not a built-in, not `skipped`, not a step id). */
export type GateLabel = string;

export type GateTrigger = 'always' | 'doubt' | { readonly paths: readonly string[] };

export const IfNobody = { Fail: 'fail', Reject: 'reject', Approve: 'approve', Advice: 'advice' } as const;
export type IfNobody = (typeof IfNobody)[keyof typeof IfNobody];

/**
 * The members that make a `review` a gate. `StepDefinition.review` is `ReviewDefinition | GateDefinition`; a review is a
 * gate iff `by` is present. Every member except `by` has the default shown, so a parsed gate has all of them.
 */
export interface GateDefinition {
  /** `person`, or answerer kinds; `person` only last (AC-05). `decider` needs the `reviews` authority. */
  readonly by: readonly string[];
  readonly offer: readonly string[];                   // [] ; only when `person` is in `by`
  readonly advise: readonly string[];                  // [] ; panel | role:<name> | fresh:<name>, never the step's own role
  readonly panel: readonly string[];                   // [] ; roles, as ask.panel
  readonly panelRounds: number;                        // 3 ; 1 to 10
  readonly decision: 'consensus' | 'majority';         // 'consensus'
  readonly when: readonly GateTrigger[];               // ['always']
  readonly sendBackTo: string | undefined;             // a step id, or the word 'previous'; undefined = no `back` label
  readonly sendBack: Readonly<Record<string, string>>; // {} ; label -> step id, each the step or an ancestor
  readonly maxIterations: number;                      // 3 ; 1 to 10
  readonly ifNobody: IfNobody;                         // 'fail'
  readonly timeoutSeconds: number | undefined;         // 1 to 604800; undefined = never
  readonly workspace: 'keep';                          // 'restore' is a parse error in this version (AC-23)
}
export function isGate(review: ReviewDefinition | GateDefinition): review is GateDefinition;

/** `defaults.review`: a template; `by` is required, the rest optional (AC-03). */
export type DefaultsReview = Partial<GateDefinition> & { readonly by: readonly string[] };

/** What the engine computes (AC-13). Nothing here is model-written except `agentSays` and `doubt`; paths are cleaned. */
export interface GateEvidence {
  readonly stepId: string;
  readonly attempt: number;
  readonly outputs: readonly string[];
  readonly changed: readonly { readonly path: string; readonly status: ChangeKind }[];  // at most 50; ChangeKind of workspace-without-git
  readonly changedMore: number;                        // how many beyond the listed
  readonly guardsPassed: readonly string[];
  readonly agentSays?: string;                         // the last BOARD result: of the attempt, cut at 2000
  readonly doubt?: string;                             // the DOUBT: reason, cut at 500
}

export interface GateLabelInfo {
  readonly label: GateLabel;
  /** Written by the engine from the file (AC-13); never model text. */
  readonly consequence: string;
}

/** The request every answerer of a gate receives. Encoded as the channel writes it, at most 7000 bytes (AC-13). */
export interface GateRequest {
  readonly id: string;                                 // from the injected IdGenerator
  readonly stepId: string;
  readonly attempt: number;
  readonly iteration: number;
  readonly evidence: GateEvidence;
  readonly labels: readonly GateLabelInfo[];
  readonly advice?: { readonly label: GateLabel; readonly via: string };
}

/** The pure builder: fits the request into `maxBytes` by cutting in the order of AC-13 and cleans file names. */
export function buildGateRequest(
  parts: Omit<GateRequest, 'evidence'> & { readonly evidence: GateEvidence },
  maxBytes?: number,                                   // MAX_GATE_REQUEST_BYTES
): GateRequest;
export const MAX_GATE_REQUEST_BYTES: 7000;

export interface GateAnswer {
  readonly label: GateLabel;
  readonly note?: string;                              // already cut at 4000 and redacted by the engine
}

export type GateAnswerOutcome =
  | { readonly kind: 'answered'; readonly answer: GateAnswer; readonly answeredBy: AnsweredBy; readonly answerer: string; readonly via?: string }
  | { readonly kind: 'silent'; readonly reason: 'unreachable' | 'deadline' }       // AC-15: the only two
  | { readonly kind: 'faulty'; readonly reason: string };                         // anything else (AC-07, AC-15)

/**
 * Implemented by the built-in kinds next to `Answerer` (a class can implement both: the methods differ), and by a plugin
 * kind registered with `PluginHost.registerGateAnswerer` (C-11).
 */
export interface GateAnswerer {
  readonly kind: string;
  readonly metering: Metering;                         // agent-conversation AC-61; unmetered must say why
  answerGate(request: GateRequest, signal: AbortSignal): Promise<GateAnswerOutcome>;
}

/** Ends a wait and stops waiting for it (C-09). The composition root provides a real timer; tests provide a fake. */
export interface Deadline {
  after(ms: number, parent?: AbortSignal): { readonly signal: AbortSignal; dispose(): void };
}

/** What a decision records. `source` is agent-conversation's AnsweredBy, which gains 'policy' (AC-18). */
export interface GateDecision {
  readonly label: GateLabel;
  readonly source: AnsweredBy;
  readonly decidedBy?: string;                         // a decider's role, or `policy:<step id>`
  readonly note?: string;
  readonly iteration: number;
  readonly rule?: IfNobody;                            // set when source is 'policy'
  readonly via?: string;                               // for advice: the advisor; for a person who used a delegate: its name
}

/** AC-07: first-column `VERDICT: <label>` anywhere, outside code fences; the note is raw (the engine cuts and redacts). Pure. */
export function parseVerdictLine(
  reply: string,
  labels: readonly GateLabel[],
): { readonly kind: 'label'; readonly label: GateLabel; readonly note: string }
 | { readonly kind: 'none' | 'ambiguous' | 'unknown_label' };

/** AC-11: first-column `DOUBT: <reason>` outside code fences; the first counts; the reason is raw. Pure. */
export function parseDoubtLine(reply: string): string | undefined;

/** AC-26: each member's latest message names a label (parseVerdictLine); consensus = all the same, majority = more than half. Pure. */
export function panelLabelFrom(
  latestByMember: readonly { readonly member: string; readonly message: string }[],
  labels: readonly GateLabel[],
  decision: 'consensus' | 'majority',
): { readonly label: GateLabel; readonly note: string } | undefined;

export type ResolvedLabel =
  | { readonly action: 'continue' }                       // approve
  | { readonly action: 'stop' }                           // stop
  | { readonly action: 'again'; readonly target: string }; // revise (the step), back and send_back labels

/** AC-03, AC-06, AC-08: the labels of a gate for one step. A label left out of a template is not in the record. */
export function resolveGate(
  stepId: string,
  gate: GateDefinition | DefaultsReview,
  context: {
    readonly predecessors: readonly string[];
    readonly ancestors: ReadonlySet<string>;
    readonly stepIds: ReadonlySet<string>;
    readonly isTemplate: boolean;                         // a template leaves out labels that do not fit; a step errors
  },
): { readonly labels: Readonly<Record<GateLabel, ResolvedLabel>> } | { readonly error: string };

/** AC-15, AC-17, AC-18: pure. */
export function applyIfNobody(
  ifNobody: IfNobody,
  context: {
    readonly stepId: string;
    readonly iteration: number;
    readonly labels: Readonly<Record<GateLabel, ResolvedLabel>>;
    readonly advice: { readonly label: GateLabel; readonly via: string } | undefined;
  },
): { readonly kind: 'decision'; readonly decision: GateDecision }
 | { readonly kind: 'fail'; readonly why: 'configured' | 'no_advice' };

/** AC-10 to AC-12. Pure. `changedPaths` is undefined when there is no tracked workspace (armed, and `why` says so). */
export function isArmed(
  when: readonly GateTrigger[],
  facts: {
    readonly doubt: boolean;
    readonly changedPaths: readonly string[] | undefined;
    readonly sentBackBefore: boolean;                      // AC-10: armed whatever `when` says
  },
): { readonly armed: boolean; readonly why: string };

/** AC-24: an upper bound, from the definition alone, on how often each gate can be reached. Pure. */
export function gateBound(workflow: WorkflowDefinition): Readonly<Record<string, number>>;

/** `StepOutcome` gains the step's reply, for `doubt` and the agent's account. Never copied into a status reason or a span. */
//   readonly reply?: string;
```

Semver: new exports and optional members of a package below 1.0, minor. `GateDefinition` members have defaults, so a later member is
added with one.

`AnsweredBy` (agent-conversation api-surface) gains one literal, `'policy'`. Mapping to `indaba.gate.source`: `person`,
`panel`, `role`, `decider` and `policy` as themselves; `same-model-instance` as `fresh`; `plugin:<kind>` as `plugin`;
`skipped` is not a gate source.

## `PluginHost`

`registerGateAnswerer(kind: string, answerer: GateAnswerer): void`. A gate's `by` naming a kind with none registered is a parse
error. New method on a core contract: minor.

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
`reviews` authority applies; an unknown answerer kind, a plugin kind with no registered `GateAnswerer`, or an unknown role;
`advise` naming the step's own role; `send_back` naming a step that does not exist (anywhere, a template included) or, on a step,
one that is not the step or an ancestor (in a template that label is left out); a label that is a built-in, `skipped`, malformed or a
step id; `send_back_to: previous` on a step without exactly one predecessor; `if_nobody: advice` with no `advise`; `when: doubt` on
a shell or debate step; `workspace: restore`; `timeout_seconds` out of range.

## Engine

- `WorkflowEngine.execute` runs the gate after `validate` and before `COMPLETED`. A send-back moves the step `VALIDATING` to `FAILED`
  with the fixed reason `gate: <label>`; `on_failure` is not consulted and the `retries` counter does not move (AC-21). The note goes
  to the gate-note map, never to `outcome.feedback`.
- `StepOutcome` gains `reply?: string` (the runner's output kept for `doubt` and the agent's account).
- `StepRunOptions` gains `gateNote?: string`; `feedback?: string` keeps its meaning (the failure). `PromptBuilder.build(step, feedback?,
  gateNote?)` gains a third optional parameter. Its sections, in order: the role section and the other sections of
  `agent-conversation`, then the gate note, then the failure, then the verdict section (a review without `by` only); the gate note is
  under the person preamble when it came from a person and the data preamble when it came from a model. `DOUBT_INSTRUCTION` is added to
  the step under a gate whose `when` includes `doubt`. A step with none of these has a prompt byte-identical to today.
- The gate note is held in a map keyed by target, replaced by a newer note, delivered on every execution of the target and cleared when the
  target completes (AC-22). The failure map keeps its present lifecycle.
- The engine takes the workspace snapshot at the start of an attempt of a step under a gate with `paths`.
- `isReviewStep(step)` of `step-verdicts` is true only for a review without `by` (C-10).
- The engine takes a `Deadline` in its options (default: a real timer created by the composition root).

## Events

`GateDecided { taskId, stepId, iteration, source, label?, rule?, skipped }`: for a decision, `skipped` is false and `label` is set; for
a gate that was not armed, `skipped` is true and neither `label` nor `rule` is set. It carries no note or evidence text. New event: minor.

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

`StepStructure` (the web contract type, `packages/core`) and `describeStructure` gain one optional key per step, `gate`, holding the
labels and their targets and `when` as fixed words, so that `watch` and the page can draw the loop before the run starts.
`readStructure` must read the key in the same release that writes it (it rejects a whole structure on a malformed step), and the web
contract version moves by a minor.

## CLI

`indaba plan` prints, per step: the gate in force; `when` (with the sentence of AC-11 for `doubt`); the labels and the steps each would
run again (AC-21); `if_nobody` with the plain sentence of AC-18 when it is not `fail`; the bound of AC-24 and the worst wait; the
channel warning of the security section for every gate answered through the channel. No new command: a person answers with the prompt,
commands and dashboard of `agent-conversation`, extended to render a `GateRequest` (AC-14).

## Changes to other specs (made when this one is accepted)

- `step-verdicts` AC-01 and AC-02: `review` with a `by` is allowed on any step; the "both or neither" rule for `send_back_to` and
  `max_iterations` and the absence of a default hold for a review without `by`; AC-05 and C-05: "without a `by`, two verdicts; with one,
  a closed set of labels written in the file"; §5.3 row "one feedback slot per target" becomes "one gate note and one failure per
  target"; api-surface: `isReviewStep` (C-10), `PromptBuilder.build`, `StepOutcome.reply`.
- `agent-conversation` AC-08 and C-24: `reviews` authority is taken by naming `decider` in a gate's `by`; AC-44 and its api-surface:
  a gate's `by` may name `decider`; AC-06 and AC-15: a person times out only if a gate sets `timeout_seconds`; `AnsweredBy` gains
  `'policy'`; the `reviews` request and outcome stay for the review without `by`; `PluginHost.registerGateAnswerer`.
- `run-blackboard`: an engine entry with the scope `gate:<step>` is `accepted` when posted, exempt from `discarded` and `superseded`,
  and the scope joins its vocabulary (C-12).
- `question-contract`: the header sentence that calls a review request "the same contract with a different kind" is corrected (C-07).
- `workspace-without-git`: nothing, except that the change list between two snapshots of one attempt is what AC-12 uses.
- `docs/workflow-format.md`: every field above.
