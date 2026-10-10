# Specification: Step verdicts and bounded review loops

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 3 (decisions in section 8 are recommended; the maintainer confirms)
> **Semver impact**: minor (one new optional step field and a new span attribute family; below 1.0)
> **Siblings**: `specs/step-budgets` (every review iteration counts against a budget) and
> `specs/step-variants` (a verdict belongs to the winning variant). Both are drafts written alongside this one.
> **Builds on**: `specs/agent-mesh` (the `AGREEMENT` / `CRITIQUE` reply vocabulary), `specs/workflow-engine`
> (`on_failure`, retry isolation, `StepStatus`), `specs/debate-arbiter` (the escalation path).

---

## 1. The problem

A workflow author cannot express "a reviewer looks at the work and either approves it or sends it back to be
changed". Today a step either succeeds or fails, and the only loop Indaba has is `on_failure: retry_step`, which
reacts to a *failure*. A reviewer that finds problems has not failed: it did its job, and its answer is a
judgment, not an exit code. The author's options are:

- run the reviewer and a `shell` step that matches text in its answer, so each workflow invents its own fragile
  convention, and the next prompt is whatever the match printed; or
- use a debate (`consensus_with`), which is a conversation: nobody changes a file between rounds, and a debate
  that fails ends in an arbiter, not in a bounded rework of an earlier step.

Indaba already has a vocabulary for exactly this judgment. A debate reply starts with `AGREEMENT` (approve as it
stands) or `CRITIQUE` (changes required), and only `AGREEMENT` counts as approval. What is missing is a way for a
*single step* to return that judgment and have the engine act on it: continue on agreement, and on a critique send
the run back to a step that can change the work, a bounded number of times, then hand it to a person.

## 2. User stories

- **US-01.** As a workflow author, I mark a reviewer step as a review and say which earlier step a critique goes
  back to and how many times, so that a review loop is written in the workflow file and not in a script.
- **US-02.** As a workflow author, I know that a reviewer that never approves ends the run `escalated`, instead of
  looping or spending without limit.
- **US-03.** As a person running a workflow, I see in the trace which verdict a review step returned, which
  iteration it was, and where it sent the run.
- **US-04.** As the author of a plugin runner, I do nothing: the verdict is read from the reply text any runner
  returns, so every runner, built-in or plugin, API or CLI, read-only or not, can review.
- **US-05.** As a developer embedding the engine, I get the reply parser as a pure function I can test, and a run
  still ends in one of the four existing statuses.

## 3. Acceptance criteria

- [ ] AC-01. A step may declare `review`, a map with two optional keys: `send_back_to` (a step id) and
      `max_iterations` (an integer from 1 to 10). `send_back_to` and `max_iterations` come together: either both or
      neither. `send_back_to` must name the step itself or one of its ancestors (the rule `on_failure.target`
      already has).
- [ ] AC-02. `review` is allowed only on an agent step (one with a `role` or a non-`shell` `runner`) that is not a
      debate. On a `shell` step, or on a step with `consensus_with` or `decision_type`, it is a validation error
      naming the step and the reason.
- [ ] AC-03. The engine reads the verdict from the step's reply by one strict protocol (section 5.1), built on the
      `AGREEMENT:` and `CRITIQUE:` words the mesh already uses. A reply with no tag, with both tags, or empty is a
      failed step whose feedback states the protocol; `on_failure` applies as for any failure.
- [ ] AC-04. On `agreement` the step completes and the run goes on. On `critique` with `send_back_to`, the target and
      every step after it are reset and run again, exactly as a `retry_step` failure does today. On `critique`
      without `send_back_to`, the step ends `ESCALATED` and the run `escalated`.
- [ ] AC-05. A reply can only be one of two verdicts. It can never name a step, an action, a target, a number or a
      path; those come from the workflow file alone.
- [ ] AC-06. The verdict is read only after the step's `outputs` exist and its guards pass. A step whose output is
      missing or whose guard fails is a normal failure, and any verdict it printed is ignored.
