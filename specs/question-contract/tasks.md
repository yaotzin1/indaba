# Tasks: Question contract

Not to be started before `specs/agent-conversation` is implemented: the question loop is where these hook in.

## `@indaba/core`

- [ ] T-01. Types of `api-surface.md` and `DEFAULT_QUESTION_CONTRACT`. Test: the closed set of codes is exactly the
  set of section 5.
- [ ] T-02. `parseAskLines`: first-character grammar, fences, ids, case (AC-02, AC-03). Tests: each rule above and the
  hostile cases (a line inside a fence, an id of 21 characters, `=>` missing, two `recommend` lines, a control character).
- [ ] T-03. `checkQuestion`: one test per code (AC-04, AC-05), plus a test that the result never contains text of the
  question, and that it is the same for the same input (purity).

## `@indaba/engine`

- [ ] T-04. Parser: `ask.contract` and `ask.max_contract_retries`, layering, parse errors (AC-06).
- [ ] T-05. The question loop: check before asking, no answerer is called on a violation (AC-07), `CONTRACT_SECTION` and the
  own counter (AC-08, AC-09), `missing_all` for a bare `BOARD question:` (AC-10). A fake runner reproduces "Q6, please
  explain" and a valid question.
- [ ] T-06. Option answers: an `id` answer reaches `ANSWERED_SECTION` as text (AC-12).
- [ ] T-07. Span attributes, with a test that no part of the question is in a span, event or log line (AC-14).

## `indaba` and documentation

- [ ] T-08. `plan` shows whether a step's questions are held to the contract.
- [ ] T-09. `docs/workflow-format.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`. Fill `review.md`.
