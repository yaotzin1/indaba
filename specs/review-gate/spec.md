# Specification: Review gate (a point where a person, a panel or a role decides, and the author chooses which)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: minor (optional members of `review`, a new optional `defaults.review`, new optional exports, new span
> attributes; nothing that has been released changes; below 1.0)
> **Builds on**: [`specs/step-verdicts`](../step-verdicts/spec.md) (the `review` field, the send-back, the bounded loop),
> [`specs/agent-conversation`](../agent-conversation/spec.md) (the answerers, the modes, the decider, the channel and the
> record of who answered) and [`specs/question-contract`](../question-contract/spec.md) (the structured request). None of the
> three is implemented yet, and this one is implemented after them.
> **Not part of it**: waiting across a restart, the notification that a run is waiting, restoring a workspace on send-back,
> and the permission level of an agent. They are separate specs (section 4).

---

## 1. The problem

Whether an agent's work may go on is a decision, and who takes it is the author's choice, not Indaba's. Authors want
anything from none ("I run the whole flow and accept the risk") through "two other agents argue it out, and I do not take
part" and "ask me only when the agent has a doubt" to "I look at every stage". Today `step-verdicts` lets only the
reviewing agent's own reply decide, and `agent-conversation` lets a person or a panel answer only an agent's *question*.
Nothing lets the author put a **gate** after any step, say who answers it, say what happens when nobody does, and send the
run back to an earlier step, such as the architect, with a note.

A gate is the control point the post that started this work asks for: the harness, not the agent's good manners, decides
where a human or another agent looks, at the stages where the agent may have misunderstood.

## 2. User stories

- **US-01.** As a workflow author, I put a gate after a step, or after every step, and say who answers it: a person, a panel
  of agents with no person, a named role such as the architect, or a list of those in order.
- **US-02.** As a workflow author, I say when a gate stops the run: always, only when the agent reports a doubt, or when the
  step changed files I name.
- **US-03.** As a workflow author, I say what happens when nobody answers (no person at the keyboard, a timeout): the run
  stops, the work is approved, it is sent back, or the recommendation of the panel is used. Indaba's own default is that the
  run stops.
- **US-04.** As a person who answers a gate, I see what the step produced from facts Indaba computed, not only from the
  agent's own account, and I choose among labelled outcomes whose consequences are written down: continue, change this step,
  or go back to the step named for it.
- **US-05.** As a person who is not a developer, I am never asked to read a diff to understand what I approve.
- **US-06.** As a reader of the record, I can tell, for every gate, who answered, by what rule, and whether Indaba's own policy
  decided in nobody's place.

## 3. Acceptance criteria

Terms. A **gate** is a `review` that has a `by`. A **label** is one of the closed set of outcomes of a gate (AC-06). A
**source** is who gave the answer: `person`, `panel`, a role, a fresh instance, a decider, or `policy`.

**Where a gate is, and what it adds to `review`**

