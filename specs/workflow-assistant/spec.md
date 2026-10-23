# Specification: Workflow assistant (describe it in words, the editor fills in the data)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: minor (new optional server resources, a new optional panel, a new optional configuration section, new span attributes; nothing that exists changes behaviour).
> **Licence**: MIT, in this repository. The maintainer decided on 2026-10-23 that this is **not** a paid feature (see C-01 for the line against the paid wizard).
> **Builds on**: [`specs/workflow-editor`](../workflow-editor/spec.md) (the document and the edits), [`specs/web-app-editing-core`](../web-app-editing-core/spec.md) and
> [`specs/web-app-editing-forms`](../web-app-editing-forms/spec.md) (the edit view), [`specs/question-contract`](../question-contract/spec.md) (how the assistant asks),
> [`specs/agent-permissions`](../agent-permissions/spec.md) (the assistant runs at `read`).
> **Replaces**: the open item C-19 of [`specs/web-app`](../web-app/spec.md) ("an assistant in the editor, over ACP, by choice; needs its own spec"). That parent spec belongs to the web-app work and is not edited here (C-09).

---

## 1. The problem

A workflow file has roles, steps, goals, guards, permissions, debates and gates. A person who is not a developer, or one who has not read `docs/workflow-format.md`, does not know which
fields exist, which values are allowed, or what a sensible combination is. The edit view shows forms for every field, which helps only once you know what you want.

The maintainer's idea: in the edit view, a person can **describe what they want in words** ("review every change with two agents and ask me before it is merged"), and an AI model fills in the
data. The model can ask questions when something is unclear. The person chooses which model, including their own. Indaba feeds the model **by default with its own documentation** (the file format,
the catalog of runners and guards, the permission facts), so the model fills in real fields with real values and not guesses.

Three things make this delicate and are the substance of this spec: the model's output is untrusted text that must not be able to widen what an agent may do; the person's words and chosen
documents go to a model the person chose, which may be a remote service; and the result must be something the person can read, accept or discard, never something that saves or runs by itself.

## 2. User stories

- **US-01.** As a person editing a workflow, I describe what I want and see a proposal of changes to the draft, which I accept or discard.
- **US-02.** As a person who does not know the format, I get questions in plain words, with options and a recommendation, instead of having to know the field names.
- **US-03.** As a person, I choose the model (an agent I already use, or a model on a service I have a key for) and can change it; with none chosen, the assistant is off.
- **US-04.** As a person, I can ask what a field means and get an answer without any change to the file.
- **US-05.** As a person who cares what leaves their machine, I see what is sent to the model before the first use and can add or remove documents.
- **US-06.** As a person, nothing the model says can turn on full access, add a command or change what an agent may do without me looking at that exact change.
- **US-07.** As a maintainer, the assistant has no privileged path: it uses the same edits as the forms and the same validation.

## 3. Acceptance criteria

Terms. A **draft** is the document open in the edit view (`workflow-editor`). A **proposal** is a list of edits to the draft plus an explanation, made by the assistant and not yet applied.
An **assistant profile** is the person's choice of model (AC-03). The **context pack** is the documentation Indaba hands the model by default (AC-08).

**Where it is, and whether it is on**

- [ ] AC-01. The edit view has an assistant panel, in the source, form and graph views. It is **off until the person chooses a profile** (AC-03): until then the panel shows, in plain words, what it is and how to
  turn it on, and nothing is sent anywhere. Indaba never selects a model for the person.
- [ ] AC-02. The assistant works on the **draft that is open**. It does not create files, choose where a file goes, save, validate-and-run, or start a run: saving and running stay the person's actions
  (`web-app-actions` AC-13). Creating a workflow from nothing through a guided sequence with templates is the wizard (C-01), not this.
- [ ] AC-03. An assistant profile is one of: an **agent** the person already uses, started through its runner (the ACP and command-line runners of the catalog), or a **model on a service** through a runner of the catalog
  (OpenRouter, an OpenAI-compatible endpoint) with a model id. It is kept in the user's configuration (`indaba.config`, a section `assistant`), never in a workflow file and never in the page's storage. The
  key of a service comes from the environment, as for every runner, and is in no file, response, log line or span. The person can have several profiles and picks one per session. Removing the profile turns the
  assistant off.