- [ ] AC-07. Retry-loop isolation holds. The target's next prompt carries only the reason of the *last* critique
      (the text from its tag to the end of the reply, cut to its first 4000 characters, redacted as failure feedback
      is), never an earlier iteration's reason and never the reviewer's whole reply.
- [ ] AC-08. Each review step has one counter, never reset during a run. When `max_iterations` re-runs have been
      sent and the reviewer critiques again, the step ends `ESCALATED` and the run ends `escalated`, with a reason
      naming the step and the limit. The most a review step can send the run back is therefore `max_iterations`
      times, and `plan` prints the resulting bound.
- [ ] AC-09. No new `StepStatus`. A critique that sends the run back moves the step `VALIDATING` to `FAILED`
      (then the existing re-arm to `PENDING`); escalation moves it `VALIDATING` to `ESCALATED`; agreement moves it
      `VALIDATING` to `COMPLETED`. The reason text carries the verdict and the iteration number, not any agent text.
- [ ] AC-10. The prompt of a review step ends with a section stating the protocol. A step without `review` has a
      byte-identical prompt to today.
- [ ] AC-11. The step span records `indaba.verdict`, `indaba.verdict.action`, `indaba.verdict.iteration` and
      `indaba.verdict.max_iterations`; a reply with no usable verdict records `indaba.verdict.invalid` with a fixed
      code. No attribute and no event holds agent text.
- [ ] AC-12. `indaba plan` shows each review step's routing and the loop bound.
- [ ] AC-13. The parser is a pure function in `@indaba/core` (no `node:` import, no clock, no randomness). The
      mesh's own reply parser and every debate behave exactly as before.
- [ ] AC-14. A cancelled run is cancelled whatever the step printed: the verdict is not read once the signal is
      aborted.
- [ ] AC-15. When `specs/step-budgets` lands, an iteration that exhausts a budget ends the run `escalated` before
      the verdict is routed, and every iteration counts. When `specs/step-variants` lands, only the selected
      variant's verdict is routed (section 8, C-09).

## 4. Non-goals

- A `loop` node, an `if` node or any graph node type. See C-01 for why not.
- More than two verdicts, custom labels, scores, or branching on an expression. A review answers "acceptable or
  not"; ranking and scoring are `specs/voter-arbiter`.