- [ ] AC-01. `review` (`step-verdicts` AC-01) gains these optional members: `by`, `offer`, `panel`, `panel_rounds`,
  `decision`, `when`, `send_back`, `if_nobody`, `timeout_seconds` and `workspace`. A `review` with no `by` is exactly what
  `step-verdicts` specifies (the step's own reply, `AGREEMENT:` or `CRITIQUE:`) and none of the other new members may appear
  with it (parse error naming the field path and why). A `review` with a `by` is a gate.
- [ ] AC-02. A gate is allowed on **any** step, including a `shell` step and a debate step. `step-verdicts` AC-02 forbids
  `review` on those because the verdict is read from the step's own reply, which they do not have; a gate does not read it.
  The step's own reply is not read for a verdict on a gate.
- [ ] AC-03. `defaults.review` is a `review` map applied to every step that does not say `review: none` and does not set
  its own `review`. It is a template: its `send_back_to`, `send_back` and `max_iterations` are resolved per step (AC-08).
  `plan` shows, per step, the gate in force or `none`, so that "a gate after every step" is visible and its cost
  (`gates x iterations`) is stated.
- [ ] AC-04. A gate runs after the step's outputs exist and its guards pass (`step-verdicts` AC-06, §5.2), and before the
  step is `COMPLETED`. While it waits the step stays `VALIDATING`; no status is added. A step whose outputs are missing or
  whose guard fails is a normal failure and its gate does not run.

**Who answers**

- [ ] AC-05. `by` is `person` or a list of answerers in the kinds of `agent-conversation` AC-44 (`panel`, `role:<name>`,
  `fresh:<name>`, a plugin kind), never both. `person` asks the person (attended; `offer` is the list the person may
  delegate to, as `answerers` is in AC-06 of that spec). A list is walked in order (its AC-46) until one gives a label; a
  kind that passes or is unavailable moves on, and the reason is recorded. `panel`, `panel_rounds` and `decision` are as
  `ask.panel`, `ask.panel_rounds` and `ask.decision` (its AC-49). A decider whose authority includes `reviews` applies to the
  gate and answers it, and no person is asked (its AC-09); that authority exists in this spec (C-06). The answerers of a
  gate are read-only (its AC-53).

**What the answer is**

- [ ] AC-06. The labels of a gate are a closed set, written in the file: `approve` (continue), `revise` (run this step
  again with the note), `back` (run `send_back_to` again), `stop` (the step ends `ESCALATED`), and one label for each key of
  `send_back` (`send_back: { design: architect }`: the label `design` runs `architect` again). The target of `back` and of
  every `send_back` label is the step itself or one of its ancestors (the rule of `on_failure.target`), validated at parse
  time. A label that is not in the set is not an outcome. `back` and the `send_back` labels are present only if declared.
- [ ] AC-07. The answerer picks a label and may add a note. A person picks it in a front end. A model answerer replies with
  one line at the first character, `VERDICT: <label>`, where `<label>` is one of the gate's labels; the note is the text from
  the line after it to the end of the reply, cut to 4000 characters and redacted as failure feedback is. Any other reply, a
  second `VERDICT:` line, or a label outside the set, is `pass` (the next answerer), never an outcome. A reply never names a
  step, an action, a number or a path: the label is an indirection to the file, so `step-verdicts` AC-05 holds in its letter
  and its purpose (C-05).
- [ ] AC-08. When a gate does not name a target, the default for `back` is the step's single direct predecessor. A step with
  zero or several predecessors and no explicit `send_back_to` has no `back` label (AC-06); a `defaults.review` is resolved
  per step this way, and a template that names `send_back_to` for a step that cannot take it is a parse error naming the step.
  Nothing is chosen silently.
- [ ] AC-09. The loop is bounded as in `step-verdicts` AC-08: one counter per gate, never reset in the run, counting every
  run-again (`revise`, `back` and every `send_back` label alike), with `max_iterations` from 1 to 10 (default 3, C-02). When
  it is exhausted the step ends `ESCALATED` and the run `escalated`, with a reason naming the step and the limit.
  `plan` prints the bound.

**When a gate stops the run**

- [ ] AC-10. `when` is one trigger or a list of triggers, any of which arms the gate: `always` (the default), `doubt`, or
  `{ paths: [<glob>, ...] }`. An armed gate waits for its answer. A gate that is not armed lets the step complete, records
  `skipped: not armed` on the board and costs nothing.
- [ ] AC-11. `doubt` is armed by the step's own reply: a line at the first character, `DOUBT: <reason>`. The reason is shown
  to the answerer as the agent's. Because the agent then decides whether anyone looks, `doubt` is **never the default**, and
  `plan` and the record state in plain words that "this gate looks only when the agent says it has a doubt". The author who
  wants a deterministic trigger writes `paths`.
- [ ] AC-12. `paths` is armed when the step changed, per its workspace's change list (`workspace-without-git`, or the
  worktree diff), a file that matches one of the globs. With no tracked workspace the trigger cannot be evaluated and the
  gate is armed (fail towards looking), recorded as such.

**What the answerer is shown**