**What the person sees**

- [ ] AC-04. The person types a request. The assistant answers with one of: a **proposal** (AC-05), a **question** (AC-06), an **explanation** (AC-07) or a **refusal with a reason** (for example the request is
  not about this workflow). Every answer is text shown as text (never as markup that runs).
- [ ] AC-05. A proposal is shown as the **difference** against the draft (the source view's diff) and as a plain-word list of changes, one per edit, each with a short reason from the model. The person accepts
  the proposal, accepts some of its edits, or discards it. Accepting applies the edits to the draft as ordinary edits of `web-app-editing-core` (so they show in the forms and the graph, are validated by the
  usual call, and can be reverted the way any edit can); nothing is saved. A proposal that does not validate (AC-12) is shown with the problem and cannot be accepted.
- [ ] AC-06. The assistant may **ask**. A question is in the form of `question-contract` (context, options, a recommendation, what happens otherwise) and is checked by the same pure `checkQuestion`; a question
  that fails the check is not shown, and the assistant is asked once to fix it. The person answers by choosing an option or writing text. At most **5 questions per request** (a design choice, C-06);
  after that the assistant must propose with what it has, saying what it assumed. No answer is never an approval: a request left unanswered changes nothing.
- [ ] AC-07. The person can ask what a field or a choice means. The answer is an explanation, taken from the context pack, and **applies no edit**.

**What the model is given, and what it may do**

- [ ] AC-08. By default the model receives the **context pack**: the workflow format (`docs/workflow-format.md`), the JSON Schema (`indaba schema`), the catalog of this installation (`indaba catalog`: runners with the
  permission map of `agent-permissions`, guard types, arbiters), the plain-word list of permission levels and presets, and the two examples of `examples/`. The pack matches the **installed version** of
  Indaba (it is built from the files shipped with it), is shown to the person in full on request, and has a fixed size bound (C-06). The pack is data for the model; it contains no secret and no path of the person.
- [ ] AC-09. The person may **add documents** to a session (a file of the project they choose by path inside a served root, or pasted text) and may remove any of them, including turning the default pack off
  for the session. Documents the person adds are marked as data in the prompt: text in them that looks like an instruction is not followed as one (the prompt says so, and AC-10 is what actually protects).
  Only the draft, the pack, the added documents and the conversation are sent; no other file of the project is read.
- [ ] AC-10. **The model's output is untrusted.** It is parsed as a closed structure (AC-11); anything else is a refusal shown to the person. The assistant has no tools: it runs at the level `read` of
  `agent-permissions` (an agent through the ACP gate that refuses every request, a service with no tool definitions), runs no command and reads no file itself.
- [ ] AC-11. A proposal is a list of edits drawn from the **same operations as the forms**: set a field at a path, add or remove a step or a role, in the vocabulary of `workflow-editor`. An operation outside
  that list, a path that does not exist in the schema, or a value of the wrong type rejects the **whole** proposal (no partial application of text the program did not understand).
- [ ] AC-12. Before it is shown, the proposal is applied to a **copy** of the draft and validated by `validate` with the catalog. A proposal whose result is invalid is shown as invalid, with the problems, and the assistant may be asked once
  to repair it, with only that failure as input (retries are bounded and isolated, `AGENTS.md`). A proposal never changes the draft itself until the person accepts it.
- [ ] AC-13. **High-impact edits are marked and are accepted one by one.** An edit is high-impact when it sets or raises a `permissions.level` or a `permissions` block, adds or changes an `mcp` list, adds or changes a
  `shell` command, changes a step's `runner` or a role's `runner`, turns off or removes a guard, sets an arbiter, or sets a gate's `if_nobody` or deadline to anything that approves. They are shown first and
  separately in plain words ("this lets an agent change anything", "this runs a command"), **"accept all" does not include them**, and a proposal that includes `permissions.level: full` shows the sentence of
  `agent-permissions` AC-04. The model cannot make an edit non-high-impact: the class is decided by the program from the edit, never from the model's words. (This is what makes a prompt-injected document harmless: it
  can at most put a marked change in front of a person.)

