# Specification: Debate arbiter (human in the loop)

> **Status**: Implemented (#19), except T16 (`Adjudicator.description`), which is done with `workflow-editor`.
> **Stage entry**: 1
> **Semver impact**: minor (optional workflow field, optional engine option, new artifacts and span
> attributes; no default changes)

---

## 1. The problem

A debate step (`consensus_with`, `decision_type`) ends in one of three ways, and two of them are dead
ends. When the participants stall or spend their rounds, the step is `ESCALATED` and the run stops, with
only each participant's last message printed. Nobody can say "the reviewers agree on this list of changes,
accept it", and nothing can break a tie.

This showed up in a real run: two reviewers (`claude-code` and `antigravity`) reviewing a project
converged on the same five findings, but both replied `CRITIQUE`. Only `AGREEMENT` counts as approval,
so the debate could not succeed however close they were. The step escalated, the earlier rounds were
lost, and the person running it had no way to rule on the outcome.

## 2. User stories

- **US-01.** As a person running a workflow in a terminal, when a debate ends without consensus I want to
  read the discussion and rule on it (accept or reject, with a note), so a near-agreement is not wasted.
- **US-02.** As a workflow author, I want to say in the file that a debate step has a human arbiter, so
  the behaviour is part of the workflow and not something I do by hand afterwards.
- **US-03.** As a person reviewing what happened, I want the full debate and the ruling saved as files,
  so I can read them after the run and a later step can use the ruling.
- **US-04.** As a person who re-runs a workflow on the same code, I do not want to be asked the same
  question again, and I do not want to pay for the same debate again.
- **US-05.** As a team, we want every ruling kept in the repository, with who decided what and when, so
  decisions can be reviewed in a pull request.
- **US-06.** As a developer embedding the engine, I want the arbiter to be an interface I supply, so a
  web page, a chat bot or a model can rule without changing Indaba.

## 3. Acceptance criteria

- [ ] AC-01. A step may declare `arbiter: "human"` only if it is a debate step. Any other value, or the
  field on a non-debate step, fails validation with a message naming the step.
- [ ] AC-02. A debate that reaches quorum behaves exactly as before; the arbiter is not consulted and
  `indaba.arbiter.*` attributes are absent.
- [ ] AC-03. When the debate ends `stalled` or `max_rounds_exceeded` and the step has an arbiter, the
  engine asks the supplied `Adjudicator` for a ruling instead of escalating immediately.
- [ ] AC-04. A ruling of `accept` completes the step. A ruling of `reject` ends it `ESCALATED` with the
  ruling text in the reason, as an unresolved debate does today.
- [ ] AC-05. The CLI's adjudicator shows the transcript of the debate and each participant's last
  position, then reads `accept` or `reject` and an optional note from the terminal.
- [ ] AC-06. When no adjudicator can answer (no terminal on stdin, `--tui`, or none supplied), the step
  ends `ESCALATED` as today, and the reason says the arbiter was unavailable and why. It never hangs.
- [ ] AC-07. Cancelling the run (Ctrl-C, abort signal) while the arbiter waits ends the step cancelled.
- [ ] AC-08. Every debate step writes `.indaba/artifacts/<step-id>.transcript.md` (round, sender, type,
  text of each message); a ruled step also writes `.indaba/artifacts/<step-id>.ruling.md`.
- [ ] AC-09. The span of a ruled step records `indaba.arbiter.kind` and `indaba.arbiter.verdict`. The
  ruling text and the transcript are in no span, event or log line.
- [ ] AC-10. A plugin can register an adjudicator through `PluginHost` with no privileged access beyond
  what the built-in has.
- [ ] AC-11. Every ruling (from any adjudicator) is appended as one JSON line to
  `.indaba-decisions/<workflow-name>.jsonl` in the project directory: key, step id, kind, verdict, note,
  outcome and rounds of the debate, the commit it was made at (for the reader; the key does not use it), and the time (from the injected clock). The
  transcript is not in it.
- [ ] AC-12. Before a debate step runs, the engine looks up its key: workflow name, step id, topic text,
  a fingerprint of every committed file outside `.indaba/` and `.indaba-decisions/`, and a clean working
  tree (also ignoring those two directories). Committing the ledger itself therefore does not change the
  key. On a hit it uses the recorded
  ruling, skips the debate and the adjudicator, writes no transcript, and records
  `indaba.arbiter.source = memo`. On a miss it debates as usual (`source = asked`).
- [ ] AC-13. With a dirty tree, outside a git repository, or when git cannot be read, nothing is looked
  up and nothing is memoised, and the span says so (`indaba.arbiter.memo = skipped`). Rulings are still
  appended to the ledger, with no commit.
- [ ] AC-14. Only rulings are memoised. A debate that reached consensus, and an unavailable arbiter, leave
  no entry. A later entry for the same key supersedes earlier ones; the earlier lines stay as history.
- [ ] AC-15. A ledger line that is not valid, or has an unknown shape, fails the step naming the file and
  line. It is never skipped silently.
- [ ] AC-16. Every new line is covered by tests; the 85% floor holds.
- [ ] AC-17. An adjudicator may carry a `description`, and the registry lists names with descriptions, so a wizard
  can offer the choices (`specs/workflow-editor`). The terminal arbiter is described as "ask the person at the
  terminal".

## 4. Non-goals

- A model arbiter and scoring voters. Both are wanted, and this design leaves room: `arbiter` takes a
  name, and `Adjudicator` is the contract a model arbiter would implement. They get their own specs.
- Arbitration while the debate runs (after each round). The arbiter speaks once, after the debate has
  failed.
- Changing what counts as agreement, the round limit, or the ping-pong detector.
- A prompt inside the TUI dashboard or over `indaba watch`. Those do not ask in v1 (AC-06).
- Standing precedents: a ruling is reused only for the same question on the same files, never offered
  to a different step or code. Matching on meaning is a separate spec.
- A command to edit, expire or clear the ledger. It is a text file; delete the line.
- Re-running a debate after a `reject`. That is `on_failure`, and unchanged.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the debate reaches quorum | step completes; arbiter not consulted |
| the debate fails, arbiter says `accept` | step completes; ruling written; verdict recorded |
| the debate fails, arbiter says `reject` | step `ESCALATED`; reason carries the note |
| stdin is not a terminal | step `ESCALATED`, reason "arbiter unavailable: no terminal" |
| the person enters something that is not `accept` or `reject` | asked again; at most three attempts, then treated as unavailable |
| the run is cancelled while waiting | step cancelled, prompt closed, no ruling file |
| the adjudicator throws | step `FAILED` with the error (not `ESCALATED`), so a bug is not read as a judgement |
| the ledger line cannot be written | the step fails with the path and the error; the ruling is not applied |
| a ledger line is malformed | the step fails naming file and line (AC-15) |
| two runs append at once | each append is one whole line; an interleaved or torn line is reported as malformed rather than guessed at |
| writing the transcript fails | the step fails with the path and the error; no silent loss |

## 6. Security and data handling

The ledger is committed to the repository, so it is public to everyone with the repository. It holds
the person's note and verdict and never the transcript, and secrets are redacted from the note before it
is written. The file name comes from the workflow name, reduced to `[A-Za-z0-9_-]` and confined to
`.indaba-decisions/`. A ledger from someone else is data: a recorded `accept` is honoured only for the
exact key, so it can only skip a debate on the files it was made for. The note is shown to the person and
written back; it is never interpolated into a command, path or span.

The transcript is model output and therefore untrusted. It is printed to the terminal, so control
characters and ANSI escapes are stripped before display. It is written to a file under the artifacts
directory, at a path built from the step id (already validated as `[A-Za-z0-9_-]+`) and confined to that
directory. Secrets are redacted before the transcript or the note is written. The note is the person's
own text, kept in the ruling file only. Nothing from the transcript or the note reaches a shell, a path
or a span.

## 7. Where it lives

- `@indaba/core`: the `Adjudicator` contract and the ruling types (pure, no `node:`), the `arbiter` field
  on the step model, and registration through `Plugin`/`PluginHost`.
- `@indaba/engine`: the ledger (read, append, key), parsing and validation of `arbiter`, consulting the adjudicator in `runConsensus`,
  writing the artifacts, the span attributes.
- `indaba` (CLI): the terminal adjudicator and its wiring in the composition root.

## 8. Clarifications

Resolved with the maintainer:

- First version: human arbiter only. Model arbiter and voters later.
- The arbiter steps in only when the debate fails (`stalled`, `max_rounds_exceeded`).
- A ruling is `accept` or `reject` plus a free-text note, saved as a file.

Defaults chosen here, inherited by every consumer:

- Transcript artifact for every debate step, not only ruled ones. Reason: it is additive, small, and the
  only way to diagnose a debate (the run that motivated this lost its first three rounds).
- With no adjudicator available the behaviour is today's escalation. Existing workflows and CI runs
  are unchanged.
- Memoise on the question and the code, not on the transcript. A model's transcript almost never
  repeats byte for byte, so keying on it would hit rarely and skip nothing. Keying on the files lets an
  identical re-run reuse the ruling and skip the whole debate. It is the files, not the `HEAD` hash,
  because committing the ledger changes `HEAD` and would make every ruling miss the next run. The price: any change to the code, the
  goal or the workflow name misses, and an uncommitted change disables the memo (AC-13).
- No flag to force a new debate in v1. Delete the ledger line or commit a change.
- The ledger is per workflow, in the project, and committed. It is not under `.indaba/`, which is Indaba's
  gitignored runtime state.
- The wait for a person is not bounded by the step timeout, which governs agents. Cancellation is the
  bound.

## Artifacts not written

- `research.md`: the options were weighed in conversation; none depends on outside facts.
- `data-model.md`: the shapes are in api-surface.md; there is no state machine beyond the verdict.
- `events.md`: no event is added; the span attributes are listed in api-surface.md.