- [ ] AC-13. A gate's request is built by the engine, not by the agent, as a `StructuredQuestion` of kind `review`
  (`question-contract`): the **evidence** is the context, the labels are the options, each with a consequence that the
  engine writes from the file ("run `architect` and every step after it again", "continue to `deploy`"), and there is no
  recommendation unless a panel or role produced one (AC-17). The `question-contract` check holds for the request by
  construction and is not re-run (C-07).
- [ ] AC-14. The evidence is computed by the engine and has four parts, each bounded: the step and its attempt; the declared
  outputs, as paths; the changed files, as a list of at most 50 paths with their status and a count of the rest (not a
  diff; a diff is offered on request); and the guards that passed, by name. The agent's own account, if any (a
  `BOARD result:` of the step, cut at 2000 characters), is added last and labelled "the agent says". Everything is text,
  fenced as data for a model answerer (`agent-conversation` AC-62) and never markup for a person.

**When nobody answers**

- [ ] AC-15. `if_nobody` says what happens when no answer arrives: no person can be reached, the list is exhausted, or the
  timeout elapsed. Its values are `fail` (the default: the step ends `ESCALATED`), `reject` (the `back` label, or `revise` if
  `back` is not present), `approve`, and `recommendation`. It is the author's choice, per gate, and Indaba applies it only
  when the author wrote it.
- [ ] AC-16. `timeout_seconds` (an integer from 1 to 604800) is optional. Without it a person never times out and
  `agent-conversation` AC-06 and AC-15 hold as written. With it, when the time passes the gate behaves as if nobody answered
  (AC-15). The timer uses the injected clock and is cancelled with the run.
- [ ] AC-17. `recommendation` applies the label that a panel, a role or a fresh instance in `by` or `offer` produced, not the
  step's own agent: it is a parse error when the gate has no such source, and at run time, when no such source produced a
  label, the gate behaves as `fail`. It is never available to apply the verdict of the agent whose work is under review (C-04).
- [ ] AC-18. An outcome that Indaba's policy produced (`approve`, `reject` or `recommendation` through `if_nobody`) is
  recorded as `answered_by: policy` and `decided_by: policy:<gate>`, with the rule and, for `recommendation`, the source that
  produced the label. It is never recorded as `person` or as a role, it is visible in the dashboard and the trace, and
  `plan` states, for every gate whose `if_nobody` is not `fail`, "if nobody answers, this gate will <approve | send back>".

**The record**

- [ ] AC-19. Every gate decision is recorded on the board (`run-blackboard`) with the gate, the label, the source, the mode in
  force, the iteration, the time and the note's place, as `agent-conversation` AC-14 does for an answer. A skipped gate
  (AC-10) is recorded as skipped. Nothing is recorded only on a screen, and a model's or policy's decision is never written
  to the decision ledger as a human ruling (`agent-conversation` AC-18).
- [ ] AC-20. The step's span carries `indaba.gate.label`, `indaba.gate.source`, `indaba.gate.iteration`,
  `indaba.gate.max_iterations`, `indaba.gate.when` and `indaba.gate.if_nobody`. No note, reason or evidence text is in a span,
  an event or a log line.

**Send-back, the feedback and the workspace**

- [ ] AC-21. A label that runs a step again resets that step and every step after it exactly as `retry_step` does
  (`step-verdicts` AC-04), and `plan` lists, for each gate label, the steps that would run again, so that nobody is surprised
  that a send-back to the architect re-runs steps that were already approved.
- [ ] AC-22. A target has two feedback slots, `gate` and `failure`, each one entry, each at most 4000 characters, each replaced
  by a newer one of its own kind. The next prompt of the target carries both, labelled, in that order. Retry-loop isolation
  holds: only the last gate note and the last failure, never an earlier one. A failure of another step in the same pass can no
  longer erase a person's note (C-08).
- [ ] AC-23. `workspace` is `keep` (the default): a send-back leaves the workspace as it is, as `retry_step` does today.
  `restore` is a parse error saying, in plain words, that this version cannot restore a workspace yet. The word is reserved
  (C-09).