**What leaves the machine, and what it costs**

- [ ] AC-14. Before the first use of a profile, and again when the profile or the set of added documents changes, the panel states in plain words **where the content goes** (the agent's own service or the endpoint of the
  profile, by name) and what is sent (AC-09), and waits for the person's confirmation. Choosing a local agent or model does not remove the statement. The confirmation is not remembered across profiles.
- [ ] AC-15. Each answer shows the tokens and cost of the call when the runner reports them, and "unknown" when it does not (`AGENTS.md`: no invented numbers). A request that would exceed a bound on the size of
  the sent text (C-06) is refused before it is sent, naming what to remove.
- [ ] AC-16. A call has a timeout and can be cancelled by the person; a cancelled or failed call leaves the draft untouched and says why in plain words. A model that is not installed, not logged in or not reachable
  is reported as such, not as an empty answer.

**What is kept**

- [ ] AC-17. The conversation lives in the page for the session and is not written to disk by Indaba. Nothing of it is in a trace, an event or a log line except counts (calls, questions, edits proposed and accepted,
  high-impact edits accepted) as span attributes (AC-18). The text sent to or received from the model is in no log.
- [ ] AC-18. The span of an assistant call carries `indaba.assistant.profile_kind` (`agent` or `service`), `indaba.assistant.questions`, `indaba.assistant.edits_proposed`, `indaba.assistant.edits_accepted` and
  `indaba.assistant.high_impact_accepted`. It carries no prompt, no answer, no path and no key.

**Interfaces**

- [ ] AC-19. The server offers the assistant as resources next to the editing resources (token-protected like the rest, `web-app` AC-18): list profiles, start a session, send a message, answer a question, cancel,
  accept (all, some, or one high-impact edit). They run only for a draft inside a served root. A request that names a path outside the roots is refused.
- [ ] AC-20. The logic is in `@indaba/engine` and is independent of the page: the same functions are what a TUI or the CLI would call later. The page owns only the words it shows (`web-app-actions` AC-14 style
  message catalogue) and the confirmation steps.
- [ ] AC-21. A profile whose runner is a plugin's takes part through the same contracts (extensibility rule): the assistant asks the catalog what a runner is and starts it through the `Runner` contract; a
  built-in has no way the plugin lacks.

## 4. Non-goals

- A guided wizard with a fixed sequence of questions and templates for non-developers, and "execute a spec" or "review a spec" templates: that is the paid wizard (C-01). This assistant has no fixed sequence.
- Choosing a model for the person, or shipping a model, a key or a default service.
- Running the workflow, saving it, or starting anything: the person's actions only.
- The assistant editing anything but the open draft: not a skill, not a spec, not another file, not `indaba.config`.
- Remembering conversations across sessions, or learning from them.
- Letting the model call tools, read the project, or browse (AC-10). Improving the proposal by letting the model run `validate` itself is not needed: the program does it (AC-12).
- Authenticating the content of added documents, or judging whether they are safe. They are data, and AC-13 bounds the harm.
- Workflows depending on other workflows (the paid connected workflows).

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| no profile chosen | the panel explains how to enable it; nothing is sent (AC-01) |
| the profile's model is missing, not logged in or unreachable | a plain-word reason; the draft is unchanged (AC-16) |
| the model returns text that is not the closed structure | refused with a reason; nothing applied (AC-10, AC-11) |
| an edit names an unknown path or the wrong type | the whole proposal is rejected (AC-11) |
| the proposal is invalid after applying it to the copy | shown as invalid with the problems; at most one repair attempt (AC-12) |
| the model asks a question that fails `checkQuestion` | not shown; one repair attempt, then the request ends with a reason (AC-06) |
| more than 5 questions | the assistant must propose with assumptions stated (AC-06) |
| the person does not answer | nothing changes (AC-06) |
| an added document contains instructions | treated as data; a resulting dangerous edit is still marked and needs its own acceptance (AC-09, AC-13) |
| the sent text would exceed the bound | refused before sending, naming what to remove (AC-15) |
| the person cancels or the call times out | the draft is untouched (AC-16) |

## 6. Security and data handling

