# API surface contract: Step verdicts

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An agent that finds the
> contract wrong stops and reports. Builds on `specs/workflow-engine` (`on_failure`, `StepStatus`) and
> `specs/agent-mesh` (the `AGREEMENT` / `CRITIQUE` vocabulary, which is reused and not changed).

## Semver classification

**minor**. Every new field is optional: a workflow with no `review` parses, plans, prompts and runs exactly as
before (AC-10 pins the prompt byte for byte). `StepDefinition` gains an optional property (safe for callers that
construct it through `defineStep`). `StepOutcome` gains an optional member. `PromptBuilder.build` keeps its
signature.

## Public symbols added

### `@indaba/core`

```ts
/** What a reviewer's reply says. The words are the mesh's: AGREEMENT approves, CRITIQUE requires changes. */
export type ReviewVerdict = 'agreement' | 'critique';

/** Why a reply carries no usable verdict. Fixed codes: they may go into a span, the reply text may not. */
export type ReviewProblem = 'empty' | 'missing' | 'conflicting' | 'too_long';

export type ReviewParse =
  | { readonly ok: true; readonly verdict: 'agreement' }
  | { readonly ok: true; readonly verdict: 'critique'; readonly reason: string }
  | { readonly ok: false; readonly problem: ReviewProblem };

export const REVIEW_AGREEMENT_TAG = 'AGREEMENT:';
export const REVIEW_CRITIQUE_TAG = 'CRITIQUE:';
/** A longer reply is an invalid verdict. */
export const REVIEW_SCAN_LIMIT = 262144;
/** A critique's reason keeps its first this many characters. */
export const REVIEW_REASON_LIMIT = 4000;
export const MAX_REVIEW_ITERATIONS = 10;

/**
 * Reads the verdict from a reply. Pure and total: it never throws and builds no pattern from its input.
 * A tag line starts at the first column with exactly `AGREEMENT:` or `CRITIQUE:`. Both kinds present, or none,
 * or an empty or over-long reply, is a problem. A critique's `reason` is the text from the first CRITIQUE line
 * (tag removed), trimmed and cut to REVIEW_REASON_LIMIT characters.
 */
export function parseReview(output: string): ReviewParse;

/** The paragraph a failing review step carries so the next attempt knows the protocol. Never contains reply text. */
export function reviewProtocolReminder(): string;

/** Where a review step sends a critique. Both fields are present or both are absent. */
export interface ReviewDefinition {
  /** The step itself or one of its ancestors. Absent: a critique escalates at once. */
  readonly sendBackTo?: string;
  /** How many times a critique may send the run back; 1 to MAX_REVIEW_ITERATIONS. */
  readonly maxIterations?: number;
}
```

`StepDefinition` gains:

```ts
readonly review?: ReviewDefinition;
```

`defineStep` leaves it absent by default. `isReviewStep(step): boolean` is `step.review !== undefined`.

Five span attribute names join `Tracer` as `ATTR_*` constants, beside the existing ones (see `events.md`).

### `@indaba/engine`

```ts
// outcome.ts
export class StepOutcome {
  /** Set by StepExecutor.run when the step is a review step and its reply carried a valid verdict. */
  readonly verdict?: { readonly kind: 'agreement' } | { readonly kind: 'critique'; readonly reason: string };
  static okWithVerdict(
    verdict: { readonly kind: 'agreement' } | { readonly kind: 'critique'; readonly reason: string },
  ): StepOutcome;
}
```

`PromptBuilder.build(step, feedback?)` keeps its signature. For a review step it appends a final `## Verdict`
section (below) after every other section, including retry feedback.

`StepExecutor.run` keeps its signature. For a review step whose agent finished with `ok`, it reads the reply with
`parseReview`. An invalid reply returns `StepOutcome.failed(reviewProtocolReminder())` and records
`indaba.verdict.invalid`; a valid one returns an outcome carrying the verdict. `validate` is unchanged and runs
between the two (AC-06).

