# API surface: Question contract

> **Semver impact**: minor (below 1.0). Everything is optional and new; nothing that has been released changes. Because it
> changes what `ask` does by default, it ships with or before the question loop of `agent-conversation` (spec C-08);
> shipped after that loop was released, it would be a major under `.agents/skills/api_surface/SKILL.md`.
> **Depends on**: `specs/agent-conversation` (the `ask` field, `StepQuestion`, `AnswerOutcome`, the channel) and
> `specs/run-blackboard` (the board and the `BOARD` grammar). Neither is implemented yet.

## `@indaba/core`

```ts
/** Closed set (AC-06, section 5 of the spec). */
export const ContractViolationCode = {
  MissingAll: 'missing_all',
  MissingContext: 'missing_context',
  TooFewOptions: 'too_few_options',
  TooManyOptions: 'too_many_options',
  DuplicateOption: 'duplicate_option',
  BadOptionId: 'bad_option_id',
  OptionWithoutConsequence: 'option_without_consequence',
  MissingRecommend: 'missing_recommend',
  RecommendNotAnOption: 'recommend_not_an_option',
  MissingOtherwise: 'missing_otherwise',
  RepeatedPart: 'repeated_part',
  PartTooLong: 'part_too_long',
  QuestionTooLong: 'question_too_long',
} as const;
export type ContractViolationCode = (typeof ContractViolationCode)[keyof typeof ContractViolationCode];

/** Which part a violation concerns; never carries text of the question. */
export interface ContractViolation {
  readonly code: ContractViolationCode;
  readonly part: 'context' | 'options' | 'recommend' | 'otherwise' | 'question';
}

/** As read, not as validated: `id` may be malformed and `consequence` empty (AC-03). */
export interface QuestionOption {
  readonly id: string;
  readonly text: string;
  readonly consequence: string;
}

/**
 * What `parseAskLines` reads. A part that was absent is `undefined` (options: empty). A part that appeared more than once
 * is listed in `repeated` and its value is the first one read, which the check never uses (AC-04).
 */
export interface StructuredQuestion {
  readonly context: string | undefined;
  readonly options: readonly QuestionOption[];
  readonly recommend: string | undefined;
  readonly otherwise: string | undefined;
  readonly repeated: readonly ('context' | 'recommend' | 'otherwise')[];
}

/** The limits of the check. `DEFAULT_QUESTION_CONTRACT`: 2, 5, 6000; the part limit is the AC-55 constant. */
export interface QuestionContract {
  readonly minOptions: number;
  readonly maxOptions: number;
  /** UTF-8 bytes of all parts together (AC-08). */
  readonly maxQuestionBytes: number;
}

export const DEFAULT_QUESTION_CONTRACT: QuestionContract;

/** What the engine counts. */
export interface AskLines {
  readonly question: StructuredQuestion;
  /** `ASK ` lines read as one of the four forms. */
  readonly read: number;
  /** `ASK ` lines not of the four forms, or beyond the 20 read (AC-03). */
  readonly stray: number;
}

/** AC-02, AC-03: first-character lines outside code fences; BOM and `\r` handled. Pure. */
export function parseAskLines(reply: string): AskLines;

/**
 * AC-06, AC-07: pure; the result never contains text of the question. With `read === 0` the caller passes the empty
 * question and the result is exactly `[missing_all]`.
 */
export function checkQuestion(
  question: StructuredQuestion,
  contract?: QuestionContract,
): readonly ContractViolation[];

/** The part limit of a question, shared with agent-conversation AC-55 (one constant, not a copy). */
export const MAX_QUESTION_PART_LENGTH: number;
```

Semver: new exports of a package below 1.0, minor. `QuestionContract` and `StructuredQuestion` are interfaces, so fields are
added later only as optional ones. `MAX_QUESTION_PART_LENGTH` is the single home of the number that `agent-conversation`
AC-55 names; that spec's constant is replaced by this export when both are implemented.

## Additions to `agent-conversation` types (made when this spec is accepted, spec C-06)

```ts
export interface StepQuestion {
  /* ...as specified... */
  /** The parts, present when the step is held to the contract (AC-15). `text` stays the title. */
  readonly structured?: StructuredQuestion;
}

export interface AnswerOutcome {
  /* ...as specified... */
  /** The id of the chosen option (AC-16); `text` is then the option text and its consequence plus the note. */
  readonly optionId?: string;
}
```

Optional members added to interfaces, so minor. A model answerer is asked for a line `CHOICE: <id>`; any other reply is free
text. The request and answer files of the channel gain the same optional members.

## Workflow file

| Field | Where | Meaning | Default |
| :--- | :--- | :--- | :--- |
| `ask.contract` | step, role, `defaults` (the layering of `agent-conversation` AC-05) | `on` or `off` | `on` |
| `ask.max_contract_retries` | the same | integer 0 to 5: consecutive failed passes for one question; `0` means the first violation escalates | `2` |
| `ask.max_contract_retries_per_run` | the same | integer 0 to 50: all re-asks of the run | `10` |

A parse error names the field path and why, for a value that is not `on`/`off`, a count outside its range, or any of the
three on a step without `ask`. `minOptions`, `maxOptions` and `maxQuestionBytes` are not workflow fields in this version.
Introduced as new optional fields: minor (see the order of delivery above).

## Prompt sections (engine)

| Name | Content |
| :--- | :--- |
| `ASK_INSTRUCTION`, variant with contract | the question line of `agent-conversation`, the grammar of AC-02, one question per reply, write for a person who has not seen the code (C-07) |
| `ASK_INSTRUCTION`, variant without | exactly the text of `agent-conversation`; no mention of `ASK` lines (AC-09) |
| `CONTRACT_SECTION` | fixed sentences and the violation codes of the last attempt, in plain words, plus the grammar; nothing the model wrote (AC-11) |

## Span attributes

| Attribute | Value |
| :--- | :--- |
| `indaba.ask.contract_violations` | number of violations of the last checked question of the attempt |
| `indaba.ask.contract_codes` | those codes, comma separated, from the closed set |
| `indaba.ask.contract_retries` | passes used by the contract in the attempt |
| `indaba.ask.stray_lines` | `ASK` lines that were stray (AC-03, AC-05) |

New attributes: minor. None carries text of a question.

## Board record

No change. The question's board entry is the one line of `run-blackboard` (AC-18). The parts are in the request file and
the answer record of `agent-conversation`. Nothing changes in `run-blackboard` except the one fence rule it is asked to share
(spec C-09) and, if needed, a sentence about discarding the entry of a failed pass (spec C-11).

## Changes to other specs (made when this one is accepted, spec C-06)

- `agent-conversation` AC-40: the contract check sits between taking the first question and asking it.
- `agent-conversation` AC-42: a question counts once it meets the contract.
- `agent-conversation` `StepQuestion`, `AnswerOutcome`, the request and answer files: the optional members above.
- `agent-conversation` AC-55: the part limit becomes `MAX_QUESTION_PART_LENGTH`.
- `run-blackboard` AC-20 and C-04: one fence rule (spec C-09).
