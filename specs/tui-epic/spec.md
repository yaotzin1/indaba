# Epic: `@indaba/tui` as the real terminal application (TUI-EPIC)

> **Level**: epic. Features below are specs of their own; stories live inside each feature's `spec.md`.
> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (revised 2026-11-06 after an independent review by two reviewers and a debate between them; see "Review" below)
> **Semver impact**: minor, per feature (below 1.0); each feature classifies its own in `api-surface.md`.
> **Decided by the maintainer, 2026-11-06**: the TUI is a real interface for the terminal and for servers: the user selects a
> workflow, runs it, follows it (including every agent working in parallel), reads the messages and the debate, and answers
> questions. The web view is the GUI. `@indaba/tui` is installed with `indaba` (spec `tui-default`); `@indaba/server` stays optional.

---

## 1. The problem

The terminal dashboard is a run monitor: it reads the files a run writes and draws them. It cannot choose a workflow, start or
stop a run, show more than one agent at a time, or answer an agent. Everything that makes Indaba usable as a local orchestrator
exists only in the web view. People who work over SSH, on a server, or simply prefer a terminal have no way to do it.

## 2. Hierarchy: epic, features, stories

Epic `TUI-EPIC` is delivered by features `TUI-1` to `TUI-6`. Each feature is a directory under `specs/`; its stories are the
numbered stories (`TUI-n.m`) in its `spec.md`. Acceptance criteria ids (`AC-nn`) are scoped to their feature and are quoted as
`tui-home AC-02`. A feature is shippable on its own release.

| Id | Feature (spec) | Stories | Delivers | Depends on |
| :--- | :--- | :--- | :--- | :--- |
| `TUI-0` | already delivered: `tui` (dashboard, replay, board pane, Settings screen), `tui-default` (merged, PR 123) | n/a | the read-only dashboard, installed with `indaba` | none |
| `TUI-1` | [`tui-home`](../tui-home/spec.md) | 1.1 to 1.6 | one `indaba` entry point, Home, key-driven views, width-adaptive shell, terminal support | `TUI-0` |
| `TUI-2` | [`tui-run-control`](../tui-run-control/spec.md) | 2.1 to 2.8 | runs list, open a run, the workflow list and picker, inputs, start, stop, detach | `TUI-1`; `web-app-actions`, `workflow-registry`, `workflow-inputs` (implemented) |
| `TUI-3` | [`tui-agent-panes`](../tui-agent-panes/spec.md) | 3.1 to 3.6 | slice 3a (3.1 to 3.4): the dynamic right panel and highlighting. Slice 3b (3.5, 3.6): several panes at once, and chat | 3a: `TUI-1`, `run-blackboard`, `agent-reasoning`, `debate-findings` (implemented). 3b: `parallel-steps`, `agent-conversation` (not started) |
| `TUI-4` | [`tui-questions`](../tui-questions/spec.md) | 4.1 to 4.6 | see and answer questions and gates | `TUI-2`, `TUI-3`; `agent-conversation`, `question-contract`, `review-gate`, `ruling-channel` (none started). Blocked |
| `TUI-5` | [`tui-workflows`](../tui-workflows/spec.md) | 5.1 to 5.4 | registry management: details, hide, copy, add a folder, rescan, remove | `TUI-2` (the list); `workflow-registry` (implemented) |
| `TUI-6` | [`tui-editing`](../tui-editing/spec.md) | 6.1 to 6.6 | editing: first `$EDITOR` and validate, then a form, then a text editor. Deferred behind a demand check | `TUI-5`; `workflow-editor`, `web-app-editing-core` (implemented) |

## 3. Release plan and cut line

| Release | Contents | Why |
| :--- | :--- | :--- |
| **Epic release 1** | `TUI-1` + `TUI-2` + `TUI-3` slice 3a | A usable local orchestrator: open the app, pick a workflow, fill in inputs, start it, follow it with reasoning, output and board on the right, stop it, and quit without stopping it. Needs no unimplemented spec |
| Epic release 2 | `TUI-5` | Registry management, used rarely |
| Epic release 3 | `TUI-6` story 6.1 (`$EDITOR` then validate) | Cheap; the rest of `TUI-6` waits for a demand check by the maintainer |
| When their specs land | `TUI-3` slice 3b, then `TUI-4` | The terminal-only value (parallel panes, answering) depends on engine work that is not started |

The epic is done for its first goal at release 1. The rest are scheduled, not promised.

## 4. Rules for every feature of this epic

- **R-01 Parity.** Every feature has a "Parity" section: a table of rows (web view, TUI, `--plain`/CLI). A cell that says "not yet"
  names a date or a spec. Checkable: `scripts/check-workflow.mjs` should fail a `tui-*` spec without that section or with an empty
  cell (a task of `TUI-1`; a protected-file change that needs a `Workflow-Change:` trailer). Until it exists, review enforces it.
  A feature may ship in one view first only if the spec names the other and says when it follows.
