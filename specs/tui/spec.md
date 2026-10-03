# Specification: Terminal UI (`symfony/tui`)

> **Status**: Draft. **Specification only: nothing in this directory is implemented, and this change
> adds no code.** Implementation starts only after this spec is clarified and accepted.
> **Stage entry**: 1
> **Semver impact**: minor (a new optional package and a new command; below 1.0)
> **Siblings**: [`specs/web-app`](../web-app/spec.md) and [`specs/desktop-app`](../desktop-app/spec.md)
> are separate specs. This one is the smallest of the three and can ship first.

---

## 1. The problem

A run of Indaba is a graph of steps, several agents talking to each other, money being spent and files
changing in a worktree. Today the person running it sees interleaved command output and, afterwards, a
JSONL trace. They cannot tell at a glance which step is running, what an agent is saying right now, how
much it has cost so far, or why a debate stopped.

A browser or desktop application would answer that, and also brings a server, authentication, a build
pipeline and a second language. Many Indaba runs happen where those do not fit: over SSH, in a
container, in a tmux pane next to the agent CLIs themselves. A terminal UI gives most of the
observability for none of that cost.

The Symfony **Tui** component (`symfony/tui`, new in Symfony 8.1) is a purpose-built toolkit for this:
widgets, layouts, input handling and real-time redrawing. The Console component was never meant to
draw a full-screen interface that reacts to keystrokes.

## 2. User stories

- **US-01.** As a person running a workflow, I see the DAG with each step's live state (`PENDING`,
  `RUNNING`, `VALIDATING`, `FAILED`, `ESCALATED`, `COMPLETED`) and which attempt it is on.
- **US-02.** As a person watching, I see the selected step's output stream as it arrives, and the cost
  and token counts of each agent call and of the whole run so far.
- **US-03.** As a person whose run escalated, I read the consensus transcript (proposal, critique,
  agreement, per participant, per round) and the failure that stopped the run.
- **US-04.** As a person on a remote machine, I attach to a run started earlier (or by another
  process, or by CI) and watch it from where it is, with no port opened.
- **US-05.** As a person reviewing afterwards, I replay a finished run from its trace at normal or
  fast speed.
- **US-06.** As a person with a screen reader or a minimal terminal, I can fall back to a plain,
  line-oriented output with the same information.

## 3. Acceptance criteria

Checkable statements; each becomes at least one test when implementation is scheduled.

- [ ] AC-01 `bin/indaba watch [run]` opens the TUI against a run, reading its trace; with no argument
      it lists runs under `.indaba/traces/` and lets the user pick one.
- [ ] AC-02 `bin/indaba run --tui` starts a workflow and attaches the TUI to it. The engine runs in a
      **separate process** from the TUI; closing the TUI never stops the run (it asks whether to
      detach or cancel).
- [ ] AC-03 The only input the TUI has is the JSONL trace (and, for a live run, the process it
      started). It imports no engine internals beyond the trace and event value objects, so the same
      reader serves `watch`, `--tui` and replay.
- [ ] AC-04 A new span or step transition appears on screen within 250 ms of being written, on a
      terminal of at least 80x24; the display degrades (hides panes, truncates) below that rather than
      failing.
- [ ] AC-05 Agent and command output is shown as **text**. Terminal control sequences in it
      (escape codes, OSC hyperlinks and title changes, cursor movement) are stripped or neutralised so
      an agent cannot repaint the screen, change the title or inject a link.
- [ ] AC-06 Secrets never appear: the TUI shows only what the trace contains, and MCP server
      definitions are never displayed, only their names (`indaba.mcp.*`).
- [ ] AC-07 Costs follow the honesty rule: a model missing from the pricing table is shown as
      "unknown", never `$0.00`, and a total that includes an unknown is marked partial.
- [ ] AC-08 Keyboard-complete, with a visible key legend; no mouse-only action. Colour is never the
      only carrier of state (each state also has a glyph and a word).
- [ ] AC-09 `NO_COLOR` is honoured; when stdout is not a TTY, or `--plain` is given, the command prints
      the plain line-oriented view (US-06) and exits with the run's status code.
- [ ] AC-10 The TUI is **read-only** in v1: it starts nothing, cancels nothing, approves nothing. (The
      one exception is `run --tui` starting the run it was asked to start.)
- [ ] AC-11 A crash or exception in the TUI restores the terminal (cooked mode, cursor, alternate
      screen) before printing the error.
- [ ] AC-12 The component is isolated: the core engine, `src/Core`, `src/Workflow/Model|Graph|State`
      and `src/Mesh` have no dependency on it, and the architecture test keeps that true.

## 4. Non-goals

- **No control surface in v1.** No pause, resume, retry, approve or edit. The engine has no such
  states (ESCALATED is terminal); adding them is an engine spec, not a UI feature.
