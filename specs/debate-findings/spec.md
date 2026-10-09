# Specification: Debate findings and prompts

> **Status**: Draft
> **Stage entry**: 1
> **Semver impact**: minor. Stacked on `specs/debate-arbiter` and `specs/voter-arbiter`, neither merged, so
> every behaviour this changes is still unreleased; the classification would be a major if they had shipped.

---

## 1. The problem

When a debate fails, the only thing Indaba can say about it is *who agreed* and *which files were named*
(`specs/voter-arbiter`). It cannot say how much the open disagreement matters: two reviewers who still differ over
a cosmetic point and two who differ over a data-loss bug look the same. The agents know the difference, but
nothing asks them to say it, and replies are free text, so there is nothing to compute from. The same free text
means a person who wants a ranked list of what a review found has to read the whole transcript.

Separately, the prompt a debater sees is a few lines hard-coded in `RunnerParticipant`, with no way to improve it
or to replace it for one step.

## 2. User stories

- **US-01.** As a workflow author with an arbiter, I want the debaters to rate each finding's importance, so the
  voters can tell a minor disagreement from a serious one.
- **US-02.** As a person reading a review, I want the findings in one ranked list per debate, not buried in a
  transcript.
- **US-03.** As a workflow author, I want to replace the built-in review prompt for one step with my own, or turn
  Indaba's additions off, and be told plainly what I lose when I do.
- **US-04.** As a plugin author, I want to register prompts by name the way I register runners and voters.

## 3. Acceptance criteria

- [ ] AC-01. A reply may contain finding lines of the form `FINDING [n] text`, with `n` an integer from 1 (cosmetic)
  to 5 (must fix before shipping), one per line, case-insensitive, optionally after `-` or `*`. `AgentMessage`
  can list its findings (importance and text); a line with a missing or out-of-range number is ignored and counted.
  At most 50 findings are read from one message.
- [ ] AC-02. Prompt additions are **on** for a debate step that has an `arbiter`, and **off** otherwise. A step can
  say `prompt_additions: on` or `off`; `defaults.prompt_additions` sets it for the workflow; the step wins.
- [ ] AC-03. When on, the debate prompt gains a section, between the topic and the discussion, that tells the agent
  how to report findings (the format, the scale, to restate only the findings it still stands by, and that the
  numbers are its own honest opinion). The reply-protocol keywords are unchanged. When off, the prompt is
  byte-for-byte what it was before this feature.
- [ ] AC-04. A step can name its prompt with `prompt: <name>`. `debate-review` is built in and is the default when
  additions are on. A name nobody registered fails the step at run time listing the registered names. A plugin
  registers a prompt with `host.registerPrompt(name, text)`; a duplicate name is an error unless
  `{ replace: true }`, which is how a built-in is overridden. Built-ins register through the same call.
- [ ] AC-05. A prompt is plain text. It has no placeholders and no interpolation, so nothing from a workflow, a
  model or a file can change what it says.
- [ ] AC-06. `indaba validate` and `indaba plan` print a warning for a step that has an arbiter and
  `prompt_additions: off`: that voters needing findings will abstain and no findings file is written. The span
  records `indaba.prompt.additions` (`on` or `off`) and `indaba.prompt.name` for every debate step.
- [ ] AC-07. A new built-in voter, `importance`, scores the worst finding still open: among the latest messages that
  are not `AGREEMENT`, take the highest importance `w`; the score is `10 * (5 - w) / 4`. It abstains if no
  such message has a finding, saying so. Its reason states `w`, how many findings it counted, and how many
  malformed lines were ignored. It joins the built-in voters (the default `use` list).
- [ ] AC-08. When additions are on, the debate step writes `.indaba/artifacts/<step-id>.findings.md`: every finding
  from the latest message of each participant, sorted by importance (highest first), then by participant, each with
  who raised it and the files it mentions; files mentioned by every participant are listed as agreed. Text is
  cleaned and redacted like the transcript. It is written whatever the outcome of the debate.
- [ ] AC-09. The ledger key now includes the prompt text in force (name and content), so changing the prompt, or
  turning additions on or off, asks again instead of reusing a ruling made under a different prompt.