- **R-02 Shapes live in `@indaba/engine`.** `@indaba/tui` imports only `@indaba/engine` (its `layers.test.ts`). The wire types it
  needs (start request and response, workflow list, registry, source, editor, answers) are **re-exported by `@indaba/engine`** from
  `@indaba/core`, following the logging precedent in `packages/engine/src/index.ts`. The TUI redeclares none of them. The CLI
  adapts the same controls the web view's server gets (`createRunControl`, the workflow store, the editor) and injects them into
  the TUI, the way `editLoggingSettings` works. Names where each shape lives are in each feature's `api-surface.md`.
- **R-03 Colour is never the only signal.** Every state is a symbol and a word; colour only adds. `NO_COLOR` and `--ascii` keep
  working. Active or waiting agents are highlighted, and a terminal without colour loses nothing.
- **R-04 The terminal is not assumed.** The supported floor stays the code's (40 columns by 8 rows, `layout.ts`); 80 by 24 is
  comfortable and the new screens ask for it, falling back to one pane and a hint below it. The shells are PowerShell and bash; the
  terminals are Windows Terminal, the old Windows console (best effort: ASCII, no colour), macOS Terminal, iTerm2, tmux and SSH.
  If standard input cannot be put in raw mode, the application does not start and says to use `--plain`.
- **R-05 The run outlives the screen.** Closing or detaching never stops a run; stopping is an explicit, confirmed action. The
  TUI never calls the run control's `stopAll` on quit: a detached mode of the control is part of `TUI-2`.
- **R-06 Plain output stays.** Every view has a non-interactive form (`--plain`, `--output`) for pipes, CI and screen readers.

## 5. Cross-cutting requirements (every feature)

- **Testing.** Every screen is a pure function from state to a screen description (as `ui-state.ts`, `screen.ts` and
  `settings-screen.ts` are) with a thin Ink binding in `ink/` only; the existing fake terminal in `packages/tui/test` drives the keys.
- **Logging.** Each action with a consequence (start, stop, detach, hide, copy, save, answer) logs one `info` record with ids and
  never a typed value. No `console`, no direct stdout write (`layers.test.ts`). A failure to restore the terminal is logged.
- **Security of typed input.** Inputs, typed paths and answers are untrusted: they are sanitised of control sequences when echoed,
  length-limited, never put in a shell, redacted in logs and traces; secret inputs are masked and never drawn back.
- **Accessibility.** No state by colour alone; every key action reachable by keyboard with a visible key line on each screen; no
  animation or flashing; `--plain` per view.
- **Terminal restore.** The terminal is restored on exit, on error and on a signal (as `runDashboard` does in `finally`).
- **Version skew.** New members of `TuiModule` are optional and checked by the loader, as `editLoggingSettings` is, so an older
  installed `@indaba/tui` never breaks bare `indaba`.
- **Documentation.** Each feature updates its docs page, both playbooks, `llms.txt` and the dependency map.

## 6. Non-goals of the epic

- Typing free text to an agent. The right panel is read-only; answering a question is the only input.
- A graph editor in the terminal (proposed by the author; the maintainer has not confirmed it). The web view stays the place for graphical editing.
- A text editor built in Ink before a demand check; until then `$EDITOR` is the fallback (`TUI-6`).
- Mouse support, images, or any dependency beyond Ink and React.
- Remote access: Indaba opens no port for the TUI. Running it over SSH is the user's concern.
- Several people changing the same runs and workflows from the TUI and the web view at once beyond what the files and the channel already allow.
- Run deletion, export and scheduling. A workflow creation wizard (a later epic).
- Running Indaba's own development stages through the TUI.

## 7. Review

On 2026-11-06 two independent reviewers answered ten questions on these specs and then debated their differences (the scratch
files are `.indaba/debate-tui/`, not part of the repository). Both are the same model as the author; no human review has been run.
Agreed changes are applied here and in the features: bare `indaba` is today a usage error to stderr with exit 2 (not a help
print); the code's terminal floor is 40 by 8; shapes are re-exported by the engine; quitting must not call `stopAll`; slice 3a has
no chat; the registry list moves into `TUI-2`; the editor is deferred. Left to the maintainer and decided: `TUI-5` stays separate
from `TUI-2` with the list in `TUI-2`; release 1 is `TUI-1` + `TUI-2` + slice 3a.

## 8. Where it lives

`@indaba/tui` (screens and state, no `node:` import beyond what it has), `@indaba/engine` (re-exports of the wire types),
`indaba` (injection of controls and the entry point). Core changes only through the specs each feature depends on.

## Artifacts not written

- `plan.md`: each feature has its own plan stage; the epic only orders them (sections 2 and 3).
- `tasks.md`: tasks belong to the features.
- `research.md`: nothing external is relied on at the epic level.
- `data-model.md`: no data is introduced at the epic level.
- `events.md`: the epic emits no event; features that do say so themselves.