- [ ] AC-24. A run that is cancelled while a gate waits is cancelled whatever was answered, and nothing is persisted: after a
  restart the step starts again (as in `agent-conversation`, §5).

## 4. Non-goals

- Waiting across a process restart, and the notification that a run is waiting (mail, chat, webhook): `waiting-and-notify`.
  A gate waits in the running process, as `agent-conversation` does.
- Restoring a workspace on send-back: `workspace-restore`. This version accepts only `keep` (AC-23).
- The permission level of an agent (what it may do without asking): `agent-permissions`.
- A step in which a person does the work (edits files by hand) as a node of the graph. A gate approves or sends back; it is
  not a manual stage.
- Branching forward on a verdict, a `loop` node, or a send-back to a step that is not an ancestor (`step-verdicts` §4).
- Judging whether the answerer decided well, or making a gate tamper-proof (`step-verdicts` §6): a gate is as trustworthy as
  its source.
- Presets such as "no gates", "trust the agents" or "look at every stage". They are choices of a wizard or an editor over
  the fields above, not of the engine.
- A page for answering. The request of AC-13 is what a front end renders; the page is a UI step.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the gate is not armed | the step completes; `skipped: not armed` on the board (AC-10) |
| every answerer in `by` passes or is unavailable | `if_nobody` applies (AC-15) |
| attended and no person can be reached | `if_nobody` applies; `fail` ends the step `ESCALATED` as today (AC-15) |
| `timeout_seconds` elapses | `if_nobody` applies (AC-16) |
| the label is `stop` | the step ends `ESCALATED`, the run `escalated` |
| the iterations are exhausted | the step ends `ESCALATED` naming the step and the limit (AC-09) |
| `recommendation` and no panel or role produced a label | behaves as `fail` (AC-17) |
| a model answerer replies with no `VERDICT:` line, two, or an unknown label | `pass` to the next answerer (AC-07) |
| the answerer's call fails or a budget stops it | the answerer is `unavailable`; the list moves on |
| `paths` and no tracked workspace | the gate is armed and the record says why (AC-12) |
| the step is a debate and ended without agreement | as today (its arbiter); a gate on it runs only if the step completes |
| the run is cancelled while the gate waits | cancelled; nothing is persisted (AC-24) |

## 6. Security and data handling

- A gate gives a model **no more power** than a verdict gives: its answer is one label from a set written in the file, plus
  a note that goes into another agent's prompt through the channel `on_failure` already uses, redacted the same way. It
  cannot choose a step, raise a limit or reach a path, a shell or a URL (AC-07).
- The **evidence** is computed by the engine and is the only thing that is not the agent's word (AC-14). The agent's own
  account is labelled as the agent's.
- Self-approval is the main risk of automation. `recommendation` never applies the label of the agent under review (AC-17),
  and `approve` through `if_nobody` is recorded as policy and shown in `plan`, so the author's choice is visible and cannot be
  mistaken for a person's approval (AC-18). A workflow whose approval unlocks something sensitive must put a guard or a person
  in `by`.
- The `doubt` trigger is under the agent's control; the spec says so (AC-11).
- The answers of a person arrive through the channel of `agent-conversation`, which does not authenticate who wrote a file
  there. A gate that approves a risky step on such a file is only as strong as that channel; the documentation says so.
- Answerers are read-only and metered (`agent-conversation` AC-53, AC-56). With `isolation: none` a CLI answerer cannot be
  prevented from editing the project folder; that limit is `agent-conversation` C-13 and applies here unchanged.
- No note, reason or evidence text is in a span, event or log line (AC-20).

## 7. Where it lives

- `@indaba/core` (pure): `GateDefinition` (the new members of `ReviewDefinition`), `GateLabel`, `GateDecision`,
  `GateEvidence`, `AnsweredBy` gains `policy`, `parseVerdictLine`, `resolveGate` (the labels and their targets for a step),
  `applyIfNobody`, and the attribute names.
- `@indaba/engine`: parser and validator; `GateRunner` (arming, evidence, the question through the machinery of
  `agent-conversation`, the label, the policy); `WorkflowEngine` (routes the label, the two feedback slots, the counter);
  `PromptBuilder` (the two slots).
