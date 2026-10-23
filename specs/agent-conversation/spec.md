# Specification: Agent conversation (a run you can talk to, models that can ask, and a decider you can promote)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: minor (optional step, role and `defaults` fields, new optional exports, two new extension points,
> new event records, one new runtime directory, new commands and run options; nothing existing changes; below 1.0)
> **Builds on**: [`specs/run-blackboard`](../run-blackboard/spec.md) (the board is the record of the conversation,
> and `BOARD question:` is the line a model asks with), [`specs/agent-mesh`](../agent-mesh/spec.md) and
> [`specs/debate-arbiter`](../debate-arbiter/spec.md) (the panel is a debate), [`specs/ruling-channel`](../ruling-channel/spec.md)
> (how a front end other than a terminal talks to a run), [`specs/step-budgets`](../step-budgets/spec.md) (every
> answerer and decider is metered), [`specs/step-verdicts`](../step-verdicts/spec.md) (a second reply outcome with its own
> precedence), [`specs/debate-findings`](../debate-findings/spec.md) (the `prompt:` reference and the prompt registry),
> [`specs/acp-agent-install`](../acp-agent-install/spec.md) (how an agent is downloaded).
> **Siblings**: [`specs/step-variants`](../step-variants/spec.md) and
> [`specs/workspace-without-git`](../workspace-without-git/spec.md) are described here only where they touch this
> spec. The web view is a later mirror of the terminal dashboard and is not part of this change.
> **Named, not written here**: `specs/asset-helper` (list, add, remove, verify and create skills and prompts;
> section 8, C-27).

---

## 1. The problem

Indaba should be a conversation with the models, not a mechanism that runs alone and that a person can only watch.
Today it is the second. Four things are true in the code:

1. **The person cannot say anything to a running step.** A step's prompt is built once per call from the workflow
   file, the artifacts, the board digest and the last failure. Nothing lets the person add context, steer the work,
   or ask why something was done. The only way to change a run is to cancel it and edit the file.
2. **A model cannot ask the person anything.** The only structured exchanges with an agent are the debate
   (`QUESTION` is one of five message types, read only by the other participants) and, over ACP,
   `session/request_permission`, which the runner answers by policy and never by asking anybody. Every other method an
   agent sends is answered `METHOD_NOT_FOUND`. A question written as ordinary text lands in the reply or in a terminal
   stream, where Indaba cannot tell it from any other sentence, and the step guesses or stalls.
3. **When the person does not know, or is not there, there is nowhere to turn.** A workflow often has other roles, and
   other models are installed (an `antigravity` role, an `opencode` role, a second copy of the same agent). They could
   answer, or discuss it in rounds, or one of them could be trusted to decide. Nothing connects them to the question.
4. **A role is only a runner and a model.** There is no way to give a role a persona (an architect, a manager, an
   editor) with instructions of its own, no way to give that persona authority, and no way to reuse a persona someone
   else wrote or to make one without editing YAML.

