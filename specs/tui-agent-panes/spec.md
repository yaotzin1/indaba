# Feature TUI-3: the dynamic panel and agent panes (`tui-agent-panes`)

> **Level**: feature of [`tui-epic`](../tui-epic/spec.md) (TUI-3). **Status**: Slice 3a: stage 3 to 5 written, implementation on `feat/tui-agent-panes` (revised 2026-11-13 after an Indaba debate, section 8). Slice 3b: draft, blocked.
> **Stage entry**: 1 · **Semver impact**: minor (provisional)
> **Slices**: **3a** (stories 3.1 to 3.4) ships with epic release 1 and needs no unimplemented spec. **3b** (3.5, 3.6) waits for
> `parallel-steps` and `agent-conversation` (**not started**).
> **Depends on**: `tui-home` (shell layout); implemented `run-blackboard` (board), `agent-reasoning` (reasoning channel), `debate-findings`.

---

## 1. The problem

The dashboard shows one step's output at a time, and the board, reasoning and debate result are separate panes with no common
place. When several agents work in parallel the person cannot see them together.

## 2. Stories

Slice 3a:
- **TUI-3.1** As a person watching a run, a panel on the right shows, by key, **Reasoning** (the agent's thoughts), **Output**, or the **Board**, for the focused step. For a debate it also shows the consensus outcome and the number of rounds. The panel is read-only.
- **TUI-3.2** As a person, I see one pane for each step that is running now: name, state, attempt, cost and the tail of its output. Before `parallel-steps` that is zero or one pane.
- **TUI-3.3** As a person, a working agent is highlighted, one waiting for me differently, one that failed differently again. The state is also a symbol and a word.
- **TUI-3.4** As a person, I focus a pane and enlarge it, then return.

Slice 3b:
- **TUI-3.5** As a person on a wide terminal, I see several running steps side by side; on a narrow one, I page through them with a count of how many there are.
- **TUI-3.6** As a person, the panel can also show the chat of the focused agent (its messages), once `agent-conversation` records them.

## 3. Acceptance criteria

- [ ] AC-01 (3.2, 3.5) The set of panes and their arrangement are a pure function of the run view and the size, with tests. The set is the steps whose `status` is `RUNNING` in `RunState.steps`.
- [ ] AC-02 (3.1, 3.2) Before `parallel-steps` the pane set is zero or one step; the panel offers Reasoning, Output and Board; Debate shows the consensus outcome and rounds only. No chat is shown.
- [ ] AC-03 (3.1) The panel shows what the web view's run screen shows from the same sources (reasoning, board, consensus).
- [ ] AC-04 (3.3) The same screen with `NO_COLOR` conveys every state (epic R-03).
- [ ] AC-05 Output in a pane is sanitised as today (no control sequences from an agent reach the terminal).
- [ ] AC-06 (3.5) With a synthetic trace of 12 concurrent steps the screen renders at most as many panes as fit plus a count of the rest, and each pane's tail is capped by the existing bound on a step's `output`. Twelve is a test fixture, not a promise.
- [ ] AC-07 (3.6) Not testable until `agent-conversation` exists; the story stays blocked.

## 4. Non-goals

- Typing to an agent. Editing or replaying from the panel. A pane for a step that is not running (the step list remains).
- Changes to the view model: `RunState` and `StepView` live in `@indaba/core` (`web-contract/run.ts`) and the engine reduces them; none is expected, and a gap found is a change to `@indaba/core`, not to the engine.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| more running steps than fit | the rest are paged; a counter says how many |
| a source file is missing or partial | the pane says "no data yet", never crashes |

## 6. Parity

| Capability | Web view | TUI | `--plain` / CLI |
| :--- | :--- | :--- | :--- |
| Steps grid / panes | `StepsGrid` | this feature (3a one pane; 3b many) | `watch --plain --output` |
| Reasoning / output | yes (`agent-reasoning`) | this feature, 3a | `watch --plain --output` |
| Board | yes | this feature, 3a (a pane today) | plain board section |
| Debate result | yes | this feature, 3a (outcome and rounds) | plain output |
| Chat / debate messages | not until `agent-conversation` | 3b, after `agent-conversation` | to be defined there |

## 7. Where it lives

`@indaba/tui` (panes, panel). No change expected in `@indaba/core` or the engine (section 4).

## 8. Clarifications (an Indaba debate, 2026-11-13)

`claude-code` and `antigravity` debated slice 3a in two rounds and reached consensus (trace `9e85097a5aa6112d126b3742bb5e8aec`). The spec was written before parts of the dashboard existed; what is already there and what is new:

| Story | Already in the dashboard | New in this slice |
| :--- | :--- | :--- |
| 3.1 | output with scrolling; the board (`b`, docked from 160 columns); the consensus line | a **Reasoning** view of the focused step (`r`, back with `o`), scrolled by wrapped rows, apart from the output |
| 3.2 | glyph, word, attempts, output | one **pane** per running step: name, state, attempt, cost, the tail of its output; the set is a pure function of the run and the size |
| 3.3 | glyph, word and tone per state; `waiting for <step>` | the pane carries the same marks; "waiting for a person" has no source in the view model yet (see below) |
| 3.4 | none | focus a pane (`[` `]`), enlarge it (`Enter` or `z`), return (`Esc`) |

- **Waiting for a person.** The view model has no such state (human-in-the-loop is not built). `ESCALATED` (the glyph `▲` or `!`, tone `accent`, the word `escalated`) is the nearest real state and is labelled as itself, not as "waiting for you"; the unbuilt state is a deferred row of the test matrix. A pane exists only for a running step, so failed, escalated and waiting-for-a-step show in the step list and the title of the detail; the pane carries the working state.
- **Panel keys.** `r` shows reasoning, `o` shows output; `b` and the dock are unchanged. Each view keeps its own scroll position. A debate step shows `consensus: <outcome> after <n> round(s)` in both views. Nothing in `ui-state.ts` or `app.ts` used `r`, `o`, `z`, `[` or `]` before.
- **Panes.** `paneRows = min(floor(detailRows / 3), running * 4)`, and 0 when that is under 4, so a 40 by 8 terminal has none and the list and detail are what they are today. A pane is 4 rows: a title (glyph, word, id, `attempt N`, cost) and 3 rows of output tail. `cap = floor(paneRows / 4)`, the title of the block says `+N more` when steps are hidden, and `[` `]` slide the window.
- **Cost.** The sum of `costUsd` over the step's agent runners (not `execute_tool` commands, as `runnerText` does). No runner priced: `cost unknown`, never `$0`; some priced: `$X+`.
- **Focus** is the id of a step, not an index, so a retry does not move it. When the enlarged step stops running the pane closes with the notice "step is no longer running"; a resize clamps the same way. While a pane is enlarged `?`, `b`, `r` and `o` do nothing, and `Esc` unwinds help, the quit question, the enlarged pane, then the board.
- **Chat** (3.6) and several panes side by side (3.5) stay in slice 3b.

## Artifacts not written

- `research.md`: nothing external is relied on.
- `data-model.md`: no data is added.
- `events.md`: the feature reads events and emits none.
