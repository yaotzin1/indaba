# Tasks: Question contract

Delivered **with or before** the question loop of `agent-conversation`, never after it has been released (spec C-08).
Needs `run-blackboard` (the `BOARD` reader) and the question loop to hook into; neither exists yet.

## `@indaba/core`

- [ ] T-01. Types of `api-surface.md`, `DEFAULT_QUESTION_CONTRACT` and `MAX_QUESTION_PART_LENGTH`. Test: the closed set of
  codes is exactly the set of spec section 5.
- [ ] T-02. `parseAskLines`: first-character grammar, BOM, `\r`, fences (one rule shared with the `BOARD` reader, spec C-09),
  the first ` => `, ids, malformed options kept, the 20-line cap, counts `read` and `stray` (AC-02 to AC-05). Tests: each rule
  and the hostile cases (a line inside a fence and an unclosed fence, an id of 21 characters, `=>` missing and `=>` twice,
  a repeated `recommend`, a control character, a 30-line reply, two questions).
- [ ] T-03. `checkQuestion`: one test per code, including `bad_option_id`, `option_without_consequence` and `repeated_part`,
  which only exist because malformed lines are kept (AC-06, AC-07, AC-08); `missing_all` is exclusive; the result never
  contains text of the question; the same input gives the same result (purity).

## `@indaba/engine`

- [ ] T-04. Parser: `ask.contract`, `ask.max_contract_retries`, `ask.max_contract_retries_per_run`, layering, ranges and
  parse errors (AC-09, AC-13).
- [ ] T-05. The question loop: check before asking, no answerer called on a violation, the verdict and outputs not read
  (AC-10), `CONTRACT_SECTION` with no model-written word (AC-11), the re-run reply without a question flows on (AC-12),
  both counters and the bound `max_questions x (1 + max_contract_retries)` (AC-13), `missing_all` for a bare
  `BOARD question:` (AC-14). A fake runner reproduces "Q6, please explain", a valid question, a question that never
  becomes valid, and a reply that holds a valid result plus a lazy question.
- [ ] T-06. The two variants of `ASK_INSTRUCTION`; with `contract: off` no `ASK` line is scanned (AC-09).
- [ ] T-07. `structured` in the request file within 8 KiB, and `CHOICE: <id>` / `optionId` in the answers; a free-text `a` is
  not the choice `a` (AC-15, AC-16). The `ANSWERED_SECTION` carries option text and consequence.
- [ ] T-08. The board: the failed question's entry is `discarded`; no member is added to `BoardEntry` (AC-10, AC-18; spec C-11
  decides whether `run-blackboard` needs a sentence).
- [ ] T-09. Span attributes, with a test that no part of the question is in a span, event or log line (AC-19).

## `indaba` and documentation

- [ ] T-10. `plan` shows whether a step's questions are held to the contract.
- [ ] T-11. `docs/workflow-format.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`; the one-sentence changes to
  `agent-conversation` and `run-blackboard` listed in `api-surface.md`. Fill `review.md`.
