# Events and telemetry contract: Agent conversation

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it.

## Events added

Dispatched through the existing `EventDispatcher`; a plugin listens to them like any other event. None carries the text of a
message, a question, an answer, an instruction or an asset.

| Event (`@indaba/core`) | Members | Dispatched when |
| :--- | :--- | :--- |
| `QuestionAsked` | `taskId`, `stepId`, `questionId`, `attempt` | a question was taken from a reply (E-01) |
| `QuestionAnswered` | `taskId`, `stepId`, `questionId`, `answeredBy`, `decidedBy?` | an answer (or a best-guess/skip) was fixed, whoever gave it |
| `ConversationMessageReceived` | `taskId`, `id`, `kind` (`say`, `ask`, `reopen`), `stepId?` | the engine accepted an inbox item |
| `ConversationMessageDelivered` | `taskId`, `id`, `stepId`, `pass` | a queued message was read by a pass of a step |
| `ChoiceChanged` | `taskId`, `scope` (`run` or a step id), `field` (`mode` or `decider`), `from`, `to`, `source` | a layer of choice changed (E-03) |

`from` and `to` are short words (`attended`, `trusted`, `architect:questions`, `none`), never free text.

## Event-stream records (`.indaba/traces/<traceId>.events.jsonl`)

One JSON line each; readers that predate them skip them.

| `type` | Members | Notes |
| :--- | :--- | :--- |
| `question_asked` | `at`, `traceId`, `stepId`, `questionId`, `attempt` | the text is on the board, not here |
| `question_answered` | `at`, `traceId`, `stepId`, `questionId`, `answeredBy`, `decidedBy?`, `mode` | |
| `message_received` | `at`, `traceId`, `id`, `kind`, `stepId?` | |
| `message_delivered` | `at`, `traceId`, `id`, `stepId`, `pass` | |
| `choice_changed` | `at`, `traceId`, `scope`, `field`, `from`, `to`, `source` | |

`RunEventWriter` gains one handler per event. The dashboard reads the board for text and these records for state.

## Spans and attributes

One child span, `ask <role>`, per answerer call, under the `step <id>` span, holding the runner's own child spans; the panel's
span has one child per participant call and per round, as a debate step's does. No span for a person's answer.

On the existing `step <id>` span:

| Attribute | Type | Value | Set when |
| :--- | :--- | :--- | :--- |
| `indaba.conversation.mode` | string | the mode in force at the start of the step: `attended`, `trusted` or `decider` | the step has `ask` or a decider |
| `indaba.conversation.answerers` | string | the kinds of the list, comma separated (`panel,role:antigravity`), kinds only | `trusted`, or `attended` with a list |
| `indaba.conversation.decider` | string | the decider's role | a decider applies |
| `indaba.conversation.decides` | string | the kinds of decision it takes, comma separated | a decider applies |
| `indaba.ask.questions` | int | questions asked in this attempt | the step has `ask` |
| `indaba.ask.extra` | int | `BOARD question:` lines beyond the first, not asked | above zero |
| `indaba.ask.answered_by` | string | the last answer's `answeredBy` | a question was answered |
| `indaba.ask.skipped` | int | questions left to the agent's best judgement | above zero |
| `indaba.ask.stopped` | string | `person`, `limit`, `exhausted` or `unanswerable` | a question ended the step |
| `indaba.ask.panel_rounds` | int | rounds the panel ran, summed over the attempt | the panel was used |
| `indaba.ask.panel_outcome` | string | `reached`, `stalled` or `max_rounds_exceeded` of the last panel | the panel was used |
| `indaba.ask.recovered` | string | the id of the recovered discussion (`step:review`) | a discussion was recovered |
| `indaba.decider.decisions` | int | decisions the decider made in this step | a decider answered |
| `indaba.conversation.messages` | int | person messages delivered to this step | above zero |
| `indaba.conversation.undelivered` | int | messages still queued when the step finished | above zero |
| `indaba.conversation.interrupts` | int | passes aborted by `--now` | above zero |

On the existing run (task) span:

| Attribute | Type | Value | Set when |
| :--- | :--- | :--- | :--- |
| `indaba.conversation.no_human` | bool | no step of the run can ask a person | at least one step has `ask` or a decider |
| `indaba.asset.count` | int | assets resolved for the run | above zero |

On the span of a step or role that uses an asset, one attribute per asset: `indaba.asset.<kind>.<name>` with the value
`<origin>:<sha256>` (origin one of `workflow`, `project_folder`, `user_folder`, `plugin`, `built_in`). The text is never recorded.

The runner spans of an answerer's call carry the usual usage and cost attributes, so `specs/step-budgets` sees them; their `source`
(for the budget report) is `panel`, `role`, `fresh`, `decider` or `explain`.

## Span events

| Event name | Attributes | When |
| :--- | :--- | :--- |
| `indaba.ask.question` | `question.id`, `stage` | a question is taken from a reply |
| `indaba.ask.answer` | `question.id`, `answered_by`, `decided_by?`, `rounds?` | a question is answered |
| `indaba.ask.pass` | `question.id`, `kind`, `reason` | an answerer passed or was unavailable (`reason` is a short fixed word set: `no_answer`, `no_agreement`, `unavailable`, `budget`, `changed_files`) |
| `indaba.conversation.message` | `id`, `kind`, `state` | a message got a receipt |

## Rules (E-02)

- **E-01.** The question is taken only from the asking step's reply, by the board's grammar; an answerer's reply is never scanned.
- **E-02.** No span attribute, span event, event or event-stream record carries the text of a message, a question, an answer, a note,
  an instruction or an asset. Ids, counts, kinds, words from a fixed set, hashes and roles only. The text is on the board (redacted
  on write) and in the channel files.
- **E-03.** Every change of choice, however it was made, is an event, an event-stream record and an engine note on the board, in that
  order, with its source and the injected clock's time. The engine does not authenticate who wrote an inbox file; the record names
  the channel (`person_command`, `person_dashboard`, `embedder`).
- **E-04.** A mode or decider that is in force changes no span a run would otherwise write, except by the attributes above, so a
  workflow without these fields has a trace byte for byte as it is today.