- The model's output never has authority. It is parsed into a closed set of edits (AC-11), validated on a copy (AC-12), shown as a diff (AC-05), and applied only by the person; the edits that matter for safety are
  classified by the program and accepted one by one (AC-13). A model that has been steered by the project's documents can at best propose a marked change.
- The assistant runs without tools (AC-10): it cannot read a file, run a command or reach the network except through the one call to the model the person chose.
- Content goes only to the profile the person chose and confirmed (AC-14). A service key comes from the environment and is in no file, response, log or span (AC-03, AC-18). The conversation is not stored
  by Indaba (AC-17).
- The context pack contains documentation, a schema and a catalog: no secret and no path of the person (AC-08). Added documents are the person's choice and are listed before sending.
- All text from the model and from added documents is shown as text. Paths of added documents are confined to the served roots.

## 7. Where it lives

- `@indaba/core` (pure): the closed shapes of an assistant message and an edit proposal (`AssistantReply`, `ProposedEdit`), `classifyEdit` (AC-13), the size bounds as constants.
- `@indaba/engine`: the session (`AssistantSession`), the context pack builder (`buildContextPack`), proposal parsing and validation on a copy, the call through a `Runner` at `read`, the high-impact classification
  applied to the edits of `workflow-editor`.
- `indaba` (CLI): the `assistant` section of `indaba.config` and its validation.
- `@indaba/server`: the resources of AC-19.
- `@indaba/web`: the panel, the diff and the list of changes, the one-by-one acceptance of high-impact edits, the confirmation of AC-14, the words.

## 8. Clarifications

All of these are **recommended; the maintainer confirms**.

- **C-01. Free assistant, paid wizard.** The maintainer decided on 2026-10-22 that editing is free and the wizard (a guided sequence with templates) is paid, and on 2026-10-23 that this assistant is free. The line: the assistant
  is free-form, works on a draft that is already open, has no templates and no fixed questions, and is an option the person turns on with a model of their choice; the wizard creates a workflow through a fixed sequence for a person who
  does not write files. If they ever overlap in a screen, the wizard uses this assistant's contracts, not the other way round, so nothing paid is needed to use the free feature.
- **C-02. Why a closed list of edits.** A model asked to "give me the YAML" returns a whole file, which hides what changed and makes the high-impact check a text-diff problem. A list of the forms' own
  operations is small, can be shown edit by edit, and is classified by the program (AC-13).
- **C-03. Why accept-all excludes the high-impact edits.** Without this, the first prompt-injected document would be a way to `full` access. This is the lesson of the reviews of `review-gate` and
  `agent-permissions`: what a model can influence must never become an approval.
- **C-04. Why the pack is built from shipped files.** A model that is told the format from memory invents fields. Building the pack from the installed version's own documentation, schema and catalog keeps
  it true for that version and costs no network. Which docs are shipped inside the packages is a packaging decision of the implementation (`security-guard` skill).
- **C-05. Why a profile is configuration, not part of a workflow.** The model that helps edit a file is the editor's business, not the workflow's; two people editing the same file may use different models, and a
  key must never travel with a file.
- **C-06. Numbers that are guesses.** 5 questions per request, and the size bounds of the sent text and of the pack, are design choices that are not measured; they are named constants in `api-surface.md` and revised
  when real sessions exist.
- **C-07. Questions without a channel.** The panel talks to the person directly, so it does not need `agent-conversation`; it reuses only the shape and the check of `question-contract`.
- **C-08. Honest limits.** The assistant makes valid files, not necessarily good ones: it can propose a wrong goal text. The diff and the person's reading are the check, and `validate` is not a judgement of quality.
- **C-09. Other specs are changed by their owners.** `specs/web-app` (C-19) and `specs/web-app/plan-step-3.md` ("Later") belong to the web-app work and are updated there when this spec is accepted; this change lists
  the amendments in `api-surface.md` and edits neither.

## Artifacts not written

- `plan.md`: `tasks.md` is the order of work.
- `research.md`: no external fact is relied on; the models are the person's choice.
- `data-model.md`: nothing is stored; the shapes are in `api-surface.md`.
- `events.md`: no event; the span attributes are in `api-surface.md`.