- **No in-process engine.** The TUI never runs the engine on its own render loop (see section 8).
- **No workflow editor**, no file browser, no diff editor. A read-only diff view of the patch artifact
  is in scope; editing is not.
- **No theming system** beyond honouring `NO_COLOR` and the terminal's palette.
- **Not a replacement for `bin/indaba run`'s plain output**, which stays the scripting and CI
  interface.
- **No remote protocol.** Attaching over SSH means running `watch` on the remote machine; this spec
  adds no network listener.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the trace file does not exist yet | wait and show "waiting for the run to start", with the path it watches |
| the trace is truncated mid-line | ignore the partial line until it is completed; never crash on it |
| a trace line is malformed or has an unknown event | show it generically in a log pane and continue |
| the run process dies without a final span | after a grace period show "run ended abnormally" with the last known state, not "running" |
| the terminal is resized | relayout immediately; below minimum size show a one-line notice |
| the terminal lacks features (no colour, no Unicode) | fall back to ASCII glyphs and plain styles |
| the TUI is closed during `run --tui` | prompt: detach (the run continues) or cancel (terminate the run, which tears its worktree down as the engine already does) |
| the TUI library throws | restore the terminal, print the error, exit non-zero; the run is unaffected |

## 6. Security and data handling

Everything an agent writes is untrusted, and a terminal is a programmable surface: output containing
escape sequences can move the cursor, overwrite earlier lines, set the window title or plant a
clickable link. All agent- and command-originated text is therefore sanitised before it reaches a
widget (AC-05). The TUI reads files and starts, at most, the one process it was asked to; it opens no
sockets. Trace paths are resolved inside the project's `.indaba/traces/`, and a run id is validated so
`watch ../../x` cannot read elsewhere. Redaction already applied when traces are written is relied on,
not repeated, and the TUI adds none of its own logging.

## 7. Where it lives

- **A separate package, `indaba/tui`**, in this repository (a `tui/` directory with its own
  `composer.json`) or as a Composer `suggest` plus an optional module. It owns the `watch` command, the
  `--tui` option wiring and every Symfony Tui import.
- **A small, framework-free trace reader** in the core (`Indaba\Observability\TraceReader`: reads and
  tails a JSONL trace into the existing event value objects). It is the only new core class, it uses no
  Symfony, and the web app's run API will reuse it (see `specs/web-app`). This is the shared contract
  the three UIs have in common.
- The Console layer discovers the package at runtime and registers `watch` only if it is installed, so a
  plain `composer require indaba/indaba` is unchanged.

## 8. Clarifications

Open questions to resolve at stage 2.

1. **Symfony version.** Verified against Packagist on 2026-10-04: `symfony/tui` is v8.1.x, requires
   `php >=8.4.1`, `revolt/event-loop ^1.0`, `symfony/event-dispatcher ^8.0` and `symfony/string ^8.0`,
   is MIT licensed and is **experimental** (no backward-compatibility promise). Indaba pins Symfony
   components at `^7.2`, and Composer cannot mix 7.x and 8.x components. Therefore adopting Tui in the
   same package as the engine would force the whole engine onto Symfony 8.1. That is a real, separate
   decision (a dependency major with its own spec and `security_guard` review), and the reason the TUI is
   a separate optional package (section 7). Options: (a) separate package that itself requires Symfony 8
   and therefore cannot be installed next to a Symfony-7 Indaba; (b) move Indaba to Symfony 8 first;
   (c) a thin TUI on `symfony/console` alone (sections, progress bars, cursor control) with no new
   dependency but fewer widgets. *Recommended: decide after a spike; lean to (b) when Symfony 8.1 is the
   current stable and the 8.x line is the only supported one.*
2. **Process model.** Recommended: engine in its own process, TUI tails the trace (AC-02, AC-03). The
   alternative, running the engine on Tui's `revolt/event-loop`, would require every runner to become
   non-blocking (today `Process::run` and the HTTP stream loop block), which is a rewrite of the runner
   contract and out of scope here.
3. **Experimental API risk.** Mitigated by confining every Tui import to one adapter namespace and
   pinning an exact minor in the TUI package. Decide how a breaking minor release is handled.
4. **Windows.** The TUI needs terminal capabilities that Windows Terminal provides and legacy
   `cmd.exe` does not. State the supported set; fall back to `--plain` elsewhere.
5. **Layout.** Proposed panes: DAG (left), step detail and live output (centre), run summary with cost
   and tokens (top), consensus transcript (switchable). Confirm against a sketch before planning.
6. **Replay speed and seeking** (US-05): is "play, pause, 1x/10x" enough, or does it need seeking?

## Artifacts not written

- `plan.md`: planning waits for the Symfony version decision in question 1.
- `tasks.md`: nothing to schedule until the spec is accepted.
- `research.md`: the Tui component's requirements are recorded in question 1; a layout spike is a plan-time task.
- `data-model.md`: the view models derive from the trace schema in `specs/observability`.
- `events.md`: the TUI consumes events and emits none.
