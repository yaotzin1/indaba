# Specification: Question contract (a question a person can answer without asking another one)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: minor (an optional field of `ask`, new optional exports, new span attributes; nothing existing changes; below 1.0)
> **Builds on**: [`specs/agent-conversation`](../agent-conversation/spec.md) (the question loop, `ask`, the answerers and
> the record of who answered; merged to `main` as a draft in pull request 68) and
> [`specs/run-blackboard`](../run-blackboard/spec.md) (the `BOARD` line grammar the contract sits next to).
> **Used by, not part of**: the `review-gate` spec that follows (a review request is the same contract with a different
> kind) and the UI step that lets a person answer in a page.

---

## 1. The problem

A model that is unsure may stop and ask. Today (as `agent-conversation` specifies it) the question is one line of text,
up to 2000 characters, and nothing says what the line must contain. So the person gets "Q6: I need to understand this
better, please explain", reads it, has to ask what it means, and the run waits a round for nothing. The cost of an
agent's question is the person's attention, and a question that cannot be answered as written spends it twice.

`run-blackboard` cannot be the place to fix this: its grammar is one line per post and a malformed line is ignored on
purpose, so that a stray `BOARD` line never fails a step. A lazy question is not malformed under that grammar; it is
simply poor. The check has to live where the question is taken, on the steps that opt in to asking, and it has to be
checked by Indaba, not hoped for in a prompt.

## 2. User stories

- **US-01.** As a person who answers an agent's questions, I get, for every question, the situation in a few sentences,
  the options with what each one would cost or change, the agent's own recommendation, and what happens if I choose none,
  so that I can answer in one move.
- **US-02.** As a workflow author, I decide whether a step's questions are held to this contract, and I keep the freedom to
  turn it off for a step that I trust.
- **US-03.** As a person who is not a developer, I never see a question that makes me read code to understand it, or a
  question that was sent back to the agent more than twice before it reached me.
- **US-04.** As a developer embedding the engine, I get the check as a pure function with fixed result codes, so that my own
  front end and my own tests use the same rule.

## 3. Acceptance criteria

**The shape of a question**

- [ ] AC-01. A question under the contract has four parts: `context` (the situation, as the asker sees it), `options` (two
  to five, each with an `id`, a `text` and a `consequence`), `recommend` (the `id` of one option), and `otherwise` (what the
  asker will do if nobody answers, or what stays open). The `title` is not a part: it is the one-line `BOARD question:` of
  `agent-conversation`, unchanged.
- [ ] AC-02. The parts travel in extra lines of the same reply, each at the first character of its line, in this grammar and
  no other: `ASK context: <text>`, `ASK option <id>: <text> => <consequence>`, `ASK recommend: <id>`,
  `ASK otherwise: <text>`. Lines inside a fenced code block, lines that do not start at the first character and lines that
  do not match are not part of the question. Case matters. An `id` is 1 to 20 characters of `[a-z0-9_-]`.
- [ ] AC-03. The `ASK` lines belong to the question whose `BOARD question:` line is the first one of the reply
  (`agent-conversation` AC-40). `ASK` lines in a reply without a question are ignored and counted
  (`indaba.ask.stray`). The `BOARD` grammar of `run-blackboard` is not changed and its AC-21 still holds for every `BOARD`
  line: a `BOARD question:` that is valid there is still valid there.

**The check**

- [ ] AC-04. `checkQuestion(question, contract)` is a pure function of its arguments. It returns the list of violations,
  each a fixed code from a closed set (section 5) with the part it concerns, and never a message built from the question's
  text. An empty list means the question meets the contract.
- [ ] AC-05. The check is structural and says so: it tests that a part is present, not empty after trimming, within its limit
  (`agent-conversation` AC-55), that the options are distinct, that no option's consequence equals its text, and that
  `recommend` names one of the options. It does not judge whether the question is a good one, and no document, prompt or
  message claims that it does.
- [ ] AC-06. A step with `ask` is held to the contract unless it says `ask: { contract: off }`. The default is on, because the
  default of a question is that a person can answer it (C-01). With `contract: off` the question is exactly what
  `agent-conversation` specifies, and nothing here applies.

**A question that fails the check**

- [ ] AC-07. A reply whose question fails the check is not a question yet: it is not asked of anyone, it is not recorded as
  asked, it does not count against `max_questions` or `max_questions_per_run` (`agent-conversation` AC-42 counts a question
  only once it meets the contract), and no answerer is called.
- [ ] AC-08. The step then runs again in the same workspace, with its normal prompt and one fixed section,
  `CONTRACT_SECTION`, listing the violation codes of the last attempt in plain words and the grammar of AC-02. The section
  carries no text of the failed question (the next prompt carries only the last failure, in the sense of the retry-loop
  rule). This is not a retry: `on_failure` is not involved, no step is reset and no retry or review counter moves.
- [ ] AC-09. The re-asks have their own counter, `max_contract_retries` (default 2, C-02). A reply that fails the contract
  once more ends the step `ESCALATED` with a reason naming the limit and the codes, and the run ends `escalated`. The
  counter is per attempt of the step and resets when the attempt ends.
- [ ] AC-10. A reply that has a `BOARD question:` and no `ASK` line at all fails with the code `missing_all`, which names the
  case a model most often produces ("Q6, please explain") and is the reason this spec exists.

**What the answerer and the person get**

- [ ] AC-11. A question that meets the contract is passed to the answerers (`agent-conversation` AC-44) and shown to a
  person as the title, the context, the options with their consequences, the recommendation marked as the agent's, and the
  `otherwise`, in this order, as data (AC-62 of that spec) and as text, never as markup, in every front end.
