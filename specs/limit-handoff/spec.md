# Specification: Limit handoff (continue on another agent, or wait, when a subscription limit stops one)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are confirmed or decided; none is open)
> **Semver impact**: minor (below 1.0): new optional field `on_limit`, new optional member `RunResult.limit`, new
> optional contract, new events and attributes. The default (`fail`) keeps today's behaviour. Confirmed in
> [`api-surface.md`](api-surface.md).
> **Builds on**: [`specs/transport-priority`](../transport-priority/spec.md) (runner lists, "could not run" versus "ran
> and failed", span events), [`specs/step-budgets`](../step-budgets/spec.md) (money ceilings, the resume question),
> [`specs/ruling-channel`](../ruling-channel/spec.md) (asking a person), [`specs/git-workspace`](../git-workspace/spec.md)
> (the worktree a step works in).
> **Origin**: a comparison with Sol-83 (2026-11-12), whose main promise is that a project continues on another
> model when the first one's subscription limit is reached.

---

## 1. The problem

A person who runs Indaba on cheap subscriptions (Claude, ChatGPT, Gemini through their CLIs) meets a limit that is not
money: a window of about five hours and a weekly cap. When an agent hits it, the run is stopped halfway through
a step. Today that looks like any other failure:

- a CLI runner that exits with "limit reached" returns a failed `RunResult`. `transport-priority` AC-02 says a failed
  result is **not** a reason to fall back, so the chain does not move on, `on_failure` retries into the same wall,
  and the step ends `failed` with a message nobody can act on programmatically;
- a later step of the same run calls the same exhausted agent again and fails the same way, after spending time;
- `step-budgets` stops a run at a spend ceiling in money. A subscription has no per-call price and a reset time that
  is not a ceiling the person set, so that mechanism does not apply;
- the person cannot say "when Claude is out, go on with Codex" or "wait until it resets", and Indaba cannot tell
  "this agent is out until 14:00" from "this agent crashed".

The result is that long runs, the ones Indaba is built for, die at the moment a plan with a small limit is used up,
and the person has to find that out and start again by hand.

## 2. User stories

- **US-01.** As a workflow author, I say per step what happens when an agent's limit is reached: stop (as today),
  continue on the next runner of the step's list, or wait for the reset.
- **US-02.** As a person running a workflow, I see that an agent hit a limit, when it resets if the agent said so, and
  which agent took over, in `indaba watch`, the TUI and the trace.
- **US-03.** As a person running a workflow, a later step does not call an agent that is known to be out until its
  reset, so no time is lost on a call that will fail.
- **US-04.** As a person without a second agent, I choose to wait for the reset, within a bound I set, and the run
  continues when it comes.
- **US-05.** As a developer embedding the engine, I report a limit from my own runner (an API 429 with a reset
  time, a CLI message) and it takes part in handoff and waiting like a built-in.
- **US-06.** As a person who reads the run afterwards, I can tell a limit from a failure, and I see only what the
  agent actually reported: no invented reset time.

## 3. Acceptance criteria

### Detecting a limit

- [ ] AC-01. A limit is a distinct outcome, not a failure: `RunResult` carries an optional `limit` (kind, optional
      reset instant, how it was recognised). A runner that ran and hit a limit returns a result with `limit` set and
      `exitCode` as before; a runner that hit it before the agent was given the prompt throws `RunnerLimitError`
      (a `RunnerUnavailableError`, so the existing fallback of `transport-priority` already applies).
- [ ] AC-02. Kinds are `session` (the short window), `weekly`, `rate` (a per-minute or per-request throttle) and
      `unknown`. A runner that cannot tell which uses `unknown`.
- [ ] AC-03. A runner reports the reset instant only when the agent or the API gave one (a structured field or a
      header such as `Retry-After`). It never computes one from "about five hours", and never fills one from a text
      pattern it had to guess. `limit.resetsAt` absent means unknown, and every consumer treats it so.
- [ ] AC-04. Recognition prefers structured signals (an API status and header; a field in an agent's structured output
      stream) over text. A match on free text is allowed only for a runner with no structured signal, is marked
      `source: 'text'`, and uses an anchored pattern set that is data in that runner, covered by a test per pattern
      against a recorded sample.
- [ ] AC-05. A false positive is bounded: a limit is recognised only on a non-zero exit, a failed stream or an error
      status, never from text in a successful answer (an agent writing about limits in a report is not a limit).
- [ ] AC-06. Classification is a pure function in `@indaba/core` of a plain description of the signal (status,
      headers, exit code, structured event, tail of text), so it is tested without any agent.

### What the engine does

- [ ] AC-07. A step or role has `on_limit`: `fail` (default), `handoff` or `wait`. `fail` is today's behaviour: the
      step fails, now with the limit recorded in the failure.
- [ ] AC-08. `handoff` moves to the next runner of the step's `runner` list, the same list `transport-priority`
      defines, so no second list exists. A list of one entry with `handoff` is a validation error at parse time, with
      the field path.
- [ ] AC-09. The runner that hit the limit is put in a run-scoped ledger as *cooling* until `resetsAt`. With no
      `resetsAt`, it is cooling for the rest of the run. Every later step, and every speaker of a consensus step,
      skips a cooling runner without calling it and records a skip event with the reason.
- [ ] AC-10. A cooling entry whose `resetsAt` has passed on the injected clock is tried again, in its original
      position in the list.
- [ ] AC-11. `wait` suspends the step until `resetsAt`, through the wait the question contract and ruling channel
      already provide, bounded by `max_wait` (seconds). With no `resetsAt`, or a reset later than `max_wait`, the step
      does not sleep: it asks the person (continue on another runner, wait anyway, or stop), and with no terminal to
      ask it ends `escalated`, as an unsettled debate does today.
- [ ] AC-12. `max_wait` has no unbounded form. Its default is 0, which means "ask now"; a workflow that wants to
      wait for hours writes the number.
- [ ] AC-13. Every runner of a list is tried at most once per step for a limit. When every runner is cooling or has
      hit a limit, the step ends with one error naming each runner, its kind and reset instant (when known), with no
      secret in it. No loop around the list.
- [ ] AC-14. Handoff does not reset the worktree. The next runner gets the original prompt plus a **handoff note** the
      engine builds, listing only the paths the previous runner changed (from the worktree's diff, confined to the
      worktree) and saying it stopped before finishing. It carries no output of the previous agent. See clarification 3.
- [ ] AC-15. A limit is not a failure for the retry budget: it does not consume a `max_retries` attempt and does not
      feed the next prompt as "the last failure". A handoff counts toward the step's wall-clock timeout and toward
      `step-budgets` ceilings as any other call.
- [ ] AC-16. A guard still runs after a handoff step, on the final worktree, exactly as for a step that never hit a
      limit. A limit never makes a guard pass.

### Seeing it

- [ ] AC-17. The step span records a `indaba.runner.limit` event per limit (kind, `resetsAt` when known, source) and an
      `indaba.runner.handoff` event naming the runner left and the runner taken. Waiting records a start and an end
      event with the seconds waited.
- [ ] AC-18. `indaba watch`, the TUI and the web view show a step in a limit state with the reset time when known, and
      the handoff. The state is derived from the events, not a new step status the engine must persist (clarification 5).
- [ ] AC-19. `validate` rejects an unknown `on_limit` value, a negative or non-integer `max_wait`, `max_wait` without
      `on_limit: wait`, and `handoff` with a one-entry list, at parse time.
- [ ] AC-20. A third-party runner that never sets `limit` behaves as before. A plugin runner that sets it takes part in
      handoff and waiting with no privileged access (AC-08 of `transport-priority` holds).

## 4. Non-goals

- **Predicting a limit.** Reading a usage meter, a `/usage` screen or a percentage, and handing over at a threshold
  before the limit is hit. It is a plausible follow-up; here a limit is acted on after the agent reports it. A
  predictor would scrape provider screens that change between CLI releases.
- **Switching accounts or credentials**, or any use of a second login on the same provider.
- **Choosing the next agent by capability, price or quality.** The order is the list the author wrote.
- **A durable queue.** A wait lives as long as the process; a run that is stopped does not resume on its own at the
  reset. Resuming a run is a separate feature (`indaba run --resume`), and the wait is written so it can use it.
- **Spreading load across agents** to avoid a limit, or racing runners.
- **Knowing a provider's plan sizes.** Indaba holds no table of "Pro gives five hours".
- **Handing the agent's reasoning or output to the next one.** Only the paths changed, and the original prompt.
- **A cost for a limited call.** Metering stays as `step-budgets` defines it; a limit adds no number.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| a limit is reported, `on_limit: fail` | the step fails; the failure carries the limit; the runner is marked cooling for later steps; `on_failure` applies as for any failure but the attempt is not counted (AC-15) |
| a limit is reported, `handoff`, another runner is free | limit and handoff events; next runner starts on the same worktree with the handoff note |
| a limit is reported, `handoff`, all others cooling | the step ends with the single error of AC-13 |
| a limit is reported, `wait`, reset within `max_wait` | the step waits; the clock decides when; the same runner is tried again once |
| the reset has passed but the agent still reports a limit | counted as a limit again; no second wait for the same runner in the step (AC-13) |
| `wait` and the reset is unknown or beyond `max_wait` | ask the person; with no terminal, `escalated` |
| the run is cancelled while waiting | the wait ends at once, nothing is started, the worktree is torn down as for any cancel |
| the process dies while waiting | the run is lost as today; nothing is claimed about resuming |
| text matching a limit appears in a successful answer | not a limit (AC-05) |
| a handoff changed files and the second runner also fails | an ordinary failure of the second runner, `on_failure` applies, the first limit stays in the trace |
| a consensus speaker's runner is limited | the same rules for that speaker's list; with none free the speaker cannot take part, and the arbiter's quorum rules decide (clarification 6) |

## 6. Security and data handling

- Everything a runner reads from an agent or an API to recognise a limit is untrusted: bounded in size, matched against
  fixed patterns or a schema, and never reaching a shell, a path or a log unredacted.
- `resetsAt` is parsed to a number and rendered by Indaba. The agent's own sentence is not copied into an event,
  because it can carry an account name, an email or a URL.
- The handoff note contains paths from the worktree's diff only. They are confined to the worktree, listed, and cut at
  a fixed count, so a prompt-injected agent cannot place text in the next agent's prompt through a file name beyond what
  the diff itself holds; names are passed as data, quoted, and a name with a control character is dropped and counted.
- Nothing about an account, a plan or a limit's wording is stored in an artifact or trace except kind, instant and source.
- See `.agents/skills/application_security/SKILL.md`.

## 7. Where it lives

- `@indaba/core` (pure): `RunLimit`, `RunResult.limit`, `classifyLimit`, `LimitLedger`, the decision
  `decideOnLimit(policy, ledger, list, now)`, `RunnerLimitError`, the `on_limit` and `max_wait` fields of the workflow
  model. No `node:` import; the clock is passed in.
- `@indaba/engine`: parser and validator for the two fields; the step executor's use of the decision; building the
  handoff note from the worktree diff; the wait through the ruling channel; the span events.
- `@indaba/runners`: each runner's signal-to-description adapter (API status and `Retry-After` for the OpenAI-compatible
  runner; exit code, structured stream and anchored text for the CLI runners; the ACP error for `acp`).
