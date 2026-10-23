# API surface: Review gate

> **Semver impact**: minor (below 1.0). Every member is optional and new; nothing that has been released changes, and a
> workflow without `review.by` behaves as `step-verdicts` specifies. Classified under `.agents/skills/api_surface/SKILL.md`.
> **Depends on**: `specs/step-verdicts` (`ReviewDefinition`), `specs/agent-conversation` (`AnsweredBy`, the answerers, the
> channel, `StepQuestion`), `specs/question-contract` (`StructuredQuestion`) and `specs/run-blackboard` (the board). None is
> implemented yet.

## `@indaba/core`

```ts
/** The built-in labels (AC-06). The author's own labels come from `send_back`. */
export const GateLabel = {
  Approve: 'approve',
  Revise: 'revise',
  Back: 'back',
  Stop: 'stop',
} as const;
export type GateLabel = (typeof GateLabel)[keyof typeof GateLabel] | string;

export const GateWhen = { Always: 'always', Doubt: 'doubt' } as const;
export type GateTrigger = 'always' | 'doubt' | { readonly paths: readonly string[] };

export const IfNobody = { Fail: 'fail', Reject: 'reject', Approve: 'approve', Recommendation: 'recommendation' } as const;
export type IfNobody = (typeof IfNobody)[keyof typeof IfNobody];

/** New optional members of `ReviewDefinition` (step-verdicts api-surface). A review with no `by` has none of them. */
export interface GateDefinition {
  readonly by: 'person' | readonly string[];          // person, or answerer kinds (agent-conversation AC-44)
  readonly offer?: readonly string[];                 // only with by: 'person'
  readonly panel?: readonly string[];                 // roles, as ask.panel
  readonly panelRounds?: number;                      // 1 to 10, default 3
  readonly decision?: 'consensus' | 'majority';
  readonly when: readonly GateTrigger[];              // default ['always']
  readonly sendBackTo?: string;                       // the target of `back` (step-verdicts)
  readonly sendBack: Readonly<Record<string, string>>; // label -> step id; each an ancestor or the step
  readonly maxIterations: number;                     // 1 to 10, default 3
  readonly ifNobody: IfNobody;                        // default 'fail'
  readonly timeoutSeconds?: number;                   // 1 to 604800; absent = never
  readonly workspace: 'keep';                         // 'restore' is a parse error in this version (AC-23)
}

/** `defaults.review`: a template resolved per step (AC-03, AC-08). */
export interface DefaultsReview extends Partial<GateDefinition> {}

/** What the engine computes (AC-14). Every list is bounded; nothing here is model-written except `agentSays`. */
export interface GateEvidence {
  readonly stepId: string;
  readonly attempt: number;
  readonly outputs: readonly string[];
  readonly changed: readonly { readonly path: string; readonly status: 'added' | 'modified' | 'deleted' }[];
  readonly changedMore: number;                       // how many beyond the listed 50
  readonly guardsPassed: readonly string[];
  readonly agentSays?: string;                        // cut at 2000, labelled by the front end as the agent's
  readonly doubt?: string;                            // the agent's DOUBT: reason, if any
}

export interface GateDecision {
  readonly label: GateLabel;
  readonly source: AnsweredBy;                        // gains 'policy' (below)
  readonly note?: string;                             // at most 4000, redacted
  readonly iteration: number;
  readonly rule?: IfNobody;                           // set when source is policy
  readonly via?: string;                              // for recommendation: the source that produced the label
}

/** agent-conversation's AnsweredBy gains one member (AC-18). */
//   | { readonly kind: 'policy'; readonly gate: string }

/** AC-07: pure; `labels` is the closed set of the gate. Returns undefined for anything else. */
export function parseVerdictLine(
  reply: string,
  labels: readonly string[],
): { readonly label: string; readonly note: string } | undefined;

/** AC-06, AC-08: the labels of a gate and their targets for one step, from its definition and its ancestors. */
export function resolveGate(
  step: StepDefinition,
  gate: GateDefinition,
  predecessors: readonly string[],
  ancestors: ReadonlySet<string>,
): { readonly labels: Readonly<Record<string, string | undefined>> } | { readonly error: string };

/** AC-15, AC-17, AC-18: pure; the decision Indaba's policy takes when nobody answered, or `undefined` for fail. */
export function applyIfNobody(
  ifNobody: IfNobody,
  labels: readonly string[],
  recommendation: { readonly label: string; readonly via: string } | undefined,
): GateDecision | undefined;

/** A trigger is armed or not (AC-10 to AC-12). Pure. */
export function isArmed(
  when: readonly GateTrigger[],
  facts: { readonly doubt: boolean; readonly changedPaths: readonly string[] | undefined },
): { readonly armed: boolean; readonly why: string };
```