- [ ] AC-12. An answer may name an option `id`. Then the answer recorded on the board is that `id`, the option's text, and the
  answerer's own note if there is one; the agent's next prompt (`ANSWERED_SECTION`) carries the option text and the note, not
  only the id. An answer that names no option is free text, as today.
- [ ] AC-13. The recommendation is the asker's. It is displayed as such and is never applied by Indaba on its own account.
  What a gate may do with it when nobody answers belongs to the `review-gate` spec, not to this one.

**Record**

- [ ] AC-14. Each violation is counted on the step's span as `indaba.ask.contract_violations` (a count) and
  `indaba.ask.contract_codes` (the codes, comma separated). No part of the question is in a span, an event or a log line.
  The board entry of a valid question records the parts under the limits of `run-blackboard` AC-29.

## 4. Non-goals

- Judging the quality of a question. The check is structural (AC-05); a model can fill the parts with filler, and this
  spec makes a lazy question rarer, not good.
- The evidence shown to a person who reviews a step (changed files, guard results, a summary computed by the engine). That is
  a property of a review request and belongs to `review-gate`.
- Who answers, when nobody answers, and what a timeout does. That is `agent-conversation` and `review-gate`.
- A form or a page for answering. The structure of AC-11 is what a front end renders; the page is a UI step.
- A contract for the answers, notes or messages of a person.
- Changing the `BOARD` grammar or the ignoring of malformed `BOARD` lines in `run-blackboard`.

## 5. Behaviour on failure

Violation codes (the closed set of AC-04): `missing_all`, `missing_context`, `too_few_options`, `too_many_options`,
`duplicate_option`, `option_without_consequence`, `bad_option_id`, `missing_recommend`, `recommend_not_an_option`,
`missing_otherwise`, `part_too_long`.

| Situation | Expected behaviour |
| :--- | :--- |
| a question with `BOARD question:` and no `ASK` line | violation `missing_all`; the step runs again with `CONTRACT_SECTION` (AC-08) |
| a question with a part missing or over its limit | the matching code; the same re-run |
| the contract fails once more than `max_contract_retries` | the step is `ESCALATED`, reason names the limit and the codes (AC-09) |
| a reply with `ASK` lines and no question | the lines are ignored and counted (AC-03) |
| two questions in one reply | the first is checked; the second stays a board entry, as in `agent-conversation` AC-40 |
| `ask: { contract: off }` | no check; nothing in this spec applies (AC-06) |
| the run is cancelled while a corrected question is awaited | as for any step: the run ends cancelled and nothing is persisted |

## 6. Security and data handling

The reply is untrusted. The `ASK` lines are read under a first-character grammar with fixed limits, redacted on the way in
(as board text is), and shown as text. `CONTRACT_SECTION` contains only fixed sentences and violation codes, so a hostile
question cannot steer the model that is asked to correct it. An option `id` is a closed character set and is only matched
against the options of the same question; it is never a step name, a path or an action. No part of a question is in a span,
event or log line (AC-14).

## 7. Where it lives

`@indaba/core`: the types `QuestionContract`, `StructuredQuestion`, `ContractViolation` and the pure functions
`parseAskLines` and `checkQuestion` (no `node:` import, no clock, no I/O). `@indaba/engine`: the question loop of
`agent-conversation` calls them, adds `CONTRACT_SECTION` and the counter, and records the span attributes. The workflow
parser accepts `ask.contract` and `ask.max_contract_retries`. Front ends render the structure; they decide nothing.

## 8. Clarifications

- **C-01. Why the default is on.** `agent-conversation` says that who decides is always the user's decision. Whether a
  question must be answerable is a property of the question, and the harm of a vague one (a wasted round of a person) is
  larger than the cost of one extra pass. The default is Indaba's, the choice is the author's (`contract: off`).
- **C-02. Numbers that are guesses.** Two to five options, two re-asks and the 20-character id are design choices that are
  not measured. They are fields or constants named in `api-surface.md`, to be revised when real runs exist.
- **C-03. Why not a guard.** A guard receives the working directory after the step and never the reply, and a question ends
  the pass before guards run (`agent-conversation` AC-41). The check therefore runs where the question is taken.
- **C-04. Why not in the `BOARD` grammar.** One line per post and silent ignoring are the right properties for a board that
  must never fail a step. The `ASK` lines are a separate, owned grammar that is read only on steps that asked to be held to
  it.
- **C-05. Why the re-ask is not a retry.** A retry resets steps and carries the failure of a step. A contract violation is
  closer to an invalid reply: nothing the step did is wrong except how it asked. It has its own bounded counter so that a
  model that cannot meet the contract ends escalated and cannot loop.
- **C-06. What `agent-conversation` must say once this lands.** Its AC-42 counts a question once it meets the contract, and
  its AC-40 names the contract check as the step between taking the first question and asking it. Both are one-sentence
  changes made when this spec is accepted; until then this spec says so and changes nothing there.
- **C-07. A person who is not a developer.** The fixed instruction that asks a model to write the parts (`ASK_INSTRUCTION`
  extended) tells it to write for a person who has not seen the code. That is prompt text and cannot be checked; it is
  stated here so that it is not mistaken for something the check enforces.

## Artifacts not written

- `plan.md`: the work is one pure function and one hook in a loop that `agent-conversation` plans; `tasks.md` is the order of work.
- `research.md`: nothing was measured (C-02 lists the guesses).
- `data-model.md`: no stored format beyond the board entry of `agent-conversation`.
- `events.md`: no event is added; the span attributes are listed in `api-surface.md`.
