# Specification: Review gate (a point where a person, a panel or a role decides, and the author chooses which)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: minor (optional members of `review`, a new optional `defaults.review`, new optional exports, one new
> optional member of `StepRunOptions` and of `StepOutcome`, new span attributes; nothing that has been released changes;
> below 1.0)
> **Builds on**: [`specs/step-verdicts`](../step-verdicts/spec.md) (the `review` field, the send-back, the bounded loop),
> [`specs/agent-conversation`](../agent-conversation/spec.md) (the answerer kinds, the decider, the channel, the panel, the
> record of who answered), [`specs/run-blackboard`](../run-blackboard/spec.md) (the board) and
> [`specs/workspace-without-git`](../workspace-without-git/spec.md) (the change list of a step, for the `paths` trigger).
> None of these is implemented yet; this spec is implemented after them.
> **Same principle as**: [`specs/question-contract`](../question-contract/spec.md): a person is shown what they can answer
> in one move. A gate does not use its types (C-07).
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
  of agents with no person, a named role such as the architect, or a list of those in order that ends, if I want, with me.
- **US-02.** As a workflow author, I say when a gate stops the run: always, only when the agent reports a doubt, or when the
  step changed files I name.
- **US-03.** As a workflow author, I say what happens when nobody answers (no person at the keyboard, a timeout): the run
  stops, the work is approved, it is sent back, or the advice of a separate reviewer is used. Indaba's own default is that
  the run stops.
- **US-04.** As a person who answers a gate, I see what the step produced from facts Indaba computed, not only from the
  agent's own account, and I choose among labelled outcomes whose consequences are written down: continue, change this step,
  or go back to the step named for it.
- **US-05.** As a person who is not a developer, I am shown the files that changed and what each choice does, in plain
  words, and never a diff.
- **US-06.** As a reader of the record, I can tell, for every gate, who answered, by what rule, and whether Indaba's own policy
  decided in nobody's place.

## 3. Acceptance criteria

Terms. A **gate** is a `review` that has a `by`. A **review without `by`** is the review of `step-verdicts`, unchanged. A
**label** is one of the closed set of outcomes of a gate (AC-06). A **source** is who gave the answer: `person`, `panel`, a
role, a fresh instance, a decider, or `policy`. An answerer is **silent** only when it is a person who could not be reached
or the deadline of AC-16 ended the wait. **Every other failure to answer is faulty**: a model answerer's call that failed or
was stopped by a budget, a reply that did not meet the protocol of AC-07, a model that answered `NO ANSWER`, and a panel with
no quorum on one label. The line is drawn here on purpose: what a model can be made to say is never "nobody" (AC-15).

**Where a gate is, and what it adds to `review`**

- [ ] AC-01. `review` (`step-verdicts` AC-01) gains these optional members: `by`, `offer`, `advise`, `panel`, `panel_rounds`,
  `decision`, `when`, `send_back`, `if_nobody`, `timeout_seconds` and `workspace`. A `review` with no `by` is exactly what
  `step-verdicts` specifies, including its prompt section, and none of the new members may appear with it (parse error naming
  the field path and why). `isReviewStep` of `step-verdicts` means a review without `by`; a gate gets no `## Verdict` section,
  no `AGREEMENT:`/`CRITIQUE:` protocol and no `StepOutcome.verdict` (C-10). The only prompt text a gate adds to its own step
  is `DOUBT_INSTRUCTION` (AC-11), and only when `when` includes `doubt`; any other step's prompt is byte-identical to today.
- [ ] AC-02. A gate is allowed on **any** step, including a `shell` step and a debate step. `step-verdicts` AC-02 forbids a
  review without `by` there because the verdict is read from the step's own reply, which they do not have; a gate does not
  read it. `when: doubt` on a shell step or a debate step is a parse error, because they write no reply to read a doubt from.
- [ ] AC-03. `defaults.review` is a `review` map applied to every step that does not set its own `review`, and it must have a
  `by`. A step's own `review` replaces it wholesale (as a step's `decider` replaces the default's, `agent-conversation`
  AC-08), and `review: none` turns it off for the step. A template is resolved per step: a `send_back` label whose target is a
  real step that is not the step or one of its ancestors is left out for that step (not an error), but a target that is not a
  step at all is a parse error at the template, whatever the step; `send_back_to: previous` is resolved per step (AC-08);
  `plan` shows, for each step, the gate in force and the labels it has, so that "a gate after every step" and what it can do
  are visible.