- `indaba` (CLI): `plan` output, and the answer prompt and commands of `agent-conversation`, which already exist for a
  question.
- `@indaba/runners`: nothing.

## 8. Clarifications

All of these are **recommended; the maintainer confirms**.

- **C-01. Why a gate is an attribute, not a node.** A node would double the file and the trace structure for "a gate after
  every step", and a second way to write a loop is what `step-verdicts` C-01 refuses. `defaults.review` answers "every step"
  in four lines. The structure record (`indaba.workflow.structure`) gains one optional key per step so that a front end can
  draw the gate and its labels before the run starts.
- **C-02. Numbers that are guesses.** 50 listed changed files, 4000 characters of note, 604800 seconds, 3 iterations by
  default and 2000 characters of the agent's account are design choices that are not measured; they are named here and in
  `api-surface.md` and revised when real runs exist.
- **C-03. Why the vocabulary of `agent-conversation`.** `by` is the list of answerers and `person` is attended; a decider with
  `reviews` authority applies. One vocabulary means the author learns it once and a plugin answerer works for questions and
  gates alike. What is new is the label, the evidence, `when`, and `if_nobody`.
- **C-04. Why `recommendation` excludes the agent under review.** An agent that approves its own work is no gate, and a
  prompt-injected reply would approve whatever it likes. `step-verdicts` §6 already says one agent's word is not a basis for
  anything sensitive. A recommendation from a separate source is a second opinion that the author chose to trust when nobody
  is there.
- **C-05. Labels, not two verdicts.** `step-verdicts` C-05 chose two verdicts so that a model never picks a target. A label
  keeps that: it is a name the author wrote, mapped to a target the author wrote, from a closed set; the model chooses among
  names. The cost is that three outcomes (continue, change this, go back) exist now, and C-05 of that spec is amended to say
  "a closed set of labels written in the file; without a `by`, still two".
- **C-06. The `reviews` authority.** `agent-conversation` AC-08 rejects `decides: [reviews]` today and names it a follow-up.
  This spec makes it live: a decider with that authority answers a gate (AC-05). `agent-conversation` AC-08 and C-24 gain
  `reviews` when this is accepted.
- **C-07. Why the request skips the contract check.** The contract protects a person from a model's lazy question. A gate's
  request is built by the engine from facts and from the labels in the file, so it has no model-written part to check. For this
  kind `recommend` is optional in `question-contract`, which gains one sentence for it.
- **C-08. Two feedback slots.** The engine has one slot per target and the later write wins. A person's note on the architect
  would be erased by a failure of a later step that also rewinds to the architect, which is the case this feature creates.
  Two slots of one entry each keep retry-loop isolation and lose nothing a person wrote.
- **C-09. `workspace: restore` is reserved.** Restoring needs a snapshot per step, a method on the workspace interface and a
  decision for copy workspaces, which store hashes and not content. It is its own spec; the word is rejected now so that a
  workflow cannot rely on it.
- **C-10. Not the default.** Indaba ships no gate. A workflow without `review` runs as it does today
  (`agent-conversation` AC-01). Whether to look, where and how often is the author's decision, and Indaba states what each
  choice means (AC-03, AC-11, AC-18); it does not recommend one.
- **C-11. Cost.** A gate after every step multiplies the answers a person gives. `plan` states `gates x iterations` and the
  bound of calls for model answerers, and the budget rules of `step-budgets` meter every answerer call.
- **C-12. Changes to other specs** are listed in `api-surface.md` and made when this one is accepted.

## Artifacts not written

- `plan.md`: `tasks.md` is the order of work and the hooks are those of `agent-conversation` and `step-verdicts`.
- `research.md`: the alternatives are weighed in C-01 to C-09 and in the review of the question contract; no external fact is
  needed.
- `data-model.md`: no stored format of its own; the decisions are board entries and answer records of `agent-conversation`.
- `events.md`: the events of a gate are the question events of `agent-conversation` with the gate as the scope.