- `indaba` (CLI), `@indaba/tui`, `@indaba/web`: showing the state.
- Docs: `docs/workflow-format.md`, the runners pages, the playbooks, `llms.txt`, a short cookbook note.

## 8. Clarifications

Recommended resolutions; the maintainer confirms.

1. **Field name and shape.** `on_limit: fail | handoff | wait`, with `max_wait: <seconds>`. Not a separate list: the
   existing `runner` list is the handoff order, so one idea has one place. A workflow-level default may come later;
   per step is enough now.
2. **Default is `fail`.** Changing the default would change every existing run. A person who wants handoff writes it.
   (Revisit before 1.0, when a default can still change.)
3. **The worktree is kept on handoff.** The previous agent's finished edits are real work and throwing them away is the
   costly choice on a limit that arrives at 90%. The risk is a half-written file; the guard after the step is the
   check, and `on_failure` can still send it back. **Confirmed by the maintainer (2026-11-12).** The alternative (reset,
   restart the step) as `on_limit: restart` is not in this change.
4. **A limit does not use a retry.** The retry loop is about an agent's bad work (prompt carries the last failure). A limit
   says nothing about the work, so it neither counts nor appears in the next prompt. This keeps "retries are isolated and
   bounded" true: handoff is bounded by the list length instead.