- [ ] AC-10. The span records the number of findings counted and the highest importance
  (`indaba.findings.count`, `indaba.findings.max_importance`), labelled in the documentation as agent-reported.
  No finding text is in a span.
- [ ] AC-11. Retries are unchanged: the prompt is the same static text every round, never an accumulated history.
- [ ] AC-12. Every new line is covered by tests; the 85% floor holds.

## 4. Non-goals

- Prompts for steps other than the debate (implement, spec, verify). The library is built for the debate first;
  the registry is general, so other kinds can follow.
- Confidence scores, or any number besides importance.
- Matching findings across participants by meaning. Agreement is by file mentioned, as in `specs/voter-arbiter`.
- Verifying an agent's importance rating. It is an opinion, labelled so everywhere, never a measurement.
- Interpolation, includes or conditionals inside a prompt.
- Reading a prompt from a file in the project. A plugin can do it; Indaba does not (see section 6).

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| an agent ignores the format | its message has no findings; `importance` abstains if no latest message has any |
| an agent gives `FINDING [9]` or `FINDING [x]` | the line is ignored and counted in the voter's reason |
| an agent lists more than 50 findings | the first 50 are read |
| `prompt:` names an unregistered prompt | the step fails, listing the registered names |
| `prompt_additions: off` with an arbiter | the run proceeds; the validation warning says what is lost |
| a custom prompt never asks for `FINDING` lines | `importance` abstains and no findings file lists anything; the other voters still work |
| the findings file cannot be written | the step fails with the path and the error |

## 6. Security and data handling

Findings are model output and untrusted. They are parsed by a fixed pattern on bounded input and used only as
text and as a number from 1 to 5. Their text reaches the findings file and the terminal after cleaning and
redaction, and never a span. A prompt is plain text chosen by the workflow author or a plugin; there is no
interpolation, so nothing can be injected into it. Reading prompts from project files is excluded deliberately: a
prompt is instructions to an agent that may hold tools, so one loaded from a file in a repository that is being
reviewed could be changed by the very change under review.

**What the numbers mean.** Importance is what an agent says. Agents can inflate it, under-rate their own findings,
or follow the format badly. The `importance` voter therefore measures how serious the debaters themselves think
the open disagreement is, not how serious it is. The documentation says this, and the voters' reasons say
"agent-reported".

**Why the prompt is altered at all.** An arbiter can only be as good as what it can read. Asking for a fixed
format costs a few lines of prompt and is what lets Indaba rule or rank at all. Turning it off is allowed and
described in the documentation, in `validate`, and in the trace.

## 7. Where it lives

- `@indaba/core` (pure): `Finding`, `AgentMessage.findings()`, the prompt text of `debate-review`, the prompt
  registry, the `importance` voter, the extra section in `RunnerParticipant`, `PluginHost.registerPrompt`, and
  the step and defaults fields.
- `@indaba/engine`: parsing and validating the fields, resolving which prompt applies, the validation warning,
  the findings file, the ledger key, the attributes.
- `indaba` (CLI): registers the built-in prompt through the plugin host.

## 8. Clarifications

Resolved with the maintainer:

- Additions are on only when the step has an arbiter; they can be turned off, with the consequences documented.
- Agents report one number per finding: importance, 1 to 5.
- The library is for debate prompts, overridable.

Defaults chosen here, inherited by every consumer:

- The scale is 1 to 5, with 5 as most important, because "5 = must fix" reads naturally in a prompt.
- The mapping from the worst open finding to a score is linear. It is a design choice, not calibrated.
- "Open" means: stated in a participant's latest non-agreement message. The prompt tells agents to restate only
  what they still stand by, so a withdrawn finding drops out.
- Informing the user is done by a `validate`/`plan` warning, a trace attribute and the documentation. There is no
  interactive confirmation: a run may have no terminal.
- `FINDING` is a new keyword inside a reply and does not replace the leading keyword (`CRITIQUE:` and the rest).

## Artifacts not written

- `research.md`: the options were weighed in conversation; nothing depends on outside facts.
- `data-model.md`: the shapes are in api-surface.md; there is no state beyond one message's findings.
- `events.md`: no event is added; the span attributes are listed in api-surface.md.
