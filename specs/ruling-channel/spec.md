# Specification: Ruling channel

> **Status**: Draft
> **Stage entry**: 1
> **Semver impact**: minor (a new run option, a new command, new event records, a new runtime directory; nothing
> existing changes). Stacked on `specs/debate-arbiter`.

---

## 1. The problem

The human arbiter (`specs/debate-arbiter`) asks a person to rule on a failed debate, but only through the terminal
the run was started in. That is the wrong place for three things the maintainer has planned: the TUI dashboard
(`indaba run --tui` runs the workflow in a child process with no stdin, so a failed debate escalates there), a web
app, and an Electron app. Each of those needs to show a person the transcript and send an answer back to a run that
is in another process, possibly one the person has detached from.

## 2. User stories

- **US-01.** As a person watching a run in the TUI, web app or Electron app, I want a failed debate to appear as a
  question I can answer there, and the run to continue when I do.
- **US-02.** As a person who started a run in one terminal, I want to answer from another with a command, without
  attaching to the run.
- **US-03.** As an author of a front end, I want one documented, transport-agnostic way to list pending questions and
  answer one, so every front end behaves the same way.
- **US-04.** As a workflow author, I want `arbiter: human` to work the same whichever front end runs the workflow.

## 3. Acceptance criteria

- [ ] AC-01. `indaba run` accepts `--rulings terminal|files|none`. The default is `terminal` when stdin and stdout
  are both terminals, and `none` otherwise. `terminal` is today's prompt. `none` registers no `human` arbiter, so a
  failed debate escalates as it does now. An unknown value is a usage error.
- [ ] AC-02. With `--rulings files`, the arbiter `human` writes a request file, waits for an answer file, and rules
  from it. The workflow file is unchanged: `arbiter: human` means the same thing under all three values.
- [ ] AC-03. `indaba run --tui` starts its child process with `--rulings files`, so the dashboard's run can be ruled
  on from outside the child.
- [ ] AC-04. The request is `.indaba/rulings/<id>.request.json`, written whole and atomically (write to a temporary
  file in the same directory, then rename). It holds: `id`, `taskId`, `traceId`, `workflow`, `stepId`, `outcome`,
  `rounds`, `topic`, the transcript (round, sender, type, content), `requestedAt` and the run's `pid`. Text is
  cleaned and redacted, and each message is cut at 8,000 characters.
- [ ] AC-05. An answer is `.indaba/rulings/<id>.answer.json` with `verdict` (`accept` or `reject`) and an optional
  `note` of at most 2,000 characters. The run checks for it every 500 ms. A valid answer becomes the `Ruling`; both
  files are then removed.
- [ ] AC-06. An answer that is not valid JSON, has another verdict, or has a longer note is removed and ignored; the
  request stays pending and the span records `indaba.arbiter.invalid_answers` as a count.
- [ ] AC-07. The wait has no timeout. Cancelling the run ends it, removes the request and returns no ruling (the step
  is cancelled, as in `specs/debate-arbiter`).
- [ ] AC-08. `@indaba/engine` exports `listPendingRulings(projectDir)` and `answerRuling(projectDir, id, answer)`.
  `listPendingRulings` returns the requests whose run is still alive (its `pid` exists) and removes the others
  (a crashed run). `answerRuling` validates the id (`[A-Za-z0-9_-]+`), refuses an id with no pending request, and
  writes the answer atomically. Both are the only way front ends in this repository touch the directory.
- [ ] AC-09. `indaba rule list` prints the pending requests (id, workflow, step, outcome, how long ago).
  `indaba rule <id> accept|reject [--note <text>]` answers one and exits `0`; an unknown or expired id exits `1`
  naming the id. `indaba rule <id> show` prints the transcript, cleaned.
- [ ] AC-10. The event stream gains two records, `ruling_requested` (id, step, outcome, rounds) and `ruling_answered`
  (id, verdict), so a front end already following a run learns that it is waiting. Neither holds the transcript or
  the note. Readers that do not know them skip them as they skip any unknown record.
- [ ] AC-11. Everything in the directory is under `.indaba/` (gitignored runtime state). The ledger and the ruling file
  of `specs/debate-arbiter` are written by the same code path as before, whichever channel produced the ruling.
- [ ] AC-12. Every new line is covered by tests; the 85% floor holds.

## 4. Non-goals

- The screens themselves. The TUI, web and Electron front ends each get their own spec; this one gives them the
  contract (library functions, files, events) and the `indaba rule` command.
- Authenticating who answers. Anyone who can write the project's `.indaba/rulings/` can answer, which is the same
  trust as anyone who can edit the project. A web or Electron front end that exposes the answer to other machines is
  responsible for its own authentication.
- A network protocol, a socket or a server inside the run. Files were chosen so that a detached run, a separate web
  server and a second terminal all work the same way.
- Several answers or votes from several people.
- Changing what a ruling means, or when the arbiter is asked.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| nobody answers | the run waits; the dashboard shows it as waiting; Ctrl+C or cancel ends it |
| the answer file is malformed | removed, ignored, counted; the request stays pending |
| two answers arrive | the first valid one is used; the second finds no pending request and `answerRuling` refuses it |
| the run crashes while waiting | the request file is orphaned; `listPendingRulings` sees the dead `pid` and removes it |
| the request cannot be written | the step fails with the path and the error (not escalates: the front end cannot work) |
| `.indaba/rulings/` cannot be read | the step fails with the path and the error |
| `indaba rule` names an id that is gone | exit `1`, "no pending ruling <id>" |
| `--rulings files` and the workflow has no `human` arbiter | nothing is written; the option has no effect |
| the run is detached from the dashboard | the request stays; any front end (or `indaba rule`) can still answer |

## 6. Security and data handling

The request holds the transcript, which is model output and untrusted. It is cleaned of escape sequences, redacted of
credentials taken from the environment, and cut before it is written; the front end must still treat it as untrusted
text and not as markup. The answer is the person's text: validated, capped, cleaned, redacted, and never used as a
path, a command or a key. The id comes from the run's id generator and is checked against `[A-Za-z0-9_-]+` before any
path is built from it, so `../` cannot leave `.indaba/rulings/`. Nothing here opens a port. A request file persists
the transcript on disk while the run waits; it is removed afterwards, and the directory is gitignored.

## 7. Where it lives

- `@indaba/core`: two event classes, `RulingRequested` and `RulingAnswered` (value types, no I/O).
- `@indaba/engine`: the files protocol (`FileRulingAdjudicator`, `listPendingRulings`, `answerRuling`), the two new
  event-stream records and their writer methods.
- `indaba` (CLI): `--rulings`, the `rule` command, and choosing which `human` arbiter to register.

## 8. Clarifications

Defaults chosen here, inherited by every consumer:

- Files in `.indaba/rulings/`, polled every 500 ms, rather than the child's IPC channel. IPC dies when the person
  detaches from the dashboard, and cannot reach a web server or a second terminal. The price is a polling interval
  of up to half a second and a directory to clean.
- No timeout. A question for a person has no right deadline; cancelling is the bound, as in `specs/debate-arbiter`.
- The id is generated by the run (`rul-` and hex), not by the front end.
- `--rulings` is a run option and not a field in the workflow file, because it describes the front end that is
  running the workflow and not the workflow.
- `none` is the default for a non-terminal run, which is today's behaviour, so CI is unchanged.

## Artifacts not written

- `research.md`: the options (IPC, files, socket) were weighed in conversation; nothing depends on outside facts.
- `data-model.md`: the two JSON shapes are in api-surface.md; there is no state beyond one pending request.
