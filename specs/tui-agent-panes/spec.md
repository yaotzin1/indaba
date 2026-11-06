# Feature TUI-3: the dynamic panel and agent panes (`tui-agent-panes`)

> **Level**: feature of [`tui-epic`](../tui-epic/spec.md) (TUI-3). **Status**: Draft, specification only (revised 2026-11-06 after review).
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

## Artifacts not written

- `plan.md`: written when scheduled; slice 3a first.
- `tasks.md`: written when scheduled.
- `research.md`: nothing external is relied on.
- `data-model.md`: no data is added.
- `events.md`: the feature reads events and emits none.