- [ ] AC-04. A gate runs after the step's outputs exist and its guards pass (`step-verdicts` AC-06, §5.2), and before the
  step is `COMPLETED`. While it waits the step stays `VALIDATING`; no status is added. A step whose outputs are missing or
  whose guard fails is a normal failure and its gate does not run. The wait is a child span of the step, so the time a
  person takes is not mistaken for the agent's.

**Who answers**

- [ ] AC-05. `by` is `person`, or a list of answerer kinds: `panel`, `role:<name>`, `fresh:<name>`, `decider`, or a kind a
  plugin registers for gates (C-11). `person` may appear only alone or as the last element of a list ("if the machines
  pass, ask me"). A list is walked in order: the first answerer that gives a label ends the walk; one that is faulty or
  passes is recorded with its reason and the walk goes on; when the walk ends with no label, AC-15 decides. `decider`
  names the step's (or the default) decider, whose authority must include `reviews`, otherwise it is a parse error saying
  so: a decider never takes a gate by being promoted, only by being named (C-06). `panel`, `panel_rounds` and `decision`
  are as `ask.panel`, `ask.panel_rounds` and `ask.decision` (`agent-conversation` AC-49). `offer` is only valid when
  `person` is in `by` and is what the person may delegate to (as `answerers` is in AC-06 of that spec): the person sees the
  label it produced and chooses *use it* or *answer myself*; when they use it, the source is `person` and the record names
  the answerer it came from. Every model answerer of a gate is read-only and metered (its AC-53 and AC-56).
- [ ] AC-06. The labels of a gate are a closed set, written in the file: `approve` (continue), `revise` (run this step again
  with the note), `stop` (the step ends `ESCALATED`), `back` if `send_back_to` is written, and one label for each key of
  `send_back` (`send_back: { design: architect }`: the label `design` runs `architect` again). The target of `back` and of every
  `send_back` label is the step itself or one of its ancestors, validated at parse time. An author's label is 1 to 20
  characters of `[a-z0-9_-]`, is not a built-in label, is not `skipped`, and is not the id of any step (so that a label never
  reads as a step name). Labels are matched case-sensitively. A label outside the set is not an outcome.
- [ ] AC-07. The answerer picks a label and may add a note. A person picks it in a front end. A model answerer replies with one
  line that starts at the first character of a line, outside a code fence, `VERDICT: <label>`, anywhere in its reply
  (narration before it is allowed), where `<label>` is one of the gate's labels; the note is the text after that line, cut to 4000
  characters and redacted as failure feedback is. A reply with no such line, with two, or with a label outside the set is faulty,
  not an outcome. A panel's label is the label named by its members' latest messages under `decision` (AC-26). A reply never names
  a step, an action, a number or a path: the label is an indirection to the file, so the purpose of `step-verdicts` AC-05 holds
  (C-05).
- [ ] AC-08. `send_back_to` is a step id, or the word `previous`, meaning the step's single direct predecessor; `previous`
  on a step without exactly one predecessor is a parse error naming the step (in a template, the label `back` is left out for
  that step, AC-03). Nothing is chosen silently: with no `send_back_to` written there is no `back` label. The same `plan` line
  states what `if_nobody: reject` does on this gate: the `back` label if there is one, otherwise `revise`.
- [ ] AC-09. The loop is bounded as in `step-verdicts` AC-08: one counter per gate, never reset in the run, counting every
  run-again (`revise`, `back` and every `send_back` label alike), with `max_iterations` from 1 to 10 (default 3, C-02). When it
  is exhausted the step ends `ESCALATED` and the run `escalated`, with a reason naming the step and the limit. `plan` prints the
  bound as AC-24 defines it.

**When a gate stops the run**

- [ ] AC-10. `when` is one trigger or a list of triggers, any of which arms the gate: `always` (the default), `doubt`, or
  `{ paths: [<glob>, ...] }`. An armed gate waits for its answer. A gate that is not armed lets the step complete, records
  `skipped: not armed` on the board and costs nothing. **After a run-again of this gate, the gate is armed whatever `when`
  says**, until it approves: a step that was sent back for a change is always looked at again, so an agent cannot get the
  work through by changing nothing or by saying nothing.
- [ ] AC-11. `doubt` is armed by the step's own reply: a line at the first character of a line, outside a code fence,
  `DOUBT: <reason>`; the first such line counts, the reason is cut to 500 characters and redacted, and it is shown to the
  answerer as the agent's. A step under a gate whose `when` includes `doubt` has `DOUBT_INSTRUCTION` added to its prompt, a
  fixed sentence that says to write that line when the agent is unsure of its own work. Because the agent then decides whether
  anyone looks, `doubt` is **never the default**, and `plan` and the record state in plain words that "this gate looks only
  when the agent says it has a doubt". An author who wants a deterministic trigger writes `paths`.
- [ ] AC-12. `paths` is armed when the step changed, since its attempt began, a file that matches one of the globs. The change
  list is that of the tracked workspace between the snapshot taken when the attempt began and its end
  (`workspace-without-git`; the engine takes the snapshot, and only for a step under a gate with `paths`); a step's changes
  from earlier steps do not count. The glob dialect is the one of the `diff_within_scope` guard. With no tracked workspace
  the trigger cannot be evaluated and the gate is armed (fail towards looking), recorded as such.

**What the answerer is shown**

- [ ] AC-13. A gate's request is built by the engine (C-07): the **evidence**, the labels each with a consequence the engine
  writes from the file ("run `architect` and every step after it again", "continue to `deploy`"), the agent's doubt if there was
  one, and the advice (AC-17) if there is one. The evidence has four parts: the step and its attempt; the declared outputs as
  paths; the changed files, at most 50 paths with their status and a count of the rest; and the guards that passed, by name.
  The agent's own account (the last `BOARD result:` of the attempt, cut at 2000 characters) is added last and labelled "the agent
  says". The names of files are chosen by the agent, so they are untrusted text: control characters and direction marks are removed
  and a path is cut at 200 characters. The request, **encoded as the channel writes it, is at most 7000 bytes** (C-02), and the
  builder fits it by cutting, in this order, the account, the doubt, the changed paths (keeping their count), and the outputs, so
  that it is always within the 8 KiB bound of a channel file. It is text, fenced as data for a model answerer
  (`agent-conversation` AC-62) and never markup for a person, and it contains no diff.
- [ ] AC-14. A front end shows the evidence in plain words (the step's name, the files that changed, what passed), then each
  label with its consequence, then the advice marked as advice. That rendering is the front end's, and the structure it renders
  is the request of AC-13, so what a person sees is the same in every front end.

**When nobody answers, and when an answerer is faulty**

- [ ] AC-15. `if_nobody` says what happens when the walk ends with no label **and nothing in it was faulty**: the only answerer
  that did not answer was a person who could not be reached, or the deadline of AC-16 ended the wait. Its values are `fail`
  (the default: the step ends `ESCALATED`), `reject` (AC-08), `approve`, and `advice` (AC-17). It is the author's choice, per
  gate, and Indaba applies it only when the author wrote it. If **any** answerer in the walk was faulty and no later one
  answered, the step ends `ESCALATED` naming the faulty answerer, whatever `if_nobody` says, unless the deadline ended the wait
  (a call aborted by the deadline is silent, not faulty). A failed, budget-stopped, evasive or malformed answerer is not nobody,
  and cannot be turned into an approval by what the agent under review writes.
- [ ] AC-16. `timeout_seconds` (an integer from 1 to 604800) is optional. Without it a person never times out and
  `agent-conversation` AC-06 and AC-15 hold as written. With it, the whole wait of the gate (the walk, the person, advice, any
  model call still running) ends when the time passes: the engine's injected `Deadline` (C-09) aborts the calls in flight,
  what they spent is counted, and the gate behaves as if nobody answered (AC-15). The timer is created when the gate starts
  waiting and is disposed when the gate has an answer, is skipped, or the run ends, so that no timer outlives the gate.
- [ ] AC-17. `advise` is an optional list of `panel`, `role:<name>` or `fresh:<name>`, none of them the step's own role (or a
  fresh instance of it: parse error). It is walked like `by`, before `by`; the first label it gives is shown to the answerer as
  advice and binds nobody; a faulty advisor is recorded and means there is no advice, not that the gate is faulty; it is
  inside the deadline. `if_nobody: advice` applies that label when the gate is silent (AC-15); `advice` with no `advise` is a
  parse error, and with no advice produced at run time the gate behaves as `fail`. The agent's own account is evidence and
  never a label.
- [ ] AC-18. An outcome that Indaba's policy produced (`reject`, `approve` or `advice` through `if_nobody`) is recorded as
  `answered_by: policy` and `decided_by: policy:<step id>`, with the rule and, for `advice`, the advisor. It is never recorded as
  `person` or as a role. `plan` states, for every gate whose `if_nobody` is not `fail`, "if nobody answers, this gate will
  <approve | send back | use the advice of ...>", and for a gate whose source can be the step's own role (a `fresh:` of it) that
  it is the same model.

**The record**

- [ ] AC-19. Every gate decision is recorded on the board (`run-blackboard`) as an engine `decision` entry with the scope
  `gate:<step id>`: the label, the source, the iteration, the time and the note's place. The entry stays `accepted` and is
  neither discarded nor superseded when the step is reset to run again (C-12). A skipped gate is recorded as skipped. Nothing is
  recorded only on a screen, and a model's or policy's decision is never written to the decision ledger as a human ruling
  (`agent-conversation` AC-18).
- [ ] AC-20. A `GateDecided` event (step, source, iteration and, for a decision, the label and the rule; or `skipped: true`) is
  dispatched for every decision, a policy decision and a skipped gate included, so that a listener and the dashboard see a
  decision that involved no question. The step's span carries `indaba.gate.label`, `indaba.gate.source`,
  `indaba.gate.iteration`, `indaba.gate.max_iterations`, `indaba.gate.when`, `indaba.gate.if_nobody` and
  `indaba.gate.wait_ms`. No note, reason or evidence text is in a span, an event, a status reason or a log line.

**Send-back, the feedback and the workspace**

- [ ] AC-21. A label that runs a step again resets that step and every step after it exactly as `retry_step` does
  (`step-verdicts` AC-04), but it is not a failed outcome: the step moves `VALIDATING` to `FAILED` with the fixed reason
  `gate: <label>` and no note, `on_failure` is not consulted, and the target's `retries` counter does not move. `plan` lists,
  for each label, the steps that would run again, so that nobody is surprised that a send-back to the architect re-runs steps
  that were already approved; every gate after the target asks again.
- [ ] AC-22. The target's next run is given two optional pieces of feedback of different kinds. The **failure** is delivered once,
  as today. The **gate note** (at most 4000 characters) is an instruction and is delivered on every execution of the target until
  the target completes, so that a retry of the target after a failure does not lose what the reviewer asked for; it is replaced by
  a newer gate note and cleared when the target completes. Retry-loop isolation holds: only the last gate note and the last failure,
  never an earlier one. The prompt carries the gate note, then the failure, each labelled as coming from the reviewer (a person's
  note under the person preamble of `agent-conversation`, a model's under the data preamble). A `revise` or `back` with no note
  carries the fixed sentence "A reviewer asked for this step to be done again." A note on `approve` or `stop` is only on the board.
- [ ] AC-23. `workspace` is `keep` (the default): a send-back leaves the workspace as it is, as `retry_step` does today.
  `restore` is a parse error saying, in plain words, that this version cannot restore a workspace yet. The word is reserved
  (C-08).
- [ ] AC-24. `plan` prints, per gate at step S, an upper bound on how many times it can be reached: once, plus the sum of the
  maxima of every loop in the workflow whose target is S or an ancestor of S, whatever its step: every gate (`max_iterations`),
  every review without `by` (`max_iterations`) and every `on_failure: retry_step` (`max_retries`). It is computed from the
  definition alone, it is not exact (a loop may never run), and it says so. The worst wait is `timeout_seconds` times that
  number when a timeout is set, and for model answerers `plan` prints the calls per reach times the bound.
- [ ] AC-25. A run that is cancelled while a gate waits is cancelled whatever was answered, and nothing is persisted: after a
  restart the step starts again (as in `agent-conversation`, §5).
- [ ] AC-26. A panel answers a gate in the form of a debate whose topic (`GATE_PANEL_TOPIC`) gives the evidence, the labels with
  their consequences and the instruction to end the final message with `VERDICT: <label>`. Under `consensus` the label is the
  one every member's latest message names; under `majority`, the one more than half name; otherwise the panel has no quorum and
  is faulty (AC-15). The panel's note is the latest message that named the label, cut at 4000.

## 4. Non-goals

- Waiting across a process restart, and the notification that a run is waiting (mail, chat, webhook): `waiting-and-notify`.
  A gate waits in the running process, as `agent-conversation` does.
- Restoring a workspace on send-back: `workspace-restore`. This version accepts only `keep` (AC-23).
- The permission level of an agent (what it may do without asking): `agent-permissions`.
- A step in which a person does the work (edits files by hand) as a node of the graph. A gate approves or sends back; it is
  not a manual stage.
- Showing a diff. A front end may add a link to the workspace; the engine's request has none (AC-13).
- Branching forward on a verdict, a `loop` node, or a send-back to a step that is not an ancestor (`step-verdicts` §4).
- Judging whether the answerer decided well, or making a gate tamper-proof (`step-verdicts` §6): a gate is as trustworthy as
  its source.
- Authenticating who writes an answer file into the channel. That is a property of `agent-conversation`'s channel (§6).
- Presets such as "no gates", "trust the agents" or "look at every stage". They are choices of a wizard or an editor over the
  fields above, not of the engine.
- A page for answering. The request of AC-13 is what a front end renders; the page is a UI step.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the gate is not armed | the step completes; `skipped: not armed` on the board (AC-10) |
| the gate has sent the step back before | armed whatever `when` says (AC-10) |
| a person cannot be reached and nothing was faulty | `if_nobody` applies; `fail` ends the step `ESCALATED` as today (AC-15) |
| `timeout_seconds` elapses | calls in flight are aborted and counted; `if_nobody` applies unless a call was faulty before (AC-15, AC-16) |
| a model answerer fails, is stopped by a budget, replies without a usable `VERDICT:` line, answers `NO ANSWER`, or a panel has no quorum | faulty; the walk goes on; if nothing later answers, the step ends `ESCALATED` naming it; `if_nobody` does not apply (AC-15) |
| the label is `stop` | the step ends `ESCALATED`, the run `escalated` |
| the iterations are exhausted | the step ends `ESCALATED` naming the step and the limit (AC-09) |
| `advice` and no advice was produced | behaves as `fail` (AC-17) |
| a faulty advisor | recorded; there is no advice (AC-17) |
| `paths` and no tracked workspace | the gate is armed and the record says why (AC-12) |
| the step is a debate and ended without agreement | as today (its arbiter); a gate on it runs only if the step completes |
| the target fails after a send-back and is retried | the gate note is still in its prompt (AC-22) |
| the run is cancelled while the gate waits | cancelled; nothing is persisted (AC-25) |

## 6. Security and data handling

- A gate gives a model **no more power** than a verdict gives: its answer is one label from a set written in the file, plus a
  note that goes into another agent's prompt through the channel `on_failure` already uses, redacted the same way. It cannot
  choose a step, raise a limit or reach a path, a shell or a URL (AC-07). The note never goes into a status reason, a span or an
  event (AC-20, AC-21).
- The **evidence** is computed by the engine; the agent's own account is labelled as the agent's. File names, however, are the
  agent's choice, so they are treated as untrusted text and cleaned (AC-13); a file named like an instruction is shown as a name.
- Automation fails open when it can be made to fail. `approve` through `if_nobody` therefore applies only when nobody could be
  reached, never when an answerer failed, ran out of budget, was evasive or replied badly (AC-15), because what the agent writes
  can influence a model answerer. A gate that is sent back is armed again whatever `when` says (AC-10). Every policy outcome is
  recorded as policy and shown in `plan` (AC-18). A workflow whose approval unlocks something sensitive must put a guard or a
  person in `by`.
- The `doubt` trigger is under the agent's control; the spec says so (AC-11).
- **The channel is not authenticated, and this spec does not fix that.** Anyone who can write to `.indaba/conversation/` can
  answer a request, and the first answer wins whether it came from the terminal or a file (`agent-conversation` AC-58, §6). That
  includes a process started by the agent under review: in the project folder (`isolation: none`) and also from a worktree, which
  is not a boundary (`workspace-without-git` §6). A gate approves more than a question answers. `plan` therefore states, for every
  gate answered through the channel, "the agent's own process could answer this gate", and the documentation says that no setting in
  this version prevents it. An authenticated channel is a separate piece of work.
- Answerers are read-only and metered (`agent-conversation` AC-53, AC-56).
- No note, reason or evidence text is in a span, event, status reason or log line (AC-20).

## 7. Where it lives

- `@indaba/core` (pure): `GateDefinition`, `GateRequest`, `GateAnswer`, `GateAnswerer`, `GateEvidence`, `GateDecision`,
  `Deadline`, `AnsweredBy` gains `'policy'`, `parseVerdictLine`, `parseDoubtLine`, `panelLabelFrom`, `resolveGate`,
  `applyIfNobody`, `isArmed`, `buildGateRequest`, `gateBound`, `StepOutcome.reply`, and the attribute names.
- `@indaba/engine`: parser and validator; `GateRunner` (arming, the snapshot, evidence, the walk, the label, the policy, the
  deadline), run by `WorkflowEngine.execute` between `validate` and `COMPLETED`; `WorkflowEngine` (routes the label, the counter,
  the two kinds of feedback); `PromptBuilder` (the gate note, `DOUBT_INSTRUCTION`); the production `Deadline`.
- `indaba` (CLI): `plan` output, and the answer prompt and commands of `agent-conversation`, extended to show a gate request.
- `@indaba/tui`: the dashboard shows a gate request and its labels (AC-14) and a waiting gate in the step's row.
- `@indaba/runners`: nothing.

## 8. Clarifications

All of these are **recommended; the maintainer confirms**.

- **C-01. Why a gate is an attribute, not a node.** A node would double the file and the trace structure for "a gate after every
  step", and a second way to write a loop is what `step-verdicts` C-01 refuses. `defaults.review` answers "every step" in four
  lines. The structure record (`indaba.workflow.structure`) gains one optional key per step so that a front end can draw the
  gate and its labels before the run starts.
- **C-02. Numbers that are guesses.** 50 listed changed files, 7000 bytes of request, 200 characters of path, 4000 characters of
  note, 500 of doubt, 2000 of the agent's account, 20 characters of label, 604800 seconds and 3 iterations by default are design
  choices that are not measured; they are named here and in `api-surface.md` and revised when real runs exist.
- **C-03. Why the vocabulary of `agent-conversation`.** `by` is the list of answerer kinds, and the panel, the decider, the
  metering and the channel are the ones that already exist. What is new is the label, the evidence, `when`, `advise` and
  `if_nobody`. The author learns one vocabulary.
- **C-04. Why silent is narrow.** A person who is absent and a clock that ran out are facts about the world. A model that answers
  `NO ANSWER`, or a panel that cannot agree, is behaviour that the evidence (which holds the agent's own words and file names) can
  influence. If that counted as "nobody", the agent under review could steer a gate into `approve` by writing the right text.
  `advice` is a separate list because a walk of `by` ends at the first label, so a label from a list that ran out of answerers
  does not exist.
- **C-05. Labels, not two verdicts.** `step-verdicts` C-05 chose two verdicts so that a model never picks a target. A label keeps
  the purpose: it is a name the author wrote, mapped to a target the author wrote, from a closed set; the model chooses among
  names. The letter of AC-05 ("one of two verdicts") does not hold for a gate, and `step-verdicts` AC-05 and C-05 are amended
  to say "without a `by`, two verdicts; with one, a closed set of labels written in the file".
- **C-06. A decider takes a gate only by being named.** `agent-conversation` AC-08 rejects `decides: [reviews]` today. This spec
  makes it live in one way: `by: [decider]` names it. A decider promoted for `questions` never silently replaces an author's
  `by`. The `reviews` request and outcome types of that spec (`reviewReply`, `verdict`) belong to the review without `by`; the gate
  uses `GateRequest` and `GateAnswer`. `mode`, `--no-human` and `indaba mode set` govern questions, not gates; a gate's source is
  in the file, and `plan` states both. `agent-conversation` AC-44 and its api-surface, which say a list cannot name `decider`, are
  amended to allow it in a gate's `by`.
- **C-07. Why a gate has its own types.** The request of a gate is built by the engine from facts and from labels in the file, not
  by a model from a `BOARD question:` line. `StepQuestion` and `StructuredQuestion` do not describe it: a gate may have six labels,
  no recommendation and a context that is a list of files. The principle of the question contract is kept; the types are not shared,
  and the sentence of that spec that calls a review request "the same contract with a different kind" is corrected by this change.
- **C-08. `workspace: restore` is reserved.** Restoring needs a snapshot per step, a method on the workspace interface and a decision
  for copy workspaces, which store hashes and not content. It is its own spec; the word is rejected now so that a workflow cannot
  rely on it.
- **C-09. The timer.** `Clock` has only `now()`. A timeout needs a way to end a wait and a way to stop waiting for it, so
  `@indaba/core` gains a small `Deadline` contract (`after(ms, parent?)` returning a signal and a `dispose`) that the composition
  root provides with a real timer and a test provides with a fake. No decision logic reads a timer itself, and the abort ends model
  calls in flight as well as the wait for a person.
- **C-10. A gate is not a review step.** `isReviewStep` is true only for a review without `by`, so a gate adds no `## Verdict`
  section and a reply without `AGREEMENT:` is not a protocol failure. `step-verdicts` api-surface is amended for that.
- **C-11. Plugin answerer kinds.** `Answerer` of `agent-conversation` answers questions through `answer`. A gate answerer has a
  different method (`answerGate`) and a different outcome, so a class can implement both; the built-in kinds do. A plugin serves
  gates by registering a `GateAnswerer` for its kind through `PluginHost.registerGateAnswerer`; naming a kind that has none in a
  gate's `by` is a parse error. Like every answerer it declares its metering (`agent-conversation` AC-61).
- **C-12. The board entry of a decision.** `run-blackboard` settles an entry `discarded` when its step attempt fails and marks the
  accepted entries of a reset step `superseded`. A gate decision that sent the run back is the record of why, so it must stay.
  `run-blackboard` gains one sentence: an entry posted by the engine with the scope `gate:<step>` is `accepted` when posted and is
  exempt from both, and the scope `gate:<step>` joins its scope vocabulary.
- **C-13. Not the default.** Indaba ships no gate. A workflow without `review` runs as it does today (`agent-conversation` AC-01).
  Whether to look, where and how often is the author's decision, and Indaba states what each choice means (AC-03, AC-11, AC-18);
  it does not recommend one.
- **C-14. Cost.** A gate after every step multiplies the answers a person gives, and a send-back asks every later gate again
  (AC-21). `plan` prints the bound (AC-24) and the budget rules of `step-budgets` meter every answerer call.
- **C-15. Why the gate note outlives a failure of the target and the failure does not.** In the sequential loop the target runs
  straight after a send-back, so a gate note and a failure for the same target are never waiting together; the two kinds differ in
  lifetime, not in a collision. A failure log describes the last attempt and is replaced by the next; a reviewer's instruction is
  still true until the work is accepted.
- **C-16. Changes to other specs** are listed in `api-surface.md` and made when this one is accepted.

## Artifacts not written

- `plan.md`: `tasks.md` is the order of work and the hooks are those of `agent-conversation` and `step-verdicts`.
- `research.md`: the alternatives are weighed in C-01 to C-09 and in the reviews of the question contract; no external fact is needed.
- `data-model.md`: no stored format of its own; the decisions are board entries and answer records of `agent-conversation`.
- `events.md`: the one event, `GateDecided`, is listed in `api-surface.md`.