5. **No new step status.** The limit state is derived from events, so `StepState`'s machine and every consumer of it stay
   unchanged. A waiting step stays `running` with an event; viewers read the event. **Confirmed by the maintainer
   (2026-11-12).** A status, if viewers ever need one, would be a major and a separate change.
6. **Consensus.** A limited speaker follows the same rules for its own list. If none remains, it takes no further turns
   and the arbiter's existing quorum rule decides; with a quorum that needs that speaker, the result is `escalated`.
   No special case is added to the arbiter.
7. **What "cooling" means after a run.** The ledger lives for one run. A new run starts with an empty ledger and finds
   out again: persisting it would claim knowledge of the provider's clock that Indaba does not have.
8. **First runners covered.** The OpenAI-compatible runner (HTTP 429, `Retry-After`), then `claude-code` and `codex` CLI
   runners, then ACP. Gemini and the rest only when a real sample proves a signal (T-01 is research, and the spec of any
   runner whose signal is not verified says so). Claims about what each CLI prints are **not** made in this spec.
9. **Semver of AC-15: minor.** A limit failure used to be retried into the same limit, so no workflow could depend on
   that. The visible change is the new `limit` member on the failure. Decided on the maintainer's behalf, who left it
   open (2026-11-12); revisit only if a consumer reports a break.
10. **Windows.** Nothing here is platform specific; the CLI runners keep their native-executable rule.

## Artifacts not written

- `data-model.md`: the only new data is the `RunLimit` value and the ledger, both described in `api-surface.md`.
- `research.md`: the one research task (which real signals each CLI gives) is T-01 in `tasks.md`; its result becomes
  `research.md` when done.
- `events.md`: two events and four attributes, listed in `api-surface.md`.