Semver: new exports and optional members of a package below 1.0, minor. `AnsweredBy` gaining a member is a minor for a
consumer that handles it exhaustively only if it was documented as open; `agent-conversation` documents it as open
(`plugin:<kind>` is already a member).

## Workflow file

New members of `review` (valid only with `by`, AC-01):

| Field | Meaning | Default |
| :--- | :--- | :--- |
| `by` | `person`, or a list of answerer kinds | none (not a gate) |
| `offer` | with `by: person`: what the person may delegate to | none |
| `panel`, `panel_rounds`, `decision` | as `ask.panel`, `ask.panel_rounds`, `ask.decision` | as there |
| `when` | `always`, `doubt`, `{ paths: [globs] }`, or a list of them | `always` |
| `send_back` | map of label to step id (the step or an ancestor) | none |
| `send_back_to`, `max_iterations` | as `step-verdicts`; `max_iterations` defaults to `3` on a gate | |
| `if_nobody` | `fail`, `reject`, `approve`, `recommendation` | `fail` |
| `timeout_seconds` | integer 1 to 604800 | none (never) |
| `workspace` | `keep` (`restore` is rejected) | `keep` |

`review: none` turns a gate off for a step. `defaults.review` is a `review` map. A parse error names the field path and why
for: a gate member without `by`; `by: person` and a list together; `offer` without `by: person`; an unknown answerer kind or
role; `send_back` naming a step that is not the step or an ancestor; a label that collides with a built-in; `back` used with
no `send_back_to` on a step without exactly one predecessor; `recommendation` with no panel, role or fresh source;
`workspace: restore`; `timeout_seconds` out of range. Mirrors `agent-conversation` AC-44 for the kinds.

## Feedback slots (engine)

The engine's feedback map becomes keyed by target and by kind (`gate`, `failure`), one entry each (AC-22). The `PromptBuilder`
renders the gate slot, then the failure slot, each labelled and bounded at 4000 characters. A step with neither has a prompt
byte-identical to today.

## Prompt sections

| Name | Content |
| :--- | :--- |
| `GATE_ANSWER_INSTRUCTION` | for a model answerer: the evidence as data, the labels with their consequences, the line `VERDICT: <label>` and the note below it; read-only |
| `GATE_NOTE_SECTION` (in the target) | the last gate note, labelled as the answerer's, as data |

## Span attributes

| Attribute | Value |
| :--- | :--- |
| `indaba.gate.label` | the label decided |
| `indaba.gate.source` | `person`, `panel`, `role`, `fresh`, `decider` or `policy` |
| `indaba.gate.iteration`, `indaba.gate.max_iterations` | numbers |
| `indaba.gate.when` | the triggers, as fixed words (`always`, `doubt`, `paths`) |
| `indaba.gate.if_nobody` | the value in force |

None carries a note, a reason or evidence text. New attributes: minor.

## Trace structure

`indaba.workflow.structure` gains one optional key per step, `gate`, holding the labels and their targets and `when` as fixed
words, so that `watch` and the page can draw the loop before the run starts. `readStructure` must read the key in the same
release that writes it (it rejects a whole structure on a malformed step).

## CLI

`indaba plan` prints, per step, the gate in force, `when`, `if_nobody` (with the plain sentence of AC-18 when it is not
`fail`), the steps each label would run again, and `gates x iterations`. No new command: a person answers with the commands
and the dashboard of `agent-conversation`.

## Changes to other specs (made when this one is accepted)

- `step-verdicts` AC-01 and AC-02: `review` with a `by` is allowed on any step; the pair `send_back_to`/`max_iterations` rule
  holds for a review without `by`. C-05: "a closed set of labels written in the file".
- `agent-conversation` AC-08 and C-24: `reviews` takes effect. AC-06 and AC-15: a person times out only if the gate sets
  `timeout_seconds`. `AnsweredBy` gains `policy`.
- `question-contract`: kind `review`, in which `recommend` is optional (C-07).
- `run-blackboard`: the scope `gate:<step>` for board entries.
- `docs/workflow-format.md`: every field above.
