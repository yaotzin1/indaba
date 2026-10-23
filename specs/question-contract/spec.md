# Specification: Question contract (a question a person can answer without asking another one)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: minor (an optional field of `ask`, new optional exports, new span attributes; nothing that has been
> released changes; below 1.0). Because it changes what `ask` does by default, it must be implemented **with or before** the
> question loop of `agent-conversation`, never after it (C-08).
> **Builds on**: [`specs/agent-conversation`](../agent-conversation/spec.md) (the question loop, `ask`, the answerers and
> the record of who answered; merged to `main` as a draft in pull request 68) and
> [`specs/run-blackboard`](../run-blackboard/spec.md) (the `BOARD` line grammar the contract sits next to; also not
> implemented yet).
> **Same principle as, not used by**: the `review-gate` spec (a person is shown what they can answer in one move; a gate has its
> own request type) and the UI step that lets a person answer in a page.

---

## 1. The problem

A model that is unsure may stop and ask. Today (as `agent-conversation` specifies it) the question is one line of text,
up to 2000 characters, and nothing says what the line must contain. So the person gets "Q6: I need to understand this
better, please explain", reads it, has to ask what it means, and the run waits a round for nothing. The cost of an
agent's question is the person's attention, and a question that cannot be answered as written spends it twice.

`run-blackboard` cannot be the place to fix this: its grammar is one line per post and a malformed line is ignored on
purpose, so that a stray `BOARD` line never fails a step. A lazy question is not malformed under that grammar; it is
simply poor. The check has to live where the question is taken, on the steps that ask, and it has to be checked by
Indaba, not hoped for in a prompt.

## 2. User stories

- **US-01.** As a person who answers an agent's questions, I get, for every question, the situation in a few sentences,
  the options with what each one would cost or change, the agent's own recommendation, and what happens if I choose none,
  so that I can answer in one move.
- **US-02.** As a workflow author, I decide whether a step's questions are held to this contract, and I keep the freedom to
  turn it off for a step that I trust.
- **US-03.** As a person who is not a developer, I never see a question that makes me read code to understand it, and a
  question is sent back to the agent a bounded, stated number of times before the run stops.
- **US-04.** As a developer embedding the engine, I get the check as a pure function with fixed result codes, so that my own
  front end and my own tests use the same rule.

## 3. Acceptance criteria

Terms. A **character** is a Unicode code point. A **part** is `context`, `options`, `recommend` or `otherwise`. The
**title** is not a part: it is the one-line `BOARD question:` of `agent-conversation`, unchanged.

**The shape of a question**

- [ ] AC-01. A question under the contract has four parts: `context` (the situation, as the asker sees it), `options` (two
  to five, each with an `id`, a `text` and a `consequence`), `recommend` (the `id` of one option), and `otherwise` (what the
  asker will do if nobody answers, or what stays open).
- [ ] AC-02. The parts travel in extra lines of the same reply, each at the first character of its line: `ASK context: <text>`,
  `ASK option <id>: <text> => <consequence>`, `ASK recommend: <id>`, `ASK otherwise: <text>`. Case matters. Before the
  lines are read, a leading U+FEFF is removed and a `\r` at the end of a line is ignored. A line inside a fenced code block
  (a line that starts, after at most three spaces, with three or more backticks or tildes, up to the matching fence or, if
  none, the end of the reply), a line that does not start at its first character, and a line that does not start with
  `ASK ` are not read. A line that starts with `ASK ` and is not one of the four forms is a stray line (AC-03).
- [ ] AC-03. `parseAskLines` reads every well-formed and every malformed `ASK` line of the four forms into a
  `StructuredQuestion`, so that the check can name what is wrong; it does not drop a malformed option. For an option line
  the `<id>` is the text up to the first `:`; the text and the consequence are split at the **first** ` => `, so a later
  `=>` stays inside the consequence; with no ` => `, the consequence is empty. At most 20 `ASK` lines are read per reply
  (C-02); the rest are ignored and counted. A line that starts with `ASK ` but is not one of the four forms, or is beyond the
  20, is counted as stray. The reader and the `BOARD` reader use one fence rule (C-09).
- [ ] AC-04. A repeated `context`, `recommend` or `otherwise` line is not resolved by order: it is the violation
  `repeated_part`. Repeated option ids are the violation `duplicate_option`.
