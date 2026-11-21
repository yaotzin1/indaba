# API surface: Arbiter send-back

> **Semver impact**: minor (below 1.0). Every member is optional and new; a ruling without a label is what `debate-arbiter`
> specifies today. Classified under `.agents/skills/api_surface/SKILL.md`. Provisional until stage 3.
> **Depends on**: `specs/debate-arbiter` (`Adjudicator`, the ruling, the ledger), `specs/review-gate` (`GateLabel`, the closed set
> of labels, the counter) and `specs/step-verdicts`. Neither of the last two is implemented yet.

## `@indaba/core`

```ts
/** A ruling gains one optional member (AC-01, AC-02): the label of the gate that the run goes back by. */
export interface Ruling {
  readonly verdict: 'accept' | 'reject';
  readonly note?: string;
  /** Only with `reject`; one of the labels the step's gate allows (`GateLabel`, review-gate AC-06). Never a step id. */
  readonly label?: GateLabel;
}

/** What an adjudicator is told it may answer with (AC-03, AC-04). Empty means `accept` or `reject` only. */
export interface RulingOptions {
  readonly labels: readonly { readonly label: GateLabel; readonly target: string }[];
}
```

## Workflow file

No new field. The labels are the gate's (`review.send_back_to`, `review.send_back`, `review-gate` AC-06 and AC-08).

## Decision ledger

| Surface | Name | Change |
| :--- | :--- | :--- |
| ledger line (`.indaba-decisions/<workflow>.jsonl`) | `label` | optional string; absent on a ruling without a label (AC-08) |

## Span attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| span of a ruled step | `indaba.arbiter.label` | new, present only when the ruling carries a label (AC-10) |

## CLI

| Surface | Change |
| :--- | :--- |
| terminal arbiter | lists the allowed labels with their targets and accepts `reject <label>` (AC-04) |

## Changes to other specs

Made when this one is accepted: `debate-arbiter` section 4 (the non-goal about re-running after a `reject`) points here.

## Checks

- [ ] Every type in a new public signature is itself public
- [ ] `Ruling.label` is optional, so a plugin adjudicator written before this keeps compiling
- [ ] `pnpm qa` passes with no suppression comment
