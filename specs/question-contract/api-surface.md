# API surface: Question contract

> **Semver impact**: minor (below 1.0). Everything is optional and new; no existing export, field, default, event or
> attribute changes. Classified under `.agents/skills/api_surface/SKILL.md`.
> **Depends on**: `specs/agent-conversation` (the `ask` field and the question loop). Nothing here can be implemented
> before that spec is.

## `@indaba/core`

```ts
/** Closed set (AC-04, section 5 of the spec). */
export const ContractViolationCode = {
  MissingAll: 'missing_all',
  MissingContext: 'missing_context',
  TooFewOptions: 'too_few_options',
  TooManyOptions: 'too_many_options',
  DuplicateOption: 'duplicate_option',
  OptionWithoutConsequence: 'option_without_consequence',
  BadOptionId: 'bad_option_id',
  MissingRecommend: 'missing_recommend',
  RecommendNotAnOption: 'recommend_not_an_option',
  MissingOtherwise: 'missing_otherwise',
  PartTooLong: 'part_too_long',
} as const;
export type ContractViolationCode = (typeof ContractViolationCode)[keyof typeof ContractViolationCode];

/** Which part a violation concerns; never carries text of the question. */
export interface ContractViolation {
  readonly code: ContractViolationCode;
  readonly part: 'context' | 'options' | 'recommend' | 'otherwise';
}

export interface QuestionOption {
  readonly id: string;
  readonly text: string;
  readonly consequence: string;
}

/** What `parseAskLines` reads from a reply. Fields that were absent are `undefined` or empty. */
export interface StructuredQuestion {
  readonly context: string | undefined;
  readonly options: readonly QuestionOption[];
  readonly recommend: string | undefined;
  readonly otherwise: string | undefined;
}

/** The limits of the check. Defaults in `DEFAULT_QUESTION_CONTRACT`. */
export interface QuestionContract {
  readonly minOptions: number;
  readonly maxOptions: number;
  /** AC-55 of agent-conversation: the character limit of one part. */
  readonly maxPartLength: number;
}

export const DEFAULT_QUESTION_CONTRACT: QuestionContract; // { minOptions: 2, maxOptions: 5, maxPartLength: 2000 }

/** AC-02: reads `ASK ...` lines at the first character, outside code fences. Pure. */
export function parseAskLines(reply: string): { readonly question: StructuredQuestion; readonly stray: boolean };

/** AC-04, AC-05: pure; the result never contains text of the question. */
export function checkQuestion(
  question: StructuredQuestion,
  contract?: QuestionContract,
): readonly ContractViolation[];
```

Semver: new exports of a package below 1.0, minor. `QuestionContract` is an interface, so a field can be added later
without a break only if it is optional; new fields are added as optional.

## Workflow file

| Field | Where | Meaning | Default |
| :--- | :--- | :--- | :--- |
| `ask.contract` | step, role, `defaults` (the layering of `agent-conversation` AC-05) | `on` or `off` | `on` |
| `ask.max_contract_retries` | the same | integer, 0 to 5; `0` means the first violation escalates | `2` |

A parse error names the field path and why, for a value that is not `on`/`off`, a count outside 0 to 5, or either field on a
step without `ask`. Introduced as new optional fields: minor.

## Prompt sections (engine)

| Name | Content |
| :--- | :--- |
| `ASK_INSTRUCTION` (extended) | the grammar of AC-02 and the instruction to write for a person who has not seen the code (C-07) |
| `CONTRACT_SECTION` | fixed sentences and the violation codes of the last attempt, in plain words (AC-08); no question text |

## Span attributes

| Attribute | Value |
| :--- | :--- |
| `indaba.ask.contract_violations` | count of violations of the last checked question |
| `indaba.ask.contract_codes` | the codes, comma separated, from the closed set |
| `indaba.ask.stray` | count of `ASK` lines in a reply without a question |

New attributes: minor.

## Board record

A valid question's board entry carries the parts (context, the options, the recommendation, the otherwise) under the limits of
`run-blackboard` AC-29. The shape is the one `agent-conversation` already defines for a question entry plus these parts, as
optional members.

## Changes to other specs (made when this one is accepted, C-06)

- `agent-conversation` AC-40: the contract check sits between taking the first question and asking it.
- `agent-conversation` AC-42: a question counts once it meets the contract.
- Nothing changes in `run-blackboard`.