- [ ] AC-05. The `ASK` lines belong to the question whose `BOARD question:` line is the first question taken from the reply
  (`agent-conversation` AC-40), wherever they stand in the reply. The instruction tells the model to ask one question per
  reply; if it writes two, the `ASK` lines are read for the first, and the second stays an ordinary board entry. `ASK` lines
  in a reply without a question are ignored and counted (`indaba.ask.stray_lines`). The `BOARD` grammar of `run-blackboard`
  is not changed and its AC-21 still holds for every `BOARD` line: a `BOARD question:` that is valid there is still valid
  there.

**The check**

- [ ] AC-06. `checkQuestion(question, contract)` is a pure function of its arguments. It returns the violations, each a fixed
  code from the closed set of section 5 with the part it concerns, and never a message built from the question's text. An
  empty list means the question meets the contract. When no `ASK` line was read at all it returns exactly
  `missing_all` and nothing else; otherwise it never returns `missing_all`, and returns every other violation that applies.
- [ ] AC-07. The check is structural and says so: it tests that a part is present, not empty after trimming, within its
  limit, that option ids are 1 to 20 characters of `[a-z0-9_-]` and distinct, that no two options have the same text and
  that no option's consequence equals its own text (both compared trimmed and case-folded), that every option has a
  consequence, and that `recommend` names one of the options. It also bounds the whole question (AC-08). It does not judge
  whether the question is a good one, and no document, prompt or message claims that it does.
- [ ] AC-08. The limit of one part is the limit of a question in `agent-conversation` AC-55, from one constant, not a copy.
  The whole structured question, all parts together, is at most 6000 UTF-8 bytes (C-02, C-10); a larger one is the
  violation `question_too_long`. Redaction and cleaning of control characters happen first, as for board text; the check
  runs on the cleaned text, and a redaction marker counts as text.
- [ ] AC-09. A step with `ask` is held to the contract unless it says `ask: { contract: off }`. The default is on (C-01).
  With `contract: off` the question is exactly what `agent-conversation` specifies: the instruction does not mention
  `ASK` lines, the reply is not scanned for them, and nothing in this spec applies.

**A question that fails the check**

- [ ] AC-10. A reply with a `BOARD question:` that fails the check is handled like a reply with a question
  (`agent-conversation` AC-41 and C-08): its outputs are not checked, its guards do not run and no verdict is read from it
  for this pass, even if the reply also holds a complete result. It is not asked of anyone, no answerer is called, it is not
  recorded as asked, and it does not count against `max_questions` or `max_questions_per_run` (once `agent-conversation`
  counts a question only when it meets the contract, C-06). The board entry that `run-blackboard` took from that reply is
  settled `discarded` (C-11).
- [ ] AC-11. The step then runs again in the same workspace, with its normal prompt and one fixed section,
  `CONTRACT_SECTION`: the violation codes of the last attempt in plain words and the grammar of AC-02. It contains no text
  of the failed question, and no option id, recommended id or other model-written word, only fixed sentences and the codes.
  This is not a retry: `on_failure` is not involved, no step is reset and no retry or review counter moves.
- [ ] AC-12. If the re-run reply has no `BOARD question:` the model has chosen not to ask: it is an ordinary reply and flows
  on. The contract never forces a question.
- [ ] AC-13. The re-asks have two counters. `max_contract_retries` (default 2, C-02) is per question: it counts the
  consecutive passes that failed the contract for one question and resets when a question meets it. `max_contract_retries_per_run`
  (default 10, C-02) caps all re-asks of the run. When either is exceeded the step ends `ESCALATED` with a reason naming the
  limit and the codes, and the run ends `escalated`. A step that goes through `on_failure` and starts a new attempt does not
  reset the per-run counter. So the passes of one attempt are at most `max_questions × (1 + max_contract_retries)`, and the
  re-asks of a run at most `max_contract_retries_per_run`.
- [ ] AC-14. A reply that has a `BOARD question:` and no `ASK` line at all fails with `missing_all`: the case a model most
  often produces ("Q6, please explain") and the reason this spec exists.

**What the answerer and the person get**

- [ ] AC-15. A question that meets the contract reaches its answerers (`agent-conversation` AC-44) and a person as
  `StepQuestion.text` (the title, unchanged) plus a new optional member `structured` with the parts (`api-surface.md`). A
  front end shows the title, the context, the options with their consequences, the recommendation marked as the agent's and
  the `otherwise`, in this order, as data (AC-62 of that spec) and as text, never as markup. The request file written to the
  channel carries `structured`, and its size is within the channel's 8 KiB bound by AC-08.