`WorkflowEngine` gains private routing and one counter map (`reviewIterations`, keyed by step id) next to
`retries`. Its public surface (`run`, `RunOptions`, `WorkflowResult`) is unchanged.

`parseWorkflow` and the validator accept and check the new field. `WorkflowValidationError` gains new messages; no
existing message changes.

### `indaba` (CLI)

`plan` prints the review lines (below). No new command and no new option.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow file | step field `review` | added: `{ send_back_to?, max_iterations? }` |
| workflow file | validation errors | added: see "Validation" |
| prompt | final `## Verdict` section | added, only on a review step |
| CLI | `plan` output | added: the review routing and the loop bound under the step |
| CLI | exit codes | none changed (`escalated` stays 2, `failed` 1) |
| span attribute | `indaba.verdict` | added: `agreement` or `critique` |
| span attribute | `indaba.verdict.action` | added: `continue`, `send_back` or `escalate` |
| span attribute | `indaba.verdict.iteration` | added: how many times this step has now sent the run back (1-based; present on `send_back` and on the escalation at the limit) |
| span attribute | `indaba.verdict.max_iterations` | added: the limit (present when `send_back_to` is set) |
| span attribute | `indaba.verdict.invalid` | added: `empty`, `missing`, `conflicting` or `too_long` |
| span event | none | none added |
| mesh | `AgentMessage` parsing | **unchanged** |

### Validation (errors; each names the field path)

- `review` on a `shell` step: `steps[i] (id) has review but is a shell step`.
- `review` on a debate (`consensus_with` or `decision_type`): `steps[i] (id) has review but is a debate`.
- `review` that is not a map, or has a key other than `send_back_to` and `max_iterations`.
- `send_back_to` without `max_iterations`, or the reverse.
- `send_back_to` that is not a step, or is neither the step itself nor one of its ancestors (the `on_failure` rule).
- `max_iterations` that is not an integer from 1 to 10.

### `plan` output

Under a review step:

```
  review: agreement -> continue; critique -> send back to "code" (max 3)
  reruns of "code" bounded by 2 + 3 = 5
```

The second line appears for a target that also has loops pointing at it: the first number is the sum of
`on_failure.max_retries` of the steps that retry it (0 when none), the second the sum of `max_iterations` of the
review steps that send back to it. Without `send_back_to`: `review: agreement -> continue; critique -> escalate`.

### Prompt section

Appended to the prompt of a review step, after every other section:

```
## Verdict
State your verdict on a line that starts, in capitals and at the first column, with `AGREEMENT:` if the work is acceptable as it stands, or with `CRITIQUE:` followed by what must change. Use one of the two only: no line may start with the other. Everything from the `CRITIQUE:` line on is sent to the author.
```

The target's prompt uses the existing "previous attempt" section, with the feedback
`Review step "<id>" returned a critique:` followed by the reason.

## Defaults introduced

- No `review` means nothing changes.
- A review step with `send_back_to` has no default `max_iterations`; omitting it is an error.
- The words `AGREEMENT:` and `CRITIQUE:`, the first-column rule, the 262144 scan limit, the 4000-character reason
  cut (head kept) and the 1 to 10 range are defaults. Changing any of them is a major (it changes which replies are
  accepted or how far a run can loop).

## Checks

- [ ] `@indaba/core` imports no `node:` module (`architecture.test.ts`)
- [ ] `parseReview` is pure and total (property test over arbitrary strings: never throws; `agreement` is returned
      only when no `CRITIQUE:` line exists)
- [ ] A step without `review` produces a byte-identical prompt (snapshot test, with and without feedback)
- [ ] No `StepStatus` was added; the transition table is unchanged (`state.ts` untouched)
- [ ] The mesh's reply parsing and every debate test are unchanged and green
- [ ] No span attribute, event, status reason or exception message holds reply text
- [ ] `docs/workflow-format.md` documents `review`, the protocol and the loop bound
- [ ] No `any`, no `!`, no suppression comment
