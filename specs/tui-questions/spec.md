# Feature TUI-4: questions and gates in the terminal (`tui-questions`)

> **Level**: feature of [`tui-epic`](../tui-epic/spec.md) (TUI-4). **Status**: Draft, **blocked**, specification only (revised 2026-11-06 after review).
> **Stage entry**: 1 · **Semver impact**: minor (provisional)
> **Blocked until**: `agent-conversation` and `question-contract` have a stage-3 API surface. Also depends on `review-gate` and
> `ruling-channel` (none implemented), `tui-run-control` and `tui-agent-panes` (the panel).
> **Rule**: this feature is a **client** of the question channel. It defines none of the channel's semantics (who may answer, first
> answer wins, answered by policy, timeouts, the contract of a question): those are defined by the specs above and cited here.

---

## 1. The problem

When an agent asks something, or a gate needs a person, today the run ends as ESCALATED or waits in the debate arbiter's prompt.
The terminal application needs one place to see what is waiting and to answer it.

## 2. Stories (client requirements; the channel specs list the TUI and the web view as the two clients)

- **TUI-4.1** As a person, I see how many questions wait (in the header) and which agent pane is waiting (highlighted, with `?` and the word WAITING).
- **TUI-4.2** As a person, a key opens the oldest waiting question in the panel: its context, its options with what each changes, and the recommendation, as the contract provides them.
- **TUI-4.3** As a person, a number key picks an option, another key types a free answer, and Esc leaves the question waiting.
- **TUI-4.4** As a person, what I chose is shown before it is sent.
- **TUI-4.5** As a person who is not watching, the run waits according to the gate's policy, as the channel specs define.
- **TUI-4.6** As a person, a question answered elsewhere disappears from my list.

## 3. Acceptance criteria

- [ ] AC-01 (4.1, 4.2) The list and the question shown come from the channel's files; the TUI keeps no state of its own about them.
- [ ] AC-02 (4.3, 4.4) An answer is validated by the channel's contract before it is sent; an invalid one is refused at the form.
- [ ] AC-03 The TUI answers **only through the channel's files**; it never reads from or writes to a run's standard input (a started run is a child process without a terminal, `web-app-actions` AC-12).
- [ ] AC-04 (4.4, 4.5, 4.6) Recording, policy answers, a second answer and the arbiter prompt behave **as defined by `question-contract`, `agent-conversation` and `ruling-channel`**; this spec adds no rule of its own.
- [ ] AC-05 When the TUI and the in-process `terminalAdjudicator` (which takes over standard input) could both answer, exactly one owns the terminal; which one is decided by `ruling-channel` and written there. Until then the TUI does not start when the run is attached in the same process.
- [ ] AC-06 Free-text answers are sanitised when echoed, length-limited, redacted in logs and traces, and logged as one `info` record without the text.

## 4. Non-goals

- Defining questions, gates, policies or the contract (their specs do). Reply by mail or any channel other than Indaba.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the run ended while I was answering | says so; nothing is written |
| the channel directory is not writable | the reason is shown; the question stays waiting |

## 6. Parity

| Capability | Web view | TUI | `--plain` / CLI |
| :--- | :--- | :--- | :--- |
| See waiting questions | not yet: a step of `web-app` after `agent-conversation` (`web-app-actions` AC-12) | this feature, when unblocked | to be defined with `agent-conversation` |
| Answer | not yet: same step of `web-app` | this feature, when unblocked | `indaba answer` (proposed by `ruling-channel`) |

Both clients use the same channel, and neither may ship first without the other naming the date it follows (epic R-01).

## 7. Where it lives

`@indaba/tui` (screens), `indaba` (injects the answer control over the channel the question specs define; its shape is re-exported by `@indaba/engine`).

## Artifacts not written

- `plan.md`: written when the question specs have a stage-3 surface.
- `tasks.md`: written when the question specs have a stage-3 surface.
- `research.md`: nothing external is relied on.
- `data-model.md`: the channel's records belong to `agent-conversation`.
- `events.md`: events are defined by `agent-conversation`.