- [ ] AC-16. An answer may name an option. A person names it by choosing it in a front end. A model answerer (panel, role,
  decider) names it with one line at the first character of its reply, `CHOICE: <id>`, where `<id>` is one of the question's
  ids; any other value is not a choice and the reply is free text. An answer that is only the text `a` is free text, not the
  choice `a`. The outcome carries `optionId` and `text`; the agent's next prompt (`ANSWERED_SECTION`) carries the option
  text, its consequence and the answerer's note, not only the id.
- [ ] AC-17. The recommendation is the asker's. It is displayed as such and is never applied by Indaba on its own account.
  What to do when nobody answers a question belongs to `agent-conversation`; a review gate has its own request and its own advice
  (`review-gate`), and does not use this recommendation.

**Record**

- [ ] AC-18. The question's board entry stays what `run-blackboard` defines (one line, the title); this spec adds no member
  to `BoardEntry` and the board format does not change. The parts live in the request file of the channel and in the
  answer's record of `agent-conversation`, not on the board. The answer recorded on the board is the option's text with its
  id (cut at the board's limit), and the person's note if there is one.
- [ ] AC-19. Per step attempt, the span carries `indaba.ask.contract_violations` (the number of violations of the last
  checked question), `indaba.ask.contract_codes` (those codes, comma separated), `indaba.ask.contract_retries` (the passes
  used) and `indaba.ask.stray_lines`. No part of a question is in a span, an event or a log line.

## 4. Non-goals

- Judging the quality of a question. The check is structural (AC-07); a model can fill the parts with filler, and this
  spec makes a lazy question rarer, not good.
- The evidence shown to a person who reviews a step (changed files, guard results, a summary computed by the engine). That is
  a property of a review request and belongs to `review-gate`.
- Who answers, when nobody answers, and what a timeout does. That is `agent-conversation` and `review-gate`.
- A form or a page for answering. The structure of AC-15 is what a front end renders; the page is a UI step.
- A contract for the answers, notes or messages of a person.
- Changing the `BOARD` grammar, the board format, or the ignoring of malformed `BOARD` lines in `run-blackboard`.
- Configuring the number of options per workflow: `minOptions` and `maxOptions` are constants of the embedding API in this
  version (C-02).

## 5. Behaviour on failure

Violation codes (the closed set of AC-06): `missing_all`, `missing_context`, `too_few_options`, `too_many_options`,
`duplicate_option`, `bad_option_id`, `option_without_consequence`, `missing_recommend`, `recommend_not_an_option`,
`missing_otherwise`, `repeated_part`, `part_too_long`, `question_too_long`.

| Situation | Expected behaviour |
| :--- | :--- |
| a question with `BOARD question:` and no `ASK` line | `missing_all`; the step runs again with `CONTRACT_SECTION` (AC-11) |
| a question with a part missing, repeated or over its limit | the matching code; the same re-run |
| an option with an id of 21 characters, or with no ` => ` | `bad_option_id`, `option_without_consequence`; the line is kept so that the code can be named |
| the reply also holds a complete result and a passing verdict | not read for this pass (AC-10); the step re-runs |
| the re-run has no `BOARD question:` | an ordinary reply (AC-12) |
| the contract fails more than the per-question or per-run limit | the step is `ESCALATED`, the reason names the limit and the codes (AC-13) |
| a reply with `ASK` lines and no question | the lines are ignored and counted (AC-05) |
| two questions in one reply | the first is checked; the second stays a board entry (AC-05) |
| more than 20 `ASK` lines | the rest are ignored and counted stray (AC-03) |
| `ask: { contract: off }` | no check, no instruction, no scan (AC-09) |
| the run is cancelled while a corrected question is awaited | as for any step: the run ends cancelled and nothing is persisted |

## 6. Security and data handling

The reply is untrusted. The `ASK` lines are read under a first-character grammar with fixed limits (20 lines, the part
limit, 6000 bytes in all), cleaned and redacted on the way in as board text is, and shown as text. `CONTRACT_SECTION`
contains only fixed sentences and violation codes: nothing the model wrote is echoed back, so a hostile question cannot steer
the model that is asked to correct it, and the wording of a code can never be extended to quote an id (AC-11). An option `id`
is a closed character set and is only matched against the options of the same question; it is never a step name, a path or
an action. A repeated part is a violation and not a choice by order, so the person is never shown something other than what
the check saw (AC-04). No part of a question is in a span, event or log line (AC-19). Both counters of AC-13 bound the loop.

## 7. Where it lives

`@indaba/core`: the types `QuestionContract`, `StructuredQuestion`, `ContractViolation` and the pure functions
`parseAskLines` and `checkQuestion` (no `node:` import, no clock, no I/O). `@indaba/engine`: the question loop of
`agent-conversation` calls them, adds `CONTRACT_SECTION` and the counters, reads `CHOICE:` from a model answerer, and
records the span attributes. The workflow parser accepts `ask.contract`, `ask.max_contract_retries` and
`ask.max_contract_retries_per_run`. Front ends render the structure; they decide nothing.

## 8. Clarifications

- **C-01. Why the default is on.** `agent-conversation` says that who decides is always the user's decision. Whether a
  question must be answerable is a property of the question, and the harm of a vague one (a wasted round of a person) is
  larger than the cost of one extra pass. The default is Indaba's, the choice is the author's (`contract: off`).
- **C-02. Numbers that are guesses.** Two to five options, 20 `ASK` lines, 6000 bytes, two re-asks per question, ten per
  run and the 20-character id are design choices that are not measured. They are named here and in `api-surface.md` and are
  to be revised when real runs exist.
- **C-03. Why not a guard.** A guard receives the working directory after the step and never the reply, and a question ends
  the pass before guards run (`agent-conversation` AC-41). The check therefore runs where the question is taken.
- **C-04. Why not in the `BOARD` grammar.** One line per post and silent ignoring are the right properties for a board that
  must never fail a step. The `ASK` lines are a separate, owned grammar that is read only on steps that are held to it.
- **C-05. Why the re-ask is not a retry.** A retry resets steps and carries the failure of a step. A contract violation is
  closer to an invalid reply: nothing the step did is wrong except how it asked. It has its own bounded counters so that a
  model that cannot meet the contract ends escalated and cannot loop; the number of calls is stated in AC-13.
- **C-06. What `agent-conversation` must say once this lands.** Its AC-40 names the contract check as the step between
  taking the first question and asking it; its AC-42 counts a question once it meets the contract; its `StepQuestion` gains
  `structured` and its `AnswerOutcome` gains `optionId`; its section 6 reads "every file is bounded (8 KiB)" as including the
  request files the engine writes, which AC-08 respects. These are small changes made when this spec is accepted. Until
  then this spec says "once" and changes nothing there.
- **C-07. A person who is not a developer.** The fixed instruction that asks a model to write the parts tells it to write
  for a person who has not seen the code and to ask one question per reply. That is prompt text and cannot be checked; it is
  stated here so that it is not mistaken for something the check enforces.
- **C-08. Order of delivery.** `ask: true` parses to an empty map in `agent-conversation`, so an `ask` step with the contract
  on is held to it. Were this implemented after the question loop was released, every released `ask: true` workflow would
  start escalating after two re-asks, which is a changed default and a major. The two are therefore delivered together or
  this one first; the question loop is never released without the check. The instruction exists in two variants (with and
  without the `ASK` grammar), chosen by `contract` (AC-09).
- **C-09. One fence rule.** `run-blackboard` AC-20 excludes lines inside a fenced code block but does not define a fence. The
  rule of AC-02 is proposed there too, so that a `BOARD question:` and its `ASK` lines are never judged by two scanners.
- **C-10. Bytes and characters.** Parts are limited in characters (as `agent-conversation` AC-55) and the whole in UTF-8
  bytes, because the channel limit of 8 KiB is a size in bytes. 6000 bytes leaves room for the JSON envelope of a request
  file; it is a guess (C-02).
- **C-11. The board entry of a failed question.** `run-blackboard` scans each reply once and settles its entries when the step
  attempt is settled. A question that failed the contract must not reach a later step's digest as a question that was asked,
  so its entry is settled `discarded`. Whether AC-04 of that spec allows discarding an entry of a pass that was re-run is
  to be confirmed when the two are implemented; if not, `run-blackboard` gains one sentence.

## Artifacts not written

- `plan.md`: the work is one pure function and one hook in a loop that `agent-conversation` plans; `tasks.md` is the order of work.
- `research.md`: nothing was measured (C-02 lists the guesses).
- `data-model.md`: no stored format of its own; the parts live in the request file and the answer record of `agent-conversation`.
- `events.md`: no event is added; the span attributes are listed in `api-surface.md`.
