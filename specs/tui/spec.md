# Specification: Terminal UI (`@indaba/tui`, built on Ink)

> **Status**: Accepted for implementation: the maintainer chose Ink and said to go. Decisions are in
> section 8 and `plan.md`. Retargeted from the PHP and `symfony/tui` version of this spec to TypeScript and
> [Ink](https://github.com/vadimdemedes/ink). It reads the span events added by `specs/transport-priority`.
> **Stage entry**: 3 (clarified; plan and tasks written)
> **Semver impact**: minor (a new optional package, a new command and a new trace file; below 1.0)
> **Siblings**: [`specs/web-app`](../web-app/spec.md) and [`specs/desktop-app`](../desktop-app/spec.md)
> are separate specs. This one is the smallest of the three and can ship first.
> **Licensing rule**: every dependency must be open source and MIT-compatible, transitively. See
> [`research.md`](research.md) for the check.

---

## 1. The problem

A run of Indaba is a graph of steps, several agents talking to each other, money being spent and files
changing in a worktree. Today the person running it sees interleaved command output and, afterwards, a
JSONL trace. They cannot tell at a glance which step is running, what an agent is saying right now, how
much it has cost so far, which runner of a fallback list actually ran and why the others were skipped,
or why a debate stopped.

A browser or desktop application would answer that, and also brings a server, authentication, a build
pipeline and a second runtime. Many Indaba runs happen where those do not fit: over SSH, in a container,
in a tmux pane next to the agent CLIs themselves. A terminal UI gives most of the observability for none
of that cost.

**What exists today is not enough to draw a live view.** The trace file gets one line per span, written
when the span *ends*; the step state changes (`PENDING`, `RUNNING`, `VALIDATING`, ...) are printed by the
command but never recorded. From the file alone, a step that is running right now does not exist. The first
piece of this work is therefore a recorded event stream (section 7), which is useful on its own: it lets
anything, not only a TUI, follow a run.

## 2. User stories

- **US-01.** As a person running a workflow, I see the DAG with each step's live state and attempt number.
- **US-02.** As a person watching, I see the selected step's output stream as it arrives, and the cost
  and token counts of each agent call and of the whole run so far.
- **US-03.** As a person whose run escalated, I read the consensus outcome, its round count and the open
  objections that stopped the run. (The debate transcript itself is recorded in no file today, so it is out
  of v1; see section 8, question 9.)
- **US-04.** As a person using fallback lists, I see which runner ran a step and which were skipped, with
  the reason, and, for an ACP agent, its tool calls and permission decisions.
- **US-05.** As a person on a remote machine, I attach to a run started earlier (or by another process, or
  by CI) and watch it from where it is, with no port opened.
- **US-06.** As a person reviewing afterwards, I replay a finished run from its recorded files at normal
  or fast speed.
- **US-07.** As a person with a screen reader or a minimal terminal, I get a plain, line-oriented output
  with the same information.

## 3. Acceptance criteria

Checkable statements; each becomes at least one test when implementation is scheduled.

- [ ] AC-01 `indaba watch [run]` opens the TUI against a run; with no argument it lists runs under
      `.indaba/traces/` and lets the person pick one.
- [ ] AC-02 `indaba run --tui` starts the workflow in a **separate process** and attaches the TUI to it.
      Closing the TUI never stops the run: it asks whether to detach or cancel.
- [ ] AC-03 The TUI's only input is the files a run writes (the trace and the event stream of section 7) and,
      for `run --tui`, the one process it started. It imports no engine internals beyond the trace reader
      and the event value types, so the same reader serves `watch`, `--tui`, replay and the future web app.
- [ ] AC-04 A new event appears on screen within 250 ms of being written, on a terminal of at least 80x24;
      below that the display hides panes and truncates instead of failing.
- [ ] AC-05 Agent and command output is shown as **text**. Terminal control sequences in it (escape
      codes, OSC hyperlinks and title changes, cursor movement, bidi overrides) are stripped, so an agent
      cannot repaint the screen, change the title or plant a link. A test feeds hostile sequences.
- [ ] AC-06 Secrets never appear: the TUI shows only what the files contain, and MCP server definitions are
      never displayed, only their names (`indaba.mcp.*`).
- [ ] AC-07 Costs follow the honesty rule: a model missing from the pricing table is shown as "unknown",
      never `$0.00`; a total that includes an unknown is marked partial; an ACP step with no reported cost
      shows none, not zero.
- [ ] AC-08 Keyboard-complete, with a visible key legend; no mouse-only action. Colour is never the only
      carrier of state: each state also has a glyph and a word.
- [ ] AC-09 `NO_COLOR` is honoured. When stdout is not a TTY, or `--plain` is given, the command prints the
      plain line-oriented view (US-07) and exits with the run's status code.
- [ ] AC-10 The TUI is **read-only** in v1: it starts nothing, cancels nothing, approves nothing. The one
      exception is `run --tui` starting the run it was asked to start, and cancelling it when asked.
- [ ] AC-11 A crash or exception in the TUI restores the terminal (cooked mode, cursor, alternate screen)
      before printing the error, and never affects the run.
- [ ] AC-12 The component is isolated: `@indaba/core`, `@indaba/engine` and `@indaba/runners` never import
      it, and a layers test keeps that true. `@indaba/tui` is an optional package; `indaba` works without it.
- [ ] AC-13 The event stream of section 7 is written by every `run`, whether or not a TUI is attached,
      carries no secret, and does not change the existing trace file byte for byte.

## 4. Non-goals

- **No control surface in v1.** No pause, resume, retry, approve or edit. The engine has no such states
  (`ESCALATED` is terminal); adding them is an engine spec, not a UI feature.
- **No in-process engine.** The TUI never runs the engine on its own render loop (section 8, question 3).
- **No workflow editor**, no file browser, no diff editor. A read-only view of the patch artifact is in
  scope; editing is not.
- **No theming system** beyond honouring `NO_COLOR` and the terminal's palette.
- **Not a replacement for `indaba run`'s plain output**, which stays the scripting and CI interface.
- **No remote protocol.** Attaching over SSH means running `watch` on the remote machine; no listener.
- **No change to the login prompt in this spec.** The dependency-free picker from
  `specs/transport-priority` stays; a styled version inside the TUI is a later option.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the files do not exist yet | wait, showing "waiting for the run to start" and the path watched |
| a file is truncated mid-line | ignore the partial line until completed; never crash on it |
| a line is malformed or has an unknown record type | show it generically in a log pane and continue |
| the run process dies without a final record | after a grace period show "run ended abnormally" with the last known state, not "running" |
| the terminal is resized | relayout at once; below minimum size show a one-line notice |
| the terminal lacks features (no colour, no Unicode) | fall back to ASCII glyphs and plain styles |
| the TUI is closed during `run --tui` | prompt: detach (the run continues) or cancel (terminate the run; the engine already tears its worktree down) |
| Ink or React throws | restore the terminal, print the error, exit non-zero; the run is unaffected |
| `@indaba/tui` is not installed | `watch` and `--tui` say how to install it; every other command is unchanged |

## 6. Security and data handling

Everything an agent writes is untrusted, and a terminal is a programmable surface: output containing
escape sequences can move the cursor, overwrite earlier lines, set the window title or plant a clickable
link. All agent- and command-originated text is therefore sanitised before it reaches a component (AC-05);
the sanitiser is one small, separately tested function with an allow-list approach (printable text and
newlines pass, everything else is dropped), not a blocklist. The TUI reads files and starts, at most, the
one process it was asked to; it opens no sockets. Trace paths are resolved inside the project's
`.indaba/traces/`, and a run id is validated as hexadecimal so `watch ../../x` cannot read elsewhere.
Redaction applied when the files are written is relied on, not repeated; the TUI adds no logging of its own.
Dependencies are open source and MIT-compatible, transitively (see `research.md`), and are pinned.

## 7. Where it lives

- **A new optional package, `@indaba/tui`**, in this repository. It owns the `watch` command's UI, the
  `--tui` wiring and every `ink` and `react` import. Nothing else imports them.
- **The event stream, in `@indaba/engine`** (the first deliverable and the shared contract of the three UIs):
  every run writes `<traceId>.events.jsonl` next to `<traceId>.jsonl`, one record per line with a `type`:
  `span_started`, `span_ended`, `step_status` (the existing `StepStatusChanged`) and `output` (a bounded chunk
  of a step's streamed text, already redacted). The existing `<traceId>.jsonl` is unchanged. Clarification 2
  weighs this against changing that file.
- **A framework-free `TraceReader` in `@indaba/engine`**: reads and tails both files into typed values,
  tolerant of partial lines. No Ink, no React; the web app's run API reuses it.
- **The `indaba` command line** loads `@indaba/tui` on demand (a dynamic import that is allowed to fail, as
  `node-pty` is) and registers `watch` and `--tui` only if it loads.

## 8. Clarifications

Resolved by the maintainer's go-ahead on the recommendations (recorded in `plan.md`), except question 9,
which is a deliberate deferral. Recommendations are marked.

1. **Library.** *Recommended: Ink 8 with React 19.* MIT, Node 22 or newer (Indaba's own floor), reported to
   be used by Claude Code and Gemini CLI, with flexbox layout and an actively used test story. The tree is 45
   packages, all MIT, ISC or MIT-or-CC0 (`research.md`). Alternatives weighed there: a thin ANSI layer on
   `node:readline` (no dependency, much more code to own), `@clack/prompts` (prompts, not a dashboard),
   `blessed` (unmaintained). **Needs the maintainer's recorded dependency decision.**
2. **Where the live stream goes.** *Recommended: a second file, `<traceId>.events.jsonl`* (section 7): the
   existing trace stays byte-identical, and `watch` lists runs by the trace file. Alternatives: typed
   records in the existing file (one file, but every consumer of the trace must now skip record types), or
   running the TUI in the engine's process (rejected: question 3).
3. **Process model.** *Recommended: the engine in its own process, the TUI tails the files* (AC-02, AC-03).
   Running the engine on the UI's render loop is possible in Node (runners are asynchronous), but it ties a
   run's life to a terminal and loses attach-from-anywhere (US-05).
4. **JSX.** Ink components are usually written in JSX, which needs a compiler option the root
   `tsconfig.base.json` does not set and the governance protects. *Recommended: the package uses
   `React.createElement` (a small helper) or its own package-level `tsconfig` and does not touch the
   protected files.* Confirm at plan time that a package-level option is allowed without a `Workflow-Change`.
5. **Windows.** Windows Terminal and modern consoles are the supported set; legacy `cmd.exe` falls back to
   `--plain`. Needs a real-machine check before the claim is made in the docs.
6. **Layout.** Proposed: run summary and cost on top; the DAG on the left; the selected step's detail and
   live output in the centre, with its runner chain, skipped runners and, for ACP, tool calls and permission
   decisions; the consensus transcript as a switchable pane. Confirm against a sketch before planning.
7. **Output volume.** The `output` records are bounded per record and per run (a cap, with a visible
   "truncated" marker), so a chatty agent cannot fill the disk or the screen. The caps need numbers.
8. **Replay** (US-06): "play, pause, 1x/10x" is enough for v1; seeking is out unless asked.

9. **Consensus transcript: deferred.** The messages of the mesh are recorded in no file, so v1 shows the
   outcome, the round count and the open objections only. Recording the messages is a change to the mesh and
   its own spec.

## Artifacts not written

- `data-model.md`: the view models derive from the record types in `api-surface.md`.
- `events.md`: the TUI consumes events and emits none; the stream it reads is specified in `api-surface.md`.