- A verdict that selects *which* step runs next, or one that crosses steps ("the verdict of A feeds a condition on
  B"). Routing is declared by the review step and names an ancestor.
- Dynamic step creation, or a send-back target that is not an ancestor or the step itself.
- Treating a debate's outcome as a verdict. A debate ends in agreement, a ruling or escalation
  (`specs/debate-arbiter`); the two never mix, and a step cannot have both (AC-02).
- Changing how the mesh reads a debate reply. Its parser is more lenient than a gate should be (C-03) and stays
  as it is.
- A verdict taken from a person, a file or a tool call. A person's verdict is the arbiter and ruling-channel
  specs' job; the routing here does not care where a verdict came from (C-02).
- Making the verdict tamper-proof. It is the agent's own judgment (section 6), exactly as trustworthy as the agent.
  Where that matters, put a guard or a second reviewer behind it.

## 5. Behaviour

### 5.1 The protocol

The reply (the runner's `output`) is read line by line, at most the first 262144 characters; a longer reply is an
invalid verdict. A line is a *tag line* when it starts at the first column with exactly `AGREEMENT:` or exactly
`CRITIQUE:`: capitals, the colon, nothing before it (no indentation, bullet, quote, bold or bracket).

- no tag line: invalid (`missing`);
- tag lines of both kinds: invalid (`conflicting`): an approval is never granted next to a critique;
- only `AGREEMENT:` lines: the verdict is `agreement`;
- only `CRITIQUE:` lines: the verdict is `critique`, and its reason is the text from the first such line (without
  the tag) to the end of the reply, trimmed.

Narration before the tag line is allowed and ignored, which matters for agents that think aloud before answering.
No regular expression is built from the reply, and nothing but the two fixed prefixes is matched.

### 5.2 Order of work for one step

1. The agent runs (fallback, retries and budgets as today).
2. Its declared `outputs` are checked and its guards run (`validate`).
3. Only then is the verdict read from the reply kept from step 1, and routed.

### 5.3 Failure

| Situation | Expected behaviour |
| :--- | :--- |
| the runner fails or cannot run | as today; no verdict is read |
| no tag line, both kinds of tag line, an empty reply, or a reply over the limit | the step fails with feedback stating the protocol (never the reply); `on_failure` applies, and with none the run fails |
| the declared outputs are missing or a guard fails | a normal failure; the printed verdict is ignored |
| `critique`, `send_back_to` set, iterations remain | the target and its descendants are reset to `PENDING`; the target's next prompt carries the last critique |
| `critique`, `send_back_to` set, no iteration remains | the step ends `ESCALATED`; the run ends `escalated` with a reason naming step and limit |
| `critique`, no `send_back_to` | the step ends `ESCALATED`; the run ends `escalated` |
| two steps send feedback to the same target in one pass | the later one wins, as with `on_failure` today; there is one feedback slot per target |
| the run is cancelled | `cancelled`; nothing is read or routed |
| the process dies midway | nothing is persisted between runs; the next run starts at iteration 1 |

## 6. Security and data handling

- The reply is **untrusted**, and a prompt-injected agent can print any line. The design keeps that harmless: the
  verdict is one of two fixed words, matched at fixed positions; it selects between *continue* and *the send-back
  the workflow file declared*. It cannot choose, add or skip a step, raise a limit, or reach a path, a shell or a
  URL.
- What an injected agent *can* do is approve, or critique, wrongly. That is the agent's judgment being wrong, not
  a new capability. A workflow whose approval unlocks something sensitive must not rest on one agent's word; add a
  guard or a debate (`consensus_with`) in front of it. Failing closed on a mixed reply (C-04) means quoted
  untrusted text can turn an approval into a critique, never a critique into an approval.
- The critique text goes into another agent's prompt. That is the channel `on_failure` already uses, with the
  same redaction; it is never written to a trace, event, ledger or exception.
- The matcher is two `startsWith` checks per line over a bounded input: no backtracking, no pattern built from
  input.

## 7. Where it lives

- `@indaba/core` (pure): `ReviewDefinition`, `StepDefinition.review`, `ReviewVerdict`, `parseReview`,
  `reviewProtocolReminder`, the constants, the span attribute names.
- `@indaba/engine`: parser and validator (field paths, the rules above), `PromptBuilder` (the review section),
  `StepExecutor` (reads the verdict after `validate`), `WorkflowEngine` (routes; the counter lives beside
  `retries`).
- `indaba` (CLI): `plan` output only.
- `@indaba/runners`: nothing. Runners return text.

## 8. Clarifications

All of these are **recommended; the maintainer confirms**.

- **C-01. No `loop` node.** Recommended: do not add one. Indaba's acyclic graph is load-bearing. `DagBuilder`
  rejects cycles, `plan` is a static topological listing, the state machine has terminal states, the trace and the
  TUI assume an order, and a run's worst-case cost can be read from the file. A `loop` node would add a second way
  to write a cycle, with its own cap, and let a cycle pass through a non-ancestor, which makes termination and
  isolation harder to prove. `retry_step` already is "rewind to an ancestor, bounded", and it re-runs descendants
  with a clean state; a review only changes *what triggers it*. What this gives up: jumping to a step that is not
  an ancestor, and general graph shapes. Revisit only if `fork`/`join` arrive.
- **C-02. Where the verdict comes from: the reply text, in the mesh's own words.** Four existing mechanisms were
  weighed:
  - *A structured output file* the step must produce (`outputs`). Rejected: a reviewer is often read-only
    (`permissions` with no write) or a text-only API runner, and cannot write a file at all; the worktree persists
    across retries, so a stale file from the previous pass would be read as the new verdict unless the engine
    deleted it first; and the file would sit in the exported patch or trip `diff_within_scope`.
  - *A guard.* Rejected: a guard inspects the working directory, not the reply, and it turns "changes
    requested" into a *failure*, which shares `max_retries` with real failures and loses the distinction in the
    trace.
  - *A debate step.* Rejected as the carrier: a debate is conversation only (nobody edits between rounds) and a
    failed one ends in an arbiter, not in a bounded rework of an earlier step. Its *vocabulary* is reused.
  - *An arbiter or ruling.* Not the carrier (it decides a stalled debate, with a person or voters), but compatible:
    routing here does not care where a verdict came from, so a later change can let a person or an adjudicator
    supply it. That is left out on purpose.
  The reply text works for every runner and mode, needs no file, no permission and no clean-up, and the words
  `AGREEMENT:` / `CRITIQUE:` are already what the review-debate example and the debate prompt tell reviewers to
  write.
- **C-03. A stricter reader than the mesh's.** The mesh's `AgentMessage` parser is case-insensitive, tolerates
  brackets, bold and a missing colon, and a reply such as "Agreement is not reached" parses as `AGREEMENT`. That is
  acceptable for a debate whose arbiter and rounds catch mistakes, and not for a gate that routes a run. The
  review parser is separate and strict (5.1). The mesh parser is left alone (changing it would change debate
  behaviour). The leniency itself is a candidate for its own change.
- **C-04. Fail closed.** A reply with both a `CRITIQUE:` and an `AGREEMENT:` line is invalid, not approved. Quoting
  untrusted text that starts a line with `CRITIQUE:` can therefore only slow a run down.
- **C-05. Two verdicts, not a label set.** Review loops need "acceptable" and "not acceptable". Custom labels
  would bring a handler map, a missing-handler error class and a reason to branch the graph. If a third verdict is
  ever needed it is a new, separate decision.
- **C-06. An invalid reply is a failure that `on_failure` handles.** No new status, no special counter: the author
  who wants a second try writes `on_failure: retry_step` on the reviewer, with the protocol reminder as feedback.
  Without `on_failure` the run fails, which is the honest result.
- **C-07. Separate counter.** `max_iterations` does not share `max_retries`: "three failures" and "three review
  rounds" stay distinguishable. The bound of re-runs of a target is `max_retries` plus the sum of `max_iterations`
  of the review steps that send back to it, and `plan` prints it. `max_iterations: 3` allows three re-runs, so up
  to four passes of the reviewed work; the first pass is not an iteration.
- **C-08. The reason is the critique text.** It is the first 4000 characters from the tag line on (a critique leads
  with its most important findings, so the head is kept, unlike a failure log, whose tail is). It is a cut of the
  existing feedback slot, not a new channel.
- **C-09. Step variants.** With `step-variants`, a variant's verdict is *held*, not routed; the selector picks a
  winner and only the winner's verdict is routed and counted. Losers' verdicts are recorded in the variant artifact.
- **C-10. Step budgets.** A review re-run is an attempt like any other. A budget is checked before a verdict is
  routed, so an exhausted budget ends the run `escalated` with the budget as the reason, not with an iteration.
- **C-11. Span status of a routed verdict.** The step span ends with an error status when the step moves to
  `FAILED` or `ESCALATED` (including a critique that sends the run back), and `OK` when it completes. The
  `indaba.verdict.*` attributes tell a review round from a crash.
- **C-12. The field is `review`, with no verdict list.** There is nothing to declare but the routing, so the
  smallest surface is one optional map on a step. The spec directory keeps the name `step-verdicts`.

## Artifacts not written

- `research.md`: the alternatives are weighed in C-02 and there is no external protocol or library to study.
- `data-model.md`: nothing is stored. The counter lives in memory for one run; no file is written or read.