**The principle behind the design: who decides is always the user's decision, never Indaba's.** Indaba carries out a
choice the user made. It never decides by itself to involve a human, to avoid one, which model answers, which agent is
promoted, or which skill or prompt a role uses. The user chooses, per workflow, per step and at run time, between three
ways of working: *I take part* (the person answers), *I trust the agents* (the agents answer among themselves), and *I
promote an agent to decide*. A promoted agent is not a one-off answerer: it is a standing role the user declares (an
architect, a manager, an editor: the name is the user's, and Indaba ships no list of personas) and gives authority over
named kinds of decision, and nothing beyond them. The user can change the choice while the run is going and can take any
decision back. Indaba's part is to show, in plain words, what was chosen ("Architect decides: questions. You decide: the
rest."), and to record who decided every question. With nothing chosen, the question goes to the person, exactly as a run
that waits for its owner would. A decider does not report upward by itself: a user who wants a person to confirm some kinds
of decision leaves them out of the decider's authority, and the person then decides them.

Indaba is also meant for people who are not developers, for tasks that loop until they are done. For them the useful
sentences are "tell it this", "why did you do that?", "I do not know, ask the others", "do not wait for me", "I will take
it from here", and "use the architect's style from this skill", and every one of them has to come with a plain-words
record of who said and decided what.

## 2. User stories

- **US-01.** As a person running a task, I send a message to a step at any time (new context, a correction, a
  direction) from the terminal or the dashboard, and I am told honestly when the step will read it.
- **US-02.** As a person, I ask a question about a step ("why did you delete that?") and get an answer, in plain words,
  labelled with who produced it and from what.
- **US-03.** As a person, when a model asks me a question I see it in plain words and choose: answer it, ask someone
  else (the panel, a named agent, a fresh copy of the same agent), let the agent use its best judgement, or stop.
- **US-04.** As a person who does not know the answer, I ask the panel and read one short answer with any disagreement;
  I use it, answer myself instead, or ask again with a note. I can have the panel continue an earlier discussion of this
  run so it does not start cold.
- **US-05.** As a workflow author or a person starting a run, I choose how questions are answered: *I take part*, *I
  trust the agents* (the panel, or a chain of named roles, including a fresh copy of the same agent), or *I promote an
  agent to decide*, in the workflow default, in a step, or for this run.
- **US-06.** As a workflow author, I declare a role with a persona of my own (an architect, a manager; its runner, model
  and instructions), and I promote it by giving it authority over named kinds of decision: the working agent's questions
  now, and, as the sibling specs adopt it, failed debates, review loops, the choice among variants, landing a result, and
  what to do after a budget stop. Authority I did not name, it does not have.
- **US-07.** As a person, I change the choice while the run is going: I join ("I am taking over this question, or this
  step"), step back ("I trust the agents from here"), or promote, replace or remove the decider; the change applies from
  the next question and is recorded. I can leave a kind of decision out of the decider's authority so that I decide it
  myself.
- **US-08.** As a person who walked away, I come back to a record that says, for every question, who decided it and how,
  and I can overrule an answer while the run is going.
- **US-09.** As a workflow author, no model answer is ever mistaken for a decision a person made: it is marked wherever
  it is shown or recorded, and it never enters the committed decision ledger.
- **US-10.** As the owner of a budget, every call an answerer or a decider makes is metered, and a conversation cannot
  loop without bound.
- **US-11.** As a workflow author, I give a role its persona from a skill, and a step or a debate its prompt from a
  prompt, and I get each by using one that is already in my project or my user folders, by downloading one, or by
  writing my own; Indaba never picks or swaps one for me.
- **US-12.** As a person who is not a developer, I am told in plain words when a skill or a prompt is missing, too long,
  not accepted, or changed since I accepted it.
- **US-13.** As a developer embedding the engine, or the author of a plugin, I supply another way to ask a person,
  another kind of answerer, or another source of skills and prompts, through the contracts the built-ins use.
- **US-14.** As a person with a finished run, I put a question to the roles of that run with its discussion as history,
  and read the answer (phase 2).

## 3. Acceptance criteria

Checkable statements; each becomes at least one test when implementation is scheduled. Criteria marked
**(phase 2)** are specified now and built after the rest (section 8, C-26).

**Defaults, and nothing hidden**

- [ ] AC-01. A workflow with no `ask` field, no `defaults.ask`, no `decider`, no `skill`, no `instructions`, no
  `decides` and no `asset_folders`, run by someone who sends nothing, behaves exactly as it does today: the same prompts,
  replies handled, step outcomes, exit codes, trace file, event stream and board. The additions are only the files of the
  conversation channel (AC-57) and the run's registration.
- [ ] AC-02. **No hidden autonomy.** The default of every new field preserves today's behaviour, and Indaba never asks a
  model to answer or decide anything unless the user's configuration, a run option, a live change or the person's own
  choice names it. A table-driven test builds every combination of absent and present `ask`, `defaults.ask`, `mode`,
  `answerers`, `decider`, `decides`, run options and live changes, with a scripted reply that asks a question, and asserts:
  with no choice naming a model, the question goes to the person; when no person can answer, the step ends `ESCALATED` as
  it does today; and no runner call is made for an answerer or a decider.
- [ ] AC-03. Everything that reaches a prompt, a screen or a file from the conversation (a person's message, a question,
  an answer, a note, a history) is text: cleaned of control characters, redacted with the event stream's function,
  bounded (AC-55), and shown as text and never rendered as markup in any front end.
- [ ] AC-04. Every message, question, answer and change of mode or decider is recorded on the run board
  (`specs/run-blackboard`) with who said or decided it (`person`, a role, `panel`, a fresh instance, the decider) and, for an
  answer, which question it answers and what produced it. Nothing in the conversation is recorded only on a screen.

**Who decides: the user's choice**

- [ ] AC-05. How questions are answered is a **mode**: `attended` (*I take part*; the default) or `trusted` (*I trust the
  agents*), set by `mode` in `defaults.ask` and in a step's `ask`, by a run option (AC-11) and by a live change (AC-12). The
  mode in force for a question is `decider` (*I promote an agent to decide*) when a decider whose authority includes
  `questions` applies to the step (AC-08), and otherwise the `mode`. An unknown value is a parse error naming the field
  path.
- [ ] AC-06. In `attended` mode the person is asked. The prompt offers *answer it myself*, one numbered choice for each
  answerer in `answerers` (the things the person may delegate to: the panel, a role, a fresh copy), *let the agent use its
  best judgement* and *stop here*. Nothing is asked of a model unless the person picks it. The person never times out:
  cancelling is the bound.
- [ ] AC-07. In `trusted` mode no person is asked: `answerers` (at least one, none of them `person`) is walked in order
  (AC-46) until one answers. `on_exhausted` (`stop`, the default; `best_guess`; `ask_person`) says what happens when the
  list is exhausted: `ask_person` is the user's explicit choice to ask the person at the end, and ends the step `ESCALATED`
  if nobody can be reached. A `trusted` mode with no `answerers` is a parse error naming the field path.
- [ ] AC-08. A **decider** is a role the user promotes. Roles gain three optional members: `instructions` (the role's
  persona, at most 2000 characters), `skill` (AC-24) and `decides` (the role's standing authority). A decider is named by
  `defaults.decider` and by a step's `decider`, as `<role>`, `{ role, decides?, max_decisions? }` or `none`; a step's value
  replaces the default's wholesale for that step. The authority in force is the promotion's `decides`, else the role's
  `decides`, else **empty, and an empty authority decides nothing**. The kinds are `questions`, `debates`, `reviews`,
  `variants`, `landing` and `budget`; **this version takes decisions of kind `questions` only**, and a `decides` that names
  another kind is a parse error saying, in plain words, that this version cannot send that kind to a decider yet and which
  kinds it can (C-24). A role that does not exist, or the step's own role used where a different one is required, is a
  parse error naming the field path. `validate` states as a fact a decider whose authority is empty.
- [ ] AC-09. A decider with `questions` in its authority answers every question of the steps it applies to: no person is
  asked and no list is walked; its reply is the answer, recorded as decided by that role (`decided_by`). A reply that
  starts `NO ANSWER:`, or a decider that cannot be reached, is handled by `on_exhausted`. A decider with `questions`
  outside its authority takes no question: the mode decides, so the person does (a decider never reports upward by itself,
  and Indaba never asks a person to confirm what a decider with that authority decided). A decider decides at most
  `max_decisions` times in one step (default 10) and `max_decisions_per_run` times in the run (default 50); one more ends
  the step `ESCALATED` naming the limit.
- [ ] AC-10. The layers, from weakest to strongest, are `defaults`, the step, the run options, and a live change; a field
  set in a stronger layer replaces the same field of a weaker one (`answerers` and `decider` are replaced whole). A run
  option or a live change may name a step (`<step>=<value>`) or, without one, applies to every step.
- [ ] AC-11. `indaba run` accepts `--mode [<step>=]attended|trusted` (repeatable), `--answer-with
  [<step>=]<kind>[,<kind>...]`, `--decider [<step>=]<role>[:<kind>[,<kind>...]]|none`, and the two readable forms
  `--no-human` (the same as `--mode trusted`) and `--ask-human` (the same as `--mode attended`). They change the choice for
  this run and never the workflow file. A value that names an unknown step, role or kind is a usage error naming it. A run
  option that leaves a choice incomplete (`trusted` with no `answerers` anywhere) is a usage error that says what to add.
- [ ] AC-12. The person can **change the choice while the run is going**: `indaba mode set attended|trusted
  [--answer-with ...] [--step <id>] [--run <taskId>]` (*join* and *step back*), `indaba decider set <role> [--decides
  <kind>,...] [--step <id>]` (*promote or replace*), `indaba decider remove [--step <id>]`, the same choices in the dashboard,
  or an embedder's call. `mode set` also removes `questions` from the decider's authority for that scope, so the person's
  word is taken at face value; `decider remove` removes the decider entirely. A change applies **from the next question**; a
  question already being answered finishes as it was started, unless the person takes it over (AC-13). A change for a step
  that does not exist, or to an incomplete choice, is refused in plain words and nothing changes. `indaba mode show` prints
  the current choice for each step.
- [ ] AC-13. The person can **take over the question that is open**: `indaba answer <id> --take-over` (or the dashboard)
  aborts the answerer or decider calls in flight for that question, counts what they spent, and asks the person the
  question as in `attended` mode. Taking over changes only that question; the choice stays as it is.
- [ ] AC-14. Every change of choice is recorded in the event stream (`mode_changed` or `decider_changed`: scope, from, to,
  source, time) and as an engine note on the board, and every answer records the mode in force, `answered_by`, the decider's
  role where there is one (`decided_by`), the answerer's name, the position in the list and the cost. The source of a choice
  is one of `workflow`, `step`, `run_option`, `person_command`, `person_dashboard`, `embedder`.
- [ ] AC-15. A run in `trusted` mode, or whose questions are decided by a decider, needs no person present. A run in
  `attended` mode waits for the person (no timeout) and, when no person can be reached from where the run started (no
  terminal, `--rulings none`, no channel), the question is unanswerable and the step ends `ESCALATED` as it does today.
  Indaba does not change the choice to avoid waiting.
- [ ] AC-16. **Transparency, not decision.** Before the first step, in the dashboard header for the whole run, in `indaba
  plan`, in `indaba watch --plain` and in the trace (`indaba.conversation.mode`, `indaba.conversation.answerers`,
  `indaba.conversation.decider`, `indaba.conversation.decides`), Indaba states the choice in plain words, per step when it
  differs, naming each kind of decision and who takes it: "You take part: this run asks you its questions." / "You trust
  the agents: this run answers its own questions with: the panel (antigravity, opencode), then antigravity. No person will
  be asked." / "Architect decides: questions. You decide: the rest." It may state facts ("this decider reports no cost", "no
  person can be reached from here", "the architect has no authority"). It does not warn-and-block, rank, recommend or
  override the choice; a test runs configurations that a cautious engine might refuse (an unmetered decider, a chain of one,
  `trusted` with a person nowhere in reach, a decider with empty authority) and asserts they run.
- [ ] AC-17. **Overrule.** While a run is going the person can reopen any answer a model or decider gave: `indaba answer
  <questionId> --reopen "<text>"` (or the dashboard). The correction is recorded as a new answer of the person that
  supersedes the model's, and is delivered like a message (AC-31) with the sentence "the person corrected an earlier
  answer". It is not delivered to a step that has finished; it is on the board.
- [ ] AC-18. A model's or decider's answer is never recorded as a human ruling: it is never written to the decision ledger,
  never read from it, and never settles a debate. The ledger is neither read nor written by anything in this spec.
- [ ] AC-19. A decider is an agent and is treated as one: every call it makes is metered (AC-56), its inputs are fenced
  untrusted data (AC-62), it is read-only (AC-53), its decision is text or a choice and never a command, and it is bounded
  by `max_decisions`.

**Roles with a persona: skills, instructions and prompts as assets**

- [ ] AC-20. A role may carry `skill: <name>` and `instructions: "<text>"` (either or both). A step or a debate may carry
  `prompt: <name>` (`specs/debate-findings` AC-04). The names of skills and prompts are *assets*, and both kinds are
  resolved by one contract, `AssetResolver`, from the sources of AC-21, with the same size bound, the same text-only rule and
  the same plain-words errors. A workflow with none of these fields resolves nothing.
- [ ] AC-21. An asset is looked for, by kind and name, in a **fixed precedence**; the first source that has it wins:
  (1) the workflow file itself (the top-level `prompts` map of `specs/debate-findings` AC-13, and a new top-level `skills`
  map of the same shape: a name matching `[A-Za-z0-9_-]+` to a text of at most 8,000 characters); (2) the project asset
  folders the workflow declares in `asset_folders` (a list of paths inside the project, searched in the order given);
  (3) the user's asset folders (declared in the user-level location of `specs/acp-agent-install`, searched in the order
  given), which include the folder the helper downloads into; (4) the asset sources plugins register
  (`PluginHost.registerAssetSource`), in registration order; (5) the built-in assets (`debate-review` and nothing else is
  added by this spec). `validate` and `plan` print, for each reference, which source it resolved from, and, as a fact, any
  other source that also has the name; the lower one is not used and not an error.
- [ ] AC-22. In an asset folder a skill is `skills/<name>/SKILL.md`: a first block between `---` lines with `name` (equal
  to the folder name) and `description` (one line, at most 300 characters), optional `license` (one line) and `source`
  (one line), then the skill text. A prompt is `prompts/<name>.md`, plain text with the same optional first block. This is
  Indaba's **runtime** format for a user's workflow; it looks like the `SKILL.md` files of the development workflow of this
  repository and shares nothing with them. Only that one file is read: other files in the folder are not.
- [ ] AC-23. **An asset is text.** Indaba never runs a script, command or program because an asset contains one, follows no
  link, include or path written in it, expands no `{{...}}` or `${...}`, and reads no file the asset names. The body is at
  most 8,000 characters (UTF-8, no NUL, no control characters other than newline and tab); the file is read through the
  confined path functions, a symlink or junction that leaves its folder is refused, and a source folder is never written by
  the resolver.
- [ ] AC-24. A role's persona reaches its calls as one labelled section, `ROLE_SECTION`: a fixed heading that says the text
  is the instructions of the person who set up this task for this role, then the resolved skill text, then the inline
  `instructions`, then a fixed closing line. It is added to **every** call of that role (working, panel, role, fresh, decider
  and explainer). It is the user's own text once resolved from an accepted source, so it is followed as instructions, and it
  cannot widen what the role may touch (`permissions` and the guards are unchanged by it). It is never put through
  `fenceAsData`, because it is not data from an untrusted source; text that reaches the role from the model or the
  conversation still is.
- [ ] AC-25. A skill or prompt that is missing, invalid (bad first block, `name` not equal to the folder name, over the size
  bound, not text), not accepted (AC-26) or changed since it was accepted is a **plain-words error from `validate` and
  `plan`**, naming the field path, the kind, the name and the sources searched (paths relative to the project or to the user
  folder, never absolute paths into someone's home), and the run does not start. Assets are resolved once, when the workflow
  is loaded, and their bytes are hashed; a file changed on disk during the run is not picked up, and the trace records each
  asset's name, kind, source and SHA-256 (`indaba.asset.*`, never the text).
- [ ] AC-26. **Downloaded assets are untrusted until the user accepts them.** A folder that has an asset manifest
  (`assets.lock.json`, [`data-model.md`](data-model.md)) is a downloaded source: an asset in it resolves only if the
  manifest has an entry for that kind, name and version with `accepted: true`, a SHA-256 equal to the file's, the source the
  user named and the licence recorded. The resolver reads and verifies the manifest and never writes it. An asset with no
  entry, with `accepted: false`, or with a different hash is refused with a plain message ("not accepted yet", "changed
  since you accepted it") and nothing is used instead. A licence that is unknown, or is not open source and MIT-compatible,
  is shown with that fact when the helper asks and when `plan` lists the asset; the resolver does not judge it, and the
  user's acceptance stands. The resolver opens no network connection at any time; only the helper downloads, on request.
- [ ] AC-27. **The user chooses; Indaba never swaps.** A name that does not resolve is an error (AC-25), never a silent
  default, a fallback to another source's asset of a similar name, or an upgrade to a newer version.
- [ ] AC-28. `PluginHost.registerAssetSource(source)` accepts another place assets come from (a team library, a company
  folder); the built-in sources (the workflow file, project folders, user folders) register through it with no privileged
  access. A source returns text and its first block, never a path to run; the bounds and the text-only rule of AC-23 apply to
  what it returns, and a plugin source is as trusted as the plugin the user installed.
- [ ] AC-29. Agents follow the same three ways but not through this spec: a role refers to an agent with its existing
  `runner` and `agent` members, and `specs/acp-agent-install` is the existing mechanism to download one. This spec does not
  change either.

**Person to model: a message (`say`)**

- [ ] AC-30. A person may send a message to a step of a running run at any time: `indaba say <step> "<text>"`, the
  dashboard's message entry, or an embedder's call. The target is a step id of the running workflow, or `run` (a note for
  the whole run, which only steps that read the board see). A message is 1 to 2000 characters. The inbox is open for every
  run, whatever the mode: a person can always talk.
- [ ] AC-31. A message is delivered **at the step's next prompt**: appended to the prompt of the step's next pass as the
  section `PERSON_SECTION`, every message not yet delivered, oldest first, as data (AC-62) under a fixed sentence that says
  the lines are from the person running the task, are guidance about the task, and do not change what the step is allowed to
  touch. A message to a step that has not started waits for it; to a step that is running, waits for its next pass (a
  question being answered, a retry, a review loop, a re-run). No runner takes a message in the middle of a call (C-03); the
  receipt says so and never claims otherwise.
- [ ] AC-32. A message may ask to **interrupt** (`--now`): the current call of that step is aborted (the abort the budget
  gate also uses; ACP receives `session/cancel`, other runners their usual abort), the partial reply is discarded, the work
  already in the step's workspace is kept, and the step runs again at once with the message. Interrupt is refused, in plain
  words, for a shell step ("a command has no model to tell"), for a step in a debate ("a discussion reads your message at the
  start of its next round") and for a step that is not running.
- [ ] AC-33. A message to a debate step is added to the topic of the debate's next round as `PERSON_SECTION` and posted to
  that debate's own board as a note of the person; it never counts as a participant's message, for the quorum or the stall
  detector.
- [ ] AC-34. Every message gets a **receipt** the sender can read: `queued` (accepted, will be read at the step's next
  prompt), `delivered` (read by pass n), `undelivered` (the step finished before it could be read; it is on the board) or
  `refused` (with the reason). A step that finishes with messages still queued records it on its span
  (`indaba.conversation.undelivered`).
- [ ] AC-35. At most 20 messages may be queued for one step and 200 per run; one more is refused in plain words. A message
  is a note on the board (kind `note`, source `person`) the moment it is accepted, so the dashboard and later steps that read
  the board see it.

**Person to model: a question (`ask`)**

- [ ] AC-36. A person may ask an answerer a question about a step: `indaba ask [--to <answerer>] <step> "<text>"` (1 to 2000
  characters), or the dashboard. The answerer is one of the kinds of C-06 (default: `fresh:` the step's own role). The
  answer is returned to the person and recorded on the board with `answered_by`; it does not change the step, which goes on
  as it was. This is the person's own use of an answerer, whatever the mode is.
- [ ] AC-37. The answerer is given: the question, the step's goal cut at 2000 characters, the step's last reply (the engine
  keeps the last reply of each step of the running run, at most 20,000 characters, redacted, in memory only) and the digest
  the step would get, each as data. It is not given the original agent's conversation, because Indaba keeps none between
  calls (C-04). The reply is labelled "explained by a new call of <role> from the step's last reply", never as the original
  agent speaking.
- [ ] AC-38. The answerer of an `ask` is read-only (AC-53). An `ask` to a step that has not produced a reply yet is answered
  from its goal and the board and says so.

**Model to person: a question**

- [ ] AC-39. A step may carry `ask:` (a map, or `true` for all defaults) and its effect is: the step's prompt gets one fixed
  section, `ASK_INSTRUCTION` (C-02), and its reply is looked at for a question. `ask` requires an agent step whose
  `board.post` contains `question`; on a shell step, a debate step, or without that, it is a parse error naming the field
  path and the missing part. A step without `ask` is never asked about and its questions stay ordinary board entries.
- [ ] AC-40. After a pass, the engine looks at the questions that `specs/run-blackboard` AC-20 took from the reply. The
  **first** is the question (C-05); the others stay on the board, are not asked and are counted (`indaba.ask.extra`). With
  none, nothing in this section applies.
- [ ] AC-41. A reply with a question is not finished: its outputs are not checked, its guards do not run and no verdict is
  read from it for this pass (C-08). The step stays `RUNNING` while the question is open; no status is added to
  `StepStatus`. When the question is answered the step runs again in the same workspace with its normal prompt plus
  `ANSWERED_SECTION`, every question of this attempt that has been answered with its answer, as data, and nothing else of the
  earlier passes (C-04). This is not a retry: `on_failure` is not involved, no step is reset and no retry or review counter
  moves.
- [ ] AC-42. A step may ask at most `max_questions` questions in one attempt (default 3) and the run at most
  `max_questions_per_run` (default 20). A reply that asks one more ends the step `ESCALATED` with a reason naming the limit;
  the run ends `escalated`.
- [ ] AC-43. Questions from the other structured places: a debate participant's `QUESTION` message stays what it is, read by
  the other participants in the next round, and a person's message can reach the debate (AC-33); an ACP permission request is
  answered by policy as today and is never a question (C-01). Neither is routed to an answerer or a decider by this spec.

**Answerers: the list, the panel, the single roles**

- [ ] AC-44. The kinds of answerer are written as strings: `person`; `panel`; `role:<name>` (a role other than the step's
  own); `fresh:<name>` (a fresh instance of that role's runner and model, normally the step's own); or the kind a plugin
  registers (C-12). An unknown kind, a role that does not exist, `role:` with the step's own role, a duplicate, an empty
  list, or `person` in a `trusted` list is a parse error naming the field path and, in plain words, why.
- [ ] AC-45. A person who is asked (`attended`, or `ask_person` at the end) has the choices of C-06, in plain words. A person
  who picks another answerer is shown its answer before the agent gets it.
- [ ] AC-46. The list is walked in order. An answerer answers (`answered`), or says it has no answer (`pass`), or cannot be
  reached (`unavailable`: no terminal, the runner is not installed). `pass` and `unavailable` move to the next kind with the
  reason recorded and shown. A model answerer says it has no answer with the first line `NO ANSWER: <reason>` (C-07); any
  other reply is its answer.
- [ ] AC-47. When a person delegated the question, the answer is shown with its source, any disagreement and what it cost,
  and the person chooses *use it*, *answer myself instead*, *ask again* (the same answerer, with an optional note of at most
  500 characters appended as data, at most three times per question), *ask someone else*, or *stop*. When the mode is `trusted`
  or a decider decided, the answer goes to the agent at once, and the person can reopen it (AC-17).
- [ ] AC-48. When the answerers are exhausted, `on_exhausted` decides: `stop` (the default) ends the step `ESCALATED` with a
  reason in plain words ("a question had no answer from: the panel, antigravity"); `best_guess` tells the agent, in a fixed
  sentence, that no answer is available and that it should use its best judgement and say what it assumed; `ask_person` asks
  the person (AC-07). A skipped or best-guess question is recorded as `skipped` and never as answered.
- [ ] AC-49. The **panel** is a debate (`ConsensusArbiter`, one participant per role of `ask.panel`, each with its role's own
  runner, model and `ROLE_SECTION`): at least two distinct roles that exist, none the step's own role. It runs up to
  `panel_rounds` rounds (default 3, 1 to 10) with the `ask.decision` quorum (`consensus` by default, or `majority`). Its topic
  is built by `PANEL_TOPIC` (C-09): the question, the step's goal cut at 2000 characters and the digest, each as data. A
  panel in a list or as a choice with no `ask.panel` is a parse error.
- [ ] AC-50. When the panel reaches its quorum the **answer** is the text of the latest `PROPOSAL`, cut at 2000 characters,
  and the **dissent** is the latest `CRITIQUE` (each cut at 500, at most three) of every participant whose latest message is
  not an `AGREEMENT`; a pure function of the transcript (`panelAnswerFrom`). A quorum with no `PROPOSAL`, a stall, running out
  of rounds or no majority is `pass`, with the proposals and the dissent attached for the person.
- [ ] AC-51. `role:<name>` and the decider run one call of that role's runner and model; `fresh:<name>` runs one call of that
  role's runner and model in a **new session that shares nothing with the asking agent**: not its reply, not its
  conversation, only the question, the step's goal and the digest as data. All are given `ANSWER_INSTRUCTION` (C-09) and the
  role's `ROLE_SECTION`. What "the same model" guarantees and does not is in C-10; a fresh instance's answer is labelled
  `same-model-instance`.
- [ ] AC-52. **Recover a debate.** When the person asks the panel, a second choice is offered: *start fresh* (the default),
  or *continue an earlier discussion*, listing the discussions of this run in plain words ("the review in step `review`, 3
  rounds, no agreement"). A discussion is listed when the run board holds the debate messages of a debate step of the run, or
  of an earlier panel discussion of any question of the run (scope `panel:<n>`), at most 20 listed, newest first. The new
  debate is seeded with that discussion's messages as read-only history through `ConsensusArbiter.deliberate(..., history)`:
  the history appears in the transcript the participants see, labelled as earlier discussion, and **counts for nothing**
  (never an agreement for the quorum, never in the stall detector, never in the outcome). New rounds are numbered after the
  history's last round and `panel_rounds` is a new allowance. The history is at most 30 messages and 12,000 characters, newest
  kept, shown oldest first with `[N earlier messages omitted]`. Recovering never reopens a decided step: the outcome, the
  ruling and the ledger entry of the original debate are unchanged.
- [ ] AC-53. Every model answerer, including the panel, the decider and the explainer of `ask`, is **read-only**: its role
  runs with `permissions: { fs: { write: [] }, terminal: deny }` where the runner supports permissions, its prompt forbids
  changes, and when the step has a tracked workspace its change list after the call must equal the one before; if not, the
  call fails and the step ends `ESCALATED` naming the files. `validate` states as a fact an answerer role on a runner that
  cannot be limited and a step with no tracked workspace to check.

**Limits, metering and loop safety**

- [ ] AC-54. **Models never converse without bound**: no answerer's or decider's reply is itself scanned for a question, an
  answerer cannot call another answerer, a decider cannot promote another, and a question that arrives while another is open
  waits in a queue (C-11).
- [ ] AC-55. The limits are: a question, an answer, a note and a message 2000 characters (a note 500); a role's `instructions`
  2000 and a skill or prompt body 8000; questions per attempt 1 to 5 (default 3) and per run 1 to 100 (default 20); decisions
  per step (default 10) and per run (default 50); panel asks per question 3; panel rounds 1 to 10 (default 3); messages queued 20
  per step and 200 per run; history 30 messages and 12,000 characters. They are unmeasured design choices kept in one place;
  changing one is a minor. They are enforced where the text enters (the CLI, the dashboard, the channel reader, the resolver),
  by cutting and saying so for text, and by a plain error for an asset, never by failing a run in progress.
- [ ] AC-56. Every call an answerer or a decider makes is a metered runner call (`specs/step-budgets`): it counts against the
  step's budget and the run's, listed by source (`panel`, `role`, `fresh`, `decider`, `explain`); a person's answer is `free`;
  an answerer that cannot report what it spends declares `unmetered` with a reason and is counted and shown, never as zero. A
  budget stop during an answerer's call stops that call like any other and follows the budget rules; the answerer is then
  `unavailable` for that question.

**The channel and the front ends**

- [ ] AC-57. The conversation channel is `.indaba/conversation/` (C-14, [`data-model.md`](data-model.md)): a `live/` entry for
  each running run, a `requests/` file for each prompt waiting for a person, an `inbox/` file for each message, ask, answer,
  mode or decider change, take-over or reopen the person sends, and an `outbox/` file for each receipt and reply. Files are
  written whole and atomically; the engine polls the inbox and the requests' answers every 500 ms (injectable) while a run is
  going; ids are validated before any path is built. The channel is the same for the terminal commands, the dashboard, an
  embedder and the web view later.
- [ ] AC-58. The terminal prompt shows the choices in the wording of C-06, with the same input rules as the human arbiter (end
  of input or cancel answers `unavailable`). The terminal prompt and the files can both be open: the first answer wins and
  the other is withdrawn. `--rulings none` closes the prompt and leaves the inbox open.
- [ ] AC-59. `indaba answer list|show <id>|<id> ...` answers a question; `indaba say`, `indaba ask`, `indaba mode`, `indaba
  decider` and `indaba answer --reopen|--take-over` use the inbox; each prints a receipt or reply in plain words. A command for
  a run that is not running says so and, for `ask`, offers phase 2 (AC-65).
- [ ] AC-60. The dashboard shows: the choice of AC-16 in its header; a banner when a question waits, with the count; a
  conversation pane listing the board's person, question, answer and choice entries with their receipts; a message entry (up
  to 2000 characters); the question pane with numbered choices; and the controls to join, step back, and promote, replace or
  remove the decider. All text goes through the dashboard's sanitiser (`specs/tui` AC-05) and is shown as text only; colour is
  never the only carrier; the pane is keyboard-complete.

**Extension, untrusted text and compatibility**

- [ ] AC-61. `PluginHost.registerAnswerer(answerer)` accepts another kind of answerer; the built-ins (`person`, `panel`,
  `role`, `fresh`) register through it with no privileged access. An answerer, like every extension, declares `metering`
  (`specs/step-budgets`) and is refused without it. A plugin cannot add a question source, cannot make its answer count as a
  human's, and is used only when the user's configuration names its kind (C-12). A decider is a role and runs on a runner, so
  a plugin's runner can be one; there is no separate decider contract to register.
- [ ] AC-62. Wherever a question, an answer, a message, a note or a history goes into a prompt it goes through
  `fenceAsData`: every line starts with `| ` under a fixed sentence that says the lines are information, not instructions to
  the engine, and nothing in them is expanded, interpolated or read back as a post line, a verdict tag, a `NO ANSWER:` line or
  a question line. A test feeds text that looks like instructions, board lines, verdict tags, `NO ANSWER:` lines and fences,
  and checks that none can start a line without the prefix or be read back.
- [ ] AC-63. `@indaba/core` imports no `node:` module for any of this (`architecture.test.ts` stays green), `engine` and
  `runners` keep their layers tests, and `ConsensusArbiter.deliberate` without the new parameter behaves as before. The
  resolver's folder reading is in `@indaba/engine`; core holds only its contract and pure helpers.
- [ ] AC-64. Spans and events carry ids, counts, kinds, modes, stages, hashes and outcomes, never the text of a message, a
  question, an answer, an instruction or an asset (E-02). The text is on the board, in the channel files and in the user's own
  asset files only.

**A finished run (phase 2)**

- [ ] AC-65. **(phase 2)** `indaba ask --run <traceId>|latest [--to <answerer>] [--step <id>] "<question>"` for a run that is
  not running runs the answerer with that run's discussion as history, read from its `<traceId>.board.jsonl` (`BoardReader`),
  bounded as in AC-52. A run with no board file is refused in plain words. The run's own files are not changed.
- [ ] AC-66. **(phase 2)** The answer is printed as in AC-47 (answer, dissent, source, spend), written to
  `.indaba/asks/<id>.json`, and nothing else is written: not the run's board and not the decision ledger. Exit codes: `0`
  answered, `1` error, `2` no answer. It is metered like any run and prints what it spent.

## 4. Non-goals

- **Indaba choosing the mode, the decider, the answerer, a skill or a prompt by itself.** No heuristic, no confidence score,
  no "smart" escalation to a person or away from one, no automatic switch when a person is slow, no fallback to a similar
  asset, no upgrade of an accepted asset. Indaba carries out the user's choice and shows it.
- **A fixed list of personas.** Indaba ships no architect, manager or editor. The names and the instructions are the
  user's.
- **A mode or a decider that cannot be changed during the run.** The user can always join, step back, and promote, replace
  or remove the decider (AC-12).
- **Second-guessing a decider.** No automatic confirmation by a person, no veto, no second opinion, no escalation of a
  decider's decisions. If the user wants a person to confirm a kind of decision, they leave it out of the decider's authority.
- **Warning-and-blocking, ranking or overriding the choice.** Indaba may state facts about a configuration (a decider that
  reports no cost, no person in reach, a decider with no authority). It does not refuse to start, ask "are you sure", or rank
  the options. (A missing, invalid or unaccepted asset is an error, because the run cannot be what the user wrote.)
- **Reading questions out of free text.** Indaba does not scrape a terminal stream, a pseudo-terminal prompt or the end of a
  reply for sentences that look like questions. It cannot tell them from other text and a wrong guess would stop or answer the
  wrong thing. The structured path is the `BOARD question:` line (C-01).
- **A pretence of live conversation.** No runner Indaba has takes a message in the middle of a call, so none is claimed: a
  message is read at the next prompt, an interrupt aborts and re-runs, and the receipt says which (C-03).
- **An unbounded chat between models.** Answerers do not talk to each other except inside the panel's bounded rounds, an
  answer is not itself scanned for questions, and every limit of AC-55 holds.
- **Answering ACP permission requests with a person or a model.** `session/request_permission` is a tool permission, decided
  by `permissions`; handing it to models would put a security decision in a conversation (C-15).
- **A model's answer counting as a human ruling.** It never enters the decision ledger, never settles a debate and is always
  labelled.
- **Reopening a decided debate.** A recovered discussion is context for a new question; it does not change the step it came
  from, its ruling or its ledger entry.
- **Running anything an asset contains.** A skill or prompt is text. No script, command, include, link or referenced file is
  ever executed or followed.
- **Network access at run time for assets.** The resolver never downloads. The helper does, on request, from sources the
  user named.
- **The helper, the registry and the wizard for skills and prompts.** They are `specs/asset-helper` (C-27); no registry or
  URL is invented here.
- **Memory between runs, and the agent's own memory.** History comes from one run's board, chosen by the person; Indaba keeps
  no agent conversation between calls and `ask` does not pretend to reach it (C-04).
- **A web interface in this change.** The channel and the commands are the contract it will use later.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the reply has no question | nothing here applies; the step goes on as today |
| the reply has a question and the step has no `ask` | the question is an ordinary board entry for later steps |
| the reply has several question lines | the first is asked; the rest stay on the board, counted |
| the reply has a question and a verdict tag | the question wins; no verdict is read this pass (C-08) |
| the step asks more than `max_questions`, or the run more than `max_questions_per_run` | the step ends `ESCALATED`, naming the limit |
| `attended`, and nobody can be asked (no terminal, `--rulings none`, no channel) | the question is unanswerable; the step ends `ESCALATED` as it does today |
| `attended`, and the person is simply not there | the question waits; there is no timeout; cancelling is the bound |
| `trusted`, and every answerer passed or was unavailable | `on_exhausted`: `stop` (the step ends `ESCALATED`), `best_guess`, or `ask_person` (and `ESCALATED` if nobody can be reached) |
| a decider with authority over questions says `NO ANSWER:` or cannot run | `on_exhausted`, as above |
| a decider is promoted with an empty authority | it decides nothing; `validate` states the fact; the person decides |
| a decider reaches `max_decisions` or `max_decisions_per_run` | the step ends `ESCALATED`, naming the limit |
| `decides` names a kind this version cannot send to a decider | parse error, in plain words, listing the kinds available |
| the person cancels the prompt or the run | the run ends `cancelled` |
| the person answers with empty or over-long text | the prompt asks again; nothing is sent to the agent |
| the person chooses *stop* | the step ends `ESCALATED` (C-15 on what is deferred) |
| the person answers with a choice the stage does not allow | refused in plain words; the question stays open |
| a mode or decider change names a step or role that does not exist, or makes a choice incomplete | refused in plain words; nothing changes |
| a change arrives while a question is being answered | it applies from the next question; the open one finishes as started unless taken over |
| a take-over arrives and the answerer has already answered | the answer stands (it is on the board); the person may reopen it |
| an answerer's runner cannot run | `unavailable`, with the reason; the list goes on |
| an answerer or a decider changes a file | the call fails; the step ends `ESCALATED`, naming the files |
| the panel does not agree | `pass`, with proposals and dissent; shown to the person if the person delegated |
| a model replies `NO ANSWER:` | `pass`, with its reason |
| a budget stops an answerer's or a decider's call | that call stops; it is `unavailable` for the question; the budget rules apply |
| a message names a step that does not exist | `refused`, with the step ids |
| a message to a finished step | `undelivered`; it is on the board |
| interrupt on a shell step, a debate step, or a step that is not running | `refused`, in plain words |
| an inbox or answer file is malformed, too large, or names a stage that is over | ignored with a warning event; the question stays open |
| the process dies while a question is open | nothing is persisted between runs; the next run starts the step again; a stale `live/` or `requests/` entry (its `pid` is gone) is ignored and cleaned |
| the run ends with files in the channel | the run's `live/` entry, open `requests/` and unread `inbox/` files are removed; `outbox/` stays for the sender to read |
| a `skill` or `prompt` name resolves nowhere | `validate` and `plan` fail in plain words, naming the field, the name and the sources searched; the run does not start |
| an asset is over the size bound, has a bad first block, a `name` that differs from its folder, or is not text | the same plain error; nothing is used instead |
| a downloaded asset has no accepted entry in the manifest | refused: "not accepted yet"; nothing is used instead |
| a downloaded asset's hash differs from the accepted one | refused: "changed since you accepted it"; nothing is used instead |
| a symlink or junction in an asset folder leaves the folder | that asset is refused as invalid |
| an asset file changes on disk during the run | not picked up; the run keeps what it hashed at load |
| two sources have the same name | the stronger source is used; `plan` states that the other exists |

## 6. Security and data handling

- **Untrusted inputs.** A question, an answer, the panel's messages and the replies of every answerer are model output. A
  person's text is trusted as guidance from the operator but may be pasted from somewhere hostile, so it is treated as
  untrusted data for every purpose except being followed as task guidance. Each goes through `fenceAsData` into every prompt
  (AC-62), is cleaned and redacted on the way in (AC-03), and is shown as text, never as markup, in every front end. A
  conversation text cannot name a step, a role, a path, a command or an action: the only thing it changes is the text of a
  later prompt, and the only things a message can choose are its target step and whether to interrupt.
- **Assets are trusted only after the user accepts them.** A skill or prompt that comes from the user's own workflow file or
  project folder is as trusted as the workflow file. One that was downloaded is untrusted until the user accepts it, per name
  and version, with the SHA-256 of the exact bytes pinned, the source and licence recorded, and the text shown before
  acceptance; a later change in the bytes is refused (AC-26). Once accepted, an asset is the user's instructions to a role
  and is followed (AC-24), but it can never widen `permissions`, never starts a process, and never reads a file it names
  (AC-23). Nothing here downloads: only the helper does, on request, from a source the user named, over a channel and with a
  size cap that `specs/asset-helper` fixes (the allowlist rule of `specs/acp-agent-install` AC-05 is the model).
- **Who may write into the channel.** Anyone who can write to `.indaba/conversation/inbox/` in the project can send a message
  or change the choice, which is the same trust as being able to edit the workflow file or the project. Files are created
  with mode `0600` where the platform has modes, the directory is under `.indaba/` (gitignored), every file is bounded
  (8 KiB), the engine reads at most 10 files per poll, and a flood is refused after the limits of AC-35. A message is guidance
  to an agent whose `permissions` and guards are unchanged by it. A change of choice is the user's, so it is recorded with its
  source; the engine does not authenticate who wrote the file, and the record says so.
- **No new surface for the agent.** There is no tool and no new method. The agent writes one line in its reply, as
  `specs/run-blackboard` already allows.
- **A hostile reply cannot start a loop.** `max_questions`, `max_questions_per_run`, `max_decisions` and
  `max_decisions_per_run` bound the passes; a malformed line is ignored, never a failure that a retry would repeat; an
  answerer's or decider's reply is never scanned for a question, a `BOARD` line or a verdict tag.
- **Read-only answerers and deciders.** Every model answerer and the decider runs with an empty write list and no terminal
  where the runner can enforce it, a prompt that forbids changes, and, with a tracked workspace, a check that the change list
  did not move (C-13). A decision is text or a choice: nothing runs because a decider decided.
- **Fresh instances are not isolated from the filesystem.** A `fresh:` answerer shares no conversation with the asking agent
  but runs in the same project folder; its isolation is the read-only protection above, not a sandbox.
- **Paths.** `.indaba/conversation/` is built only by the channel functions of the engine; every id is validated
  (`[a-z0-9-]{1,64}`) before any path is built from it; files are written atomically (temporary file in the same directory,
  then rename). Asset folders are resolved and confined like every other path (`..`, absolute paths in the asset's own text,
  symlinks and junctions out of the folder are refused); an asset name is validated (`[A-Za-z0-9_-]+`) before any path is
  built from it.
- **Secrets.** Channel files hold the question, the answer, titles and receipts, all redacted. They hold no prompt, no
  environment, no key and no path outside the project. An asset that contains something shaped like a credential is shown
  with that fact by the helper; the resolver redacts nothing in the user's own text but never puts an asset into a span or an
  event.
- **No shell.** Nothing here starts a process except the runners the workflow already names; no argument is built from
  conversation text or asset text.
- **Determinism.** Ids and times come from the injected `IdGenerator` and `Clock`; the choice of the question (AC-40), the
  panel's answer (AC-50), the order of the answerers, the list of recoverable discussions (AC-52), the choice in force for a
  question, the resolution of an asset (fixed precedence, bytes hashed once) and the order in which queued messages are
  delivered are pure functions of the reply, the transcript, the board, the files at load and the sequence of received messages
  and changes.

## 7. Where it lives

- `@indaba/core` (pure): the value types (`ConversationMessage`, `StepQuestion`, `AnswerRequest`, `AnswerOutcome`,
  `AnsweredBy`, `DecisionMode`, `DecisionKind`, `DeciderSpec`, `AskSettings`, `PanelAnswer`, `RecoverableDebate`,
  `AssetKind`, `AssetText`), the `Answerer` and `AssetSource` contracts and their registries, `effectiveAsk` and
  `walkAnswerers` (pure functions that decide the choice in force and what to ask next), `panelAnswerFrom`, `fenceAsData`,
  `parseAssetFirstBlock`, the fixed sentences, the event classes, the `ask` and `decider` members of `StepDefinition`, the
  `instructions`, `skill` and `decides` members of a role, `defaults.ask`, `defaults.decider`, `asset_folders`, `skills`, and two
  optional additions to the mesh (`Blackboard` history and `ConsensusArbiter.deliberate(..., history?)`). No `node:` import.
- `@indaba/engine`: the parser for the new fields, the question loop, the choice state and the message delivery inside
  `StepExecutor`, the answerers built on runners (`PanelAnswerer`, `RoleAnswerer`, `FreshAnswerer`, `DeciderAnswerer`), the
  finder of recoverable discussions (reads the run board), the channel (`ConversationChannel`, `FileAnswerer` for the person,
  `ConversationInbox`), the board entries it posts, the asset resolver with its folder and manifest readers
  (`AssetResolver`, `FolderAssetSource`, `readAssetManifest`), and (phase 2) the offline `ask`.
- `@indaba/runners`: nothing.
- `indaba` (CLI): the terminal answerer, `say`, `ask`, `answer`, `mode`, `decider`, the run options, the banner, the
  registration through `PluginHost`, and the lines of `validate` and `plan` for assets.
- `@indaba/tui`: the header, the banner, the conversation pane, the message entry, the question pane and the controls; it reads
  and writes only through the engine's channel functions.
- Docs: `docs/workflow-format.md`, `docs/getting-started.md`, `docs/extending.md`, `README.md`, `CHANGELOG.md`,
  `specs/DEPENDENCY_MAP.md`.

## 8. Clarifications

Every point below is a recommended decision and the maintainer confirms it. The alternatives that were weighed are named,
because each default chosen here is inherited by every consumer.

- **C-01. Which questions Indaba can act on, checked in the code.** (a) A step's own reply, through the `BOARD question:` line
  `specs/run-blackboard` defines: structured, one line, works for every runner including text-only API runners. This is the
  one new source. (b) ACP: the runner handles `session/request_permission` (decided by policy), `fs/read_text_file` and
  `fs/write_text_file`; every other method is `METHOD_NOT_FOUND`, and there is no question or elicitation method to listen
  for, so none is invented. A permission request is not a question and routing it to a person or a model is declined. (c) A
  debate participant's `QUESTION` message is already read by the other participants and needs nothing new. Free text in a
  terminal stream or at the end of a reply is not detectable. Rejected: a heuristic that treats a reply ending in `?` as a
  question (a wrong guess halts a run or answers a rhetorical question).
- **C-02. How the agent learns it may ask.** A fixed section, `ASK_INSTRUCTION`, appended to the prompt of a step with `ask`,
  in plain words: "If you cannot go on without an answer, end your reply with one line that starts `BOARD question:` followed
  by your question, and stop. You will be asked again with the answer. Ask only what you cannot decide yourself." The author
  writes nothing. Rejected: leaving it to the goal text (a wording that drifts from the grammar makes questions vanish
  silently), and a tool (decided in `specs/run-blackboard`: no tool).
- **C-03. Delivery to a running agent: what each transport can really do.** Verified in the code: the ACP runner opens a
  session, sends one `session/prompt`, waits for its response, and sends `session/cancel` when aborted, and it ends the session
  when the call ends; the CLI runners take the prompt as an argument and, under a pseudo-terminal or pipes, write nothing to the
  process afterwards; the API runners make one request. So **no runner can take a message in the middle of a call**. The honest
  design is therefore: a message is applied at the step's next prompt (`queued`, then `delivered`); `--now` aborts the current
  call with the abort every runner already honours and runs the next pass at once; a debate has natural turn boundaries, so a
  message reaches it at the next round. The receipt says "queued, it will be read after the current turn" and never "sent". A
  runner that one day can take a message live would declare it through an optional method on `Runner`; none does, so the
  contract is not changed now. Rejected: writing to a CLI's standard input (no runner Indaba drives supports it, and an
  untested protocol is exactly what must not be invented); sending a second `session/prompt` on a live ACP session (the runner
  closes the session at the end of the call).
- **C-04. Indaba keeps no agent conversation between calls.** Every call is a new session; the step re-run after a question or
  a message is a new call with a longer prompt. So "why did you do that?" is answered by a **new call** shown the step's last
  reply (kept in memory for the run, bounded, redacted), the goal and the digest, and is labelled as a reconstruction.
  Retry-loop isolation is about failures ("the next prompt carries only the last failure"); an answer or a message is an
  input, so a step's prompt carries every answered question of the attempt (at most five, each cut) and the undelivered
  messages, but no earlier reply, no failure text and no output. A question's re-run is not a retry and not a verdict
  iteration, so "three failures", "three review rounds" and "three questions" stay distinguishable. Rejected: a long-lived
  session for the answer (only some runners have sessions); keeping every earlier reply (it breaks the isolation rule and
  grows without bound).
- **C-05. One question at a time, the first one.** A reply may contain several `BOARD question:` lines; the first is asked,
  the others stay on the board. A person answers one question at a time, and the agent can ask the next after it has the
  first answer. Rejected: asking all at once (more input rules, a partly answered state, and a second question is often made
  moot by the first answer).
- **C-06. The modes, the answerers and the words.** Two modes the user sets (`attended`, `trusted`) and one the user's
  promotion produces (`decider`), named for what the user does: *I take part*, *I trust the agents*, *I promote an agent to
  decide*. Four built-in answerer kinds, written as strings so they read the same in a file, on a command line and in a form:
  `person`, `panel`, `role:<name>`, `fresh:<name>`. In `attended` mode the answerers are things the person may *delegate to*,
  never run on their own. The person's choices, numbered, in plain words: "I will answer it myself", then one line per
  answerer ("Ask the panel (antigravity, opencode)", "Ask antigravity", "Ask a new copy of claude"), then "Let the agent use
  its best judgement" and "Stop here". After a model answer the person delegated: "Use this answer", "I will answer it myself
  instead", "Ask again (you can add a note)", "Ask someone else", "Stop here". The fixed sentence for a best guess is "No
  answer is available. Use your best judgement and say what you assumed." The word "skip" is not used: it does not tell a
  non-developer that the agent will carry on without being told. Rejected: a single ordered list in which `person` is just
  another entry (it hides the user's choice about whether a human is in the loop in the order of a list); a free-form
  expression language for the lists (a list of strings is enough and a form can edit it).
- **C-07. "I have no answer".** For a person it is a deliberate choice ("ask someone else", "let the agent use its best
  judgement"), and there is no timeout, so silence is never taken as an answer. For a model answerer or a decider it is the
  first line `NO ANSWER: <reason>`, matched only at the first column and only as the first non-empty line; any other reply is
  its answer, cut at 2000 characters. An empty reply, a failure, an unavailable runner or a panel that does not agree are `pass`
  or `unavailable` with a reason. Rejected: asking the model for a confidence score (a number from a model is not a
  measurement and would be shown as one).
- **C-08. A question and a verdict in the same reply.** The question wins. An open question means the work is not finished; a
  verdict written beside it contradicts itself, and the safe reading (never approve while something is open) is the one
  `specs/step-verdicts` takes for a reply with both tags. After the last allowed question is answered the final pass is judged
  by the usual order (outputs, guards, verdict). Rejected: reading the verdict and ignoring the question.
- **C-09. The panel, the single answerers and the decider.** The panel reuses `ConsensusArbiter` and `RunnerParticipant` so
  rounds, stall detection, quorum and metering carry over. Its topic is one pure function (`PANEL_TOPIC`) of the question, the
  goal (cut) and the digest, each fenced, plus a fixed instruction: "Answer the question in plain words, in a few sentences,
  and say what the answer depends on. Reply `PROPOSAL:` with your answer, `CRITIQUE:` if you disagree with a proposal, and
  `AGREEMENT:` if you agree with it. Do not change any file." A single answerer (`role:`, `fresh:`, the decider, the explainer of
  `ask`) gets `ANSWER_INSTRUCTION`: the same plain-words request, the `NO ANSWER:` rule and the no-change rule. The panel's
  answer is the latest `PROPOSAL` and the dissent the latest `CRITIQUE`s of those who did not agree, because the mesh's
  agreement carries no content of its own to quote. Rejected: a separate synthesising model call after the debate (one more
  metered call and a second author of the answer); counting the first proposal as the answer when the debate never agrees (it
  would pass a disagreement off as an answer).
- **C-10. What "the same model" guarantees, and what it does not.** `fresh:<name>` starts a new call of that role's runner and
  model in a new session: it shares no conversation, reply or reasoning with the asking agent, so it sees the question without
  the asking agent's framing, which is what makes it a real second opinion. It does **not** guarantee different knowledge (same
  weights), different mistakes (errors of one model are correlated), different sampling (Indaba does not set it), or a
  different provider. So its answer is labelled `same-model-instance`, the banner names it, and the documentation says it is a
  check of reasoning, not an independent expert. `role:<name>` is the same mechanism with a different role, so a different
  model if the roles differ; `role:` with the step's own role is refused so the label is never misleading ("use `fresh:<role>`
  to ask a new copy of the same agent").
- **C-11. No unbounded autonomous chat.** The only multi-model exchange is the panel, with a round limit. An answer is never
  scanned for a question, an answerer cannot call another answerer, a decider cannot promote another, the lists have finite
  length, and the counts of AC-42 and AC-55 hold. Questions that arrive from several variants or while another is open wait in
  a queue and are asked one at a time (labelled with the variant). Rejected: concurrent questions to a person (the prompt model
  is one question at a time) and merging identical questions across variants (comparing text is a guess).
- **C-12. Extension points.** Two. `Answerer`: another way to ask a person (a chat bot, a form) or another kind of model answerer,
  registered through `PluginHost.registerAnswerer` with a unique kind name used in a list like a built-in, and it must declare
  `metering`. `AssetSource`: another place skills and prompts come from, registered through `PluginHost.registerAssetSource`.
  The built-ins register through the same methods with no privileged access (the extensibility rule). A plugin **cannot** add a
  question source (a source needs runner integration, and the board line is the contract), cannot make its answer count as a
  human's (`answered_by` is `plugin:<kind>`, never `person`), and can listen to the events. A plugin's answerer runs only when
  the user's configuration, run option or live change names its kind, and a plugin's asset source is searched below the user's
  own, so a plugin is a choice of the user, never a default. A decider needs no contract of its own: it is a role, and a role
  runs on a runner, which a plugin can supply.
- **C-13. The answerers must not change the work.** An answerer is a runner and could edit files. Protection is layered like
  `permissions` today: an empty write list and no terminal for runners that support `permissions` (the ACP gate), a prompt that
  forbids changes, and, where the step has a tracked workspace (`specs/workspace-without-git`, or a git worktree), an implicit
  scope guard with an empty list after the call. For a step with no workspace (`isolation: none`) there is nothing to compare,
  so `validate` says so as a fact and `docs/workflow-format.md` states plainly that an answerer there can touch the project
  folder. Rejected: refusing `ask` on steps without isolation (it would shut out the non-developer on a plain folder, the
  audience this exists for).
- **C-14. The channel.** One directory, `.indaba/conversation/`, with the atomic write, id validation and polling rules of
  `.indaba/rulings/`, but four kinds of file because the traffic goes both ways: `live/<taskId>.json` (a run that can be talked
  to), `requests/<id>.json` (a prompt waiting for a person), `inbox/<id>.json` (what the person sends: a message, an ask, an
  answer to a request, a mode or decider change, a take-over, a reopen) and `outbox/<id>.json` (receipts and replies). It must
  carry exactly: a **message from the person** (target step or run, text, `now`), a **question from a model** (with its stage,
  the answerers offered and the choice in force), an **answer** (a choice), a **mode or decider change**, a **take-over**, a
  **reopen**, and the **receipts and replies**. The inbox is on by default for every run, because a person can always talk;
  `--rulings` (`terminal`, `files`, `none`) keeps deciding where questions are *prompted*. A ruling answers accept or reject and
  a conversation answers a choice with text, so they are different shapes and different directories; `indaba rule` is
  unchanged. Rejected: one directory with a `kind` field (every reader of the rulings would handle a second shape) and reusing
  `rule` for both (a person typing `rule <id> accept` at a question would do something meaningless).
- **C-15. What is deferred.** (1) Keeping a stopped step's work and resuming after a *stop* at a question (the budget stop of
  `specs/step-budgets` keeps the workspace and writes a resume file; a stop at a question follows today's escalated step). (2)
  Asking a person about a refused ACP permission. (3) A runner that takes a message live (`Runner.deliver`). (4) Typing into
  the run's own terminal (it would compete with prompts and a pseudo-terminal's input). (5) A web view of the conversation. (6)
  `--rulings <plugin-name>`, so a plugin front end can be picked from the command line. (7) Decisions of kinds other than
  `questions` (C-24).
- **C-16. Semver.** Additive and optional: minor below 1.0. `Answerer`, `AssetSource`, the two registry methods and the two mesh
  parameters add to published types; an implementer of `PluginHost` other than the CLI's would have to add two methods (as with
  `registerAdjudicator` and `registerBudgetResolver`). The metering obligation of `specs/step-budgets` applies to every answerer
  from the start, so this spec adds no extension that is exempt. A new member of the `Role` type is optional.
- **C-17. Limits that are guesses.** All of AC-55, the 20,000 characters of kept reply, the 8 KiB file and the 10 files per poll.
  None is measured against real use; they are constants in one place, and the spec says so rather than present them as
  findings.
- **C-18. Plain words.** Every message a person reads (prompts, receipts, errors, validation messages, the banner) is written
  for someone who does not know the words step, runner, guard or arbiter. "The panel" is explained once in the prompt ("the
  other agents discuss it and give one answer"), a refusal says what to do next, and `validate` quotes the field path as well.
  The exact wording of the prompts is in C-06 and the other fixed sentences in [`api-surface.md`](api-surface.md), and is
  tested.
- **C-19. The decision ledger.** Nothing here reads from or writes to `.indaba-decisions/`. The ledger's key is a debate on a
  committed file set; a question to a working agent has no such key, and an answer depends on the conversation. The record of
  what was asked and decided is the board (`answers`, `answered_by`, `decided_by`, `mode`) and the trace. A step's `arbiter` is
  for debate steps only; a choice of mode does not change it, and `--no-human` does not make a human arbiter unavailable,
  because that is a different decision the user wrote in the step. When `debates` joins the decider's authority (C-24), a
  decider's ruling will be recorded as the decider's, not as a human's.
- **C-20. Interactions.** *Step-verdicts:* C-08 (the question wins); a person's message to a review step is read at its next
  pass like any other. *Step-variants:* each variant asks on its own and is queued (C-11); an answer goes only to the variant
  that asked; an answerer's spend counts against the share of the variant that asked; the examination debate is a different
  debate. *Step-budgets:* AC-56; the budget's own resume question and a conversation question are different prompts and never
  merge. *Workspace-without-git:* nothing here assumes git; the read-only check uses the tracked workspace's change list, and
  the kept reply and the board work for `isolation: none`. *Run-blackboard:* messages, questions, answers and changes are board
  entries (`person` source, kinds `note`, `question`, `result`).
- **C-21. Who decides, and why the modes are not a list.** The principle (section 1) is made testable by three rules: the
  default of every new field is today's behaviour (AC-01, AC-02); a question goes to a model only when the user's
  configuration, a run option, a live change or the person's own choice names one; and Indaba shows what is chosen but never
  judges it (AC-16). The three ways of working are three different statements by the user, not three orderings of one list,
  so a person reading the banner, the board or the trace can tell at once which one was in force. Rejected: heuristics that
  decide to ask a person when a model is "unsure" or to skip a slow person (the engine would be deciding who decides); a
  blocking confirmation when the user picks `trusted` (a warning that stops the user is a decision by the engine); inferring the
  mode from whether a terminal is attached (a terminal being absent is a fact to state, not a reason to hand the question to a
  model).
- **C-22. The decider is a standing role with authority, not an answerer.** Promotion is a different act from listing an
  answerer: the user declares a role with a persona (`runner`, `model`, `instructions` or `skill`), gives it authority
  (`decides`), and names it as the decider; there is no list to fall through, its decision is the decision, and it is
  recorded as `decided_by` with the role's name. The display name is the role's name as the user wrote it ("Architect decides").
  A decider may be a role other than the asking step's, or the same role as a fresh instance, with the caveat of C-10 stated
  in the banner. It does not report upward: if the user wants a person to confirm a kind of decision, that kind is left out of
  its authority and the person decides it. It is bounded (`max_decisions`, per step and per run), metered, read-only, and its
  inputs are fenced data. Rejected: making the first entry of `answerers` the decider (the promotion would be an accident of
  order); a decider that is a person (that is `attended`); an engine rule that sends a decider's decision to a person when it
  looks important (the engine would be deciding what is important).
- **C-23. Changing the choice during a run.** A change applies from the next question so that no answer already in flight changes
  under it; *take over* (AC-13) is the explicit way to change the open question. `mode set` replaces the person-or-agents
  arrangement and removes `questions` from the decider's authority for that scope, so "I join" and "I step back" mean what they
  say; `decider set` and `decider remove` change the promotion. Changes are checked as a whole (the resulting choice must be
  complete) and refused as a whole. They are recorded with their source and time, on the board as an engine note and in the event
  stream, and the dashboard follows the change. The engine cannot tell who wrote an inbox file, so the record states the
  channel, not an identity. Rejected: applying a change to a question in flight (an answerer call would have to be cancelled
  silently); a change that takes effect only at a step boundary (a long step could not be taken back).
- **C-24. Authority has a scope, the user sets it, and nothing is implied.** The kinds are `questions` (the working agent's
  questions), `debates` (settling a failed debate: the decider acts as the step's arbiter, `specs/debate-arbiter`), `reviews`
  (approving or rejecting a result in a review loop, `specs/step-verdicts`), `variants` (choosing among variants,
  `specs/step-variants`), `landing` (approving a landing, `specs/workspace-without-git`) and `budget` (deciding whether to
  continue after a budget stop, `specs/step-budgets`). The field is `decides: [kind, ...]` on a role (standing authority) or on
  a promotion (that use only); an empty or absent scope means the decider decides nothing. **This spec takes decisions of kind
  `questions` only.** The other five need a hook in their own spec, and the section 9 list says exactly which, so a user is never
  told a decider has authority that the engine does not send to it: naming an unavailable kind is a plain parse error that lists
  the kinds available (the constant grows as sibling specs adopt it, each a minor). The core defines the request and outcome
  types for all six kinds now, so a sibling adopts a decider without a new contract. Operator caps of `specs/step-budgets` stay
  final: no decider can raise them. Rejected: accepting the other kinds now and ignoring them (a silent no-op the user would
  not know about); granting authority by default to a role named `architect` or similar (Indaba invents no personas).
- **C-25. Assets: skills and prompts through one contract.** A skill (the persona of a role) and a prompt (the text of a
  debate or step, `specs/debate-findings`) are *assets*. They are resolved by one `AssetResolver` over a fixed precedence
  (workflow file, project folders, user folders, plugin sources, built-ins), with one size bound, one text-only rule, one
  acceptance rule for downloaded content and one family of plain-words errors, instead of a mechanism per kind. `debate-findings`
  already defines the reference (`prompt:`), the workflow `prompts` map and `registerPrompt`; they become the first source and a
  plugin-registered source of the new resolver, unchanged to their users. The skill reference is `skill:` on a role; its text
  and the role's inline `instructions` become the role's `ROLE_SECTION`, a fixed heading, the text, and a closing line, added to
  every call of the role. It is instructions, not data, because it is the user's text from an accepted source; it is nevertheless
  delimited so the model can tell it from the task and from any data. The runtime format (`skills/<name>/SKILL.md` with `name`
  and `description`) resembles the development workflow's skills in `.agents/skills`, but that is a different system, parsed by
  a different tool, and they must not be confused: the runtime resolver reads only the folders a user's workflow declares.
  Rejected: running or including scripts and files an asset mentions (a skill is text; a runnable skill would be a plugin); a
  fallback to a built-in when a name is missing (the user chose a name); resolving at each call instead of once (a file changed
  during a run would change the run under the user).
- **C-26. Phases.** Phase 1 is everything except AC-65 and AC-66: the workflow fields, the loop, messages and asks to a running
  run, the choice of who decides with live switching, the decider for `questions`, the panel with recovery inside a run, assets
  with the resolver, the channel, the commands and the dashboard. Phase 2 is `indaba ask` for a finished run, which needs
  nothing from the engine beyond phase 1 and a reader of an old run's board. It is separated because it has a different entry
  point (a command with no running engine) and can ship later without changing anything built in phase 1.
- **C-27. The helper, and the three ways.** For a skill or a prompt the user has three ways: use one that already exists (in the
  project or the user's folders), download one, or write their own. This spec defines the *reference and the resolution* only. The
  single helper that lists, adds (downloads, shows first, asks, pins and records), removes, verifies and creates (a scaffold with
  a wizard in plain words) skills **and** prompts is `specs/asset-helper`, to be written. The same three ways for agents already
  have their download mechanism in `specs/acp-agent-install`; a role refers to an agent with `runner` and `agent` as today. The
  helper's sources are named by the user (an allowlist like the one in that spec), never invented, and it is the only code that
  opens the network. The manifest format the resolver verifies is fixed here ([`data-model.md`](data-model.md)) so the helper
  has one target.
- **C-28. Role instructions apply to every call of the role.** `instructions` and `skill` describe the persona of the role, so
  they are added to its working calls as well as its panel, answerer and decider calls; a role that works one way and decides
  another would surprise the author. Rejected: applying them only when the role decides (the same name would behave
  differently in two places); a new section per use (more fields for the same idea). The size is bounded (AC-55) and the section
  is the same text each time, so retry-loop isolation is unaffected.

## 9. Changes to other specs (not made here)

These are follow-ups; this spec edits none of them.

- **`specs/run-blackboard`.** (1) `BoardSource` gains `'person'` (a message, a reopen, an answer typed by the person). (2)
  `BoardEntry` gains optional members `answers?: number` (the `seq` of the question an entry answers), `answeredBy?:
  AnsweredBy`, `decidedBy?: string` (the decider's role) and `mode?: DecisionMode`, with the keys `answers`, `answered_by`,
  `decided_by` and `mode` in `data-model.md`. (3) The scope vocabulary gains `panel:<n>`. (4) `ConsensusArbiter.deliberate`
  gains a fifth optional parameter, `history`, after the `observer` it already adds. (5) The digest renders an answered
  question's answer as `result (answered by panel)` or `result (decided by architect)`, and a person's message as `note (from the
  person)`. (6) The TUI keys of the board pane are reconciled with the conversation pane's.
- **`specs/ruling-channel`.** Nothing is required. Recommended: the atomic write, id validation and polling code is one helper
  both directories use, and `--rulings` is documented as also choosing where questions are prompted. The channel of C-14 is what
  a front end needs for the conversation.
- **`specs/step-budgets`.** The list of metered sources gains `panel`, `role`, `fresh`, `decider` and `explain`; the unmetered
  report lists an answerer's or decider's calls under them. For authority over `budget`, `BudgetResolver` gains a
  decider-backed implementation that may only `resume` within the caps the operator has not made final and may `stop`; it can
  never raise an operator cap.
- **`specs/debate-arbiter`.** For authority over `debates`, a step's `arbiter` may name a role that is the step's decider; the
  failed debate goes to the decider as an `Adjudicator` built on that role's runner; its ruling is recorded as the decider's
  and is not written to the decision ledger as a human ruling (or the ledger entry gains a `by` member and a decider's entry is
  never reused as a human's). The human arbiter is unchanged by any choice of mode.
- **`specs/step-verdicts`.** Section 5.2 (order of work) gains a step 0, "a question, if the reply has one, comes before outputs,
  guards and the verdict" (C-08). For authority over `reviews`, the verdict of a review step comes from the decider when it has
  that authority, taking the reviewing agent's reply as its input, and the loop is bounded as today.
- **`specs/step-variants`.** A clarification states C-11 and C-20 (questions from variants are queued; the share of the asking
  variant is charged). For authority over `variants`, the selection of the winner comes from the decider when it has that
  authority, instead of the examination debate's ballot.
- **`specs/workspace-without-git`.** The tracked workspace's change list is what AC-53 compares. For authority over `landing`,
  the decision to apply a result (`defaults.apply: ask`) can be taken by the decider; `apply: never` is unchanged.
- **`specs/debate-findings`.** Its prompt registry gains the user-folder and downloaded sources and the workflow `skills` map's
  twin: `PromptRegistry.get` consults the `AssetResolver` for kind `prompt` in the precedence of AC-21, and its `prompts` map and
  `registerPrompt` become the first source and a plugin source of that resolver. Names, defaults and the ledger key (which
  includes the prompt text in force) are unchanged.
- **`specs/acp-agent-install`.** Nothing is changed. Its user-level location and its allowlist rule are what AC-21 (3) and
  `specs/asset-helper` reuse.
- **`specs/tui`.** The dashboard gains the header, the banner, the conversation pane, the message entry, the question pane and
  the controls (AC-60), with a text entry, which the dashboard does not have today.
- **`specs/workflow-editor`.** The schema gains `ask`, `defaults.ask`, the `decider` members, a role's `instructions`, `skill`
  and `decides`, `asset_folders` and `skills`; the catalog gains the answerer kinds, the decision kinds and the assets visible
  from the resolver, with descriptions.
- **`docs/workflow-format.md`.** Documents every field above, the fixed sentences, and the plain statement that an answerer or
  a decider on a step with no workspace can touch the project folder.

## Artifacts not written

- `research.md`: the options were weighed in the clarifications above, and nothing here depends on a fact gathered outside the
  code and the sibling specs; the code facts that mattered (what the ACP client handles, that the CLI runners write nothing to a
  process after starting it, that every call is a new session, the shape of `PromptRegistry`) are stated in C-01, C-03, C-04 and
  C-25 with the files they come from.
