# Feature RA-2: handover after a run (`run-handover`)

> **Level**: feature of [`run-assist`](../run-assist/spec.md) (RA-2). **Status**: Draft, specification only: nothing here is implemented.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: minor (one optional workflow field, new optional exports, run artifacts and CLI output; below 1.0)
> **Builds on**: [`run-readiness`](../run-readiness/spec.md) (`AttentionItem`, the run record), [`specs/debate-findings`](../debate-findings/spec.md)
> and [`specs/step-verdicts`](../step-verdicts/spec.md) (where open findings come from), [`specs/ruling-channel`](../ruling-channel/spec.md)
> (how a front end other than a terminal answers) and [`specs/tui-questions`](../tui-questions/spec.md) (the TUI answer surface; blocked).
> None of the specs it builds on except `run-readiness` is required for the CLI and web forms; see Parity.

---

## 1. The problem

When a run ends, what is left for a person is spread over a trace nobody reads: a finding the debate did not settle, a step that
passed with a warning, a check no agent can make (look at the screen on a real phone, enter a password, pay by card, open the
production console, compare the result with a mockup). The person has no single place that says "these are open, and these are
yours", and when they decide "this is fine as it is" the next run raises the same finding again.

What is wanted: when a run ends, Indaba computes the **handover**: the items that are still open, and the checks only a person can do,
shows them in one list, lets the person answer each with **fix**, **accept** or **defer**, and remembers the answer, so an accepted
item is not raised again and a deferred one waits somewhere findable.

## 2. User stories

- **US-01 (2.1).** As a person whose run has ended, I see one list of what is open and what is mine to check, in plain words, before I
  open the trace.
- **US-02 (2.2).** As a person, I answer each open item with *fix*, *accept* or *defer*, one at a time, with the reason shown next to it.
- **US-03 (2.3).** As a person, an item I *accept* is not raised again in a later run of the same workflow, and I can see that it was
  accepted, when and why.
- **US-04 (2.4).** As a person, an item I *defer* goes to a list I can open later, across runs, and it comes back when I ask.
- **US-05 (2.5).** As a workflow author, I declare the checks only a person can make (`handover`), with the reason a machine cannot,
  and they appear in the handover of every run of the workflow.
- **US-06 (2.6).** As a developer embedding the engine or a plugin author, I add a source of open items through a contract in
  `@indaba/core`, with no access the built-in sources lack.
- **US-07.** As an author of an existing workflow, nothing changes: a file without `handover` still gets the items Indaba finds.

## 3. Acceptance criteria

**Sources of items**

- [ ] AC-01. At the end of a run (success, failure or stop), the engine asks every registered `HandoverSource` for its items and
  stores the result as the run's handover. A source that throws contributes nothing and one `unknown` item that names it; the
  handover is still produced.
- [ ] AC-02. Built-in sources: (a) **findings** left open by a debate or a step verdict (`debate-findings`, `step-verdicts`) as
  `finding` items; (b) **failed or stalled steps** as `finding` items with the step id; (c) the author's `handover` checks as
  `manual-check` items. A source that depends on a spec that is not implemented yet is simply not registered.
- [ ] AC-03. A workflow may have a top-level `handover` list. Each entry has `check` (non-empty, at most 300 characters: what the
  person does), `reason` (one of `production`, `external-console`, `device`, `payment`, `credentials`, `visual`, `other`), optional
  `how` (at most 500 characters) and optional `after_step` (a step id). Any other key is an error that names the path.
- [ ] AC-04. `reason: credentials` and `reason: payment` are reported as items the person does themselves; Indaba never offers to do
  them and never reads a value for them (epic R-02).

**Answering**

- [ ] AC-05. Each open item has three answers. **Fix** records the intent and, when the author set `handover.fix_workflow` (a
  workflow name in the registry), offers to start that workflow with the item as an input (`workflow-inputs`); with no such
  workflow it only records. **Accept** requires a reason of at most 300 characters. **Defer** takes an optional note.
- [ ] AC-06. An answer is recorded with the time (from the injected clock), the item id, its fingerprint, the answer and the text.
  Nothing else; no person's name is taken from the host.
- [ ] AC-07. An item can be answered once; a later answer replaces the earlier one and the earlier is kept in the history.
- [ ] AC-08. A `manual-check` is answered *done* or *skipped* (with a reason) instead of fix/accept/defer; *skipped* behaves as defer.

**Remembering**

- [ ] AC-09. Every item has a `fingerprint` the source gives it, stable across runs for the same underlying thing (a hash of the
  workflow name, the source and the normalised text of the finding; never a timestamp). An *accepted* fingerprint is marked
  `accepted earlier` in the next run's handover and is not counted as open; it is not hidden.
- [ ] AC-10. A *deferred* item is added to the deferred ledger of the project, `.indaba/handover/deferred.jsonl`, one JSON line each,
  and `indaba handover deferred` and the views list it with its origin run.
- [ ] AC-11. The accepted and deferred records are plain files under `.indaba/`, written atomically, readable without Indaba,
  confined to the project, and contain no secret value, because no item carries one.

**Showing**

- [ ] AC-12. The handover is shown at the end of a run in the web view and the TUI as a short list with counts ("2 open, 1 for you to
  check, 3 accepted earlier"); the dashboard does not open it by itself over a running screen.
- [ ] AC-13. `indaba handover <run>` prints the handover and `--plain` prints it without colour; `indaba handover <run> --answer
  <id>=<fix|accept|defer|done|skipped>[:text]` answers from a terminal. Exit code 0 when none is open, 1 when some are.
- [ ] AC-14. A person who closes the screen loses nothing: the handover and the answers are in the run directory; opening the run later
  shows them.

**Honesty**

- [ ] AC-15. The handover is deterministic given the run record and the answers; it calls no model (epic R-03).
- [ ] AC-16. The core computes the handover with an injected clock and an injected store (`HandoverStore`); it reads no file.

## 4. Non-goals

- Not an automatic fix: *fix* records intent and may start a workflow the author named; Indaba does not decide what to change.
- Not a re-run scheduler and not a task tracker: the deferred ledger is a list, not a board; no due dates, no assignees.
- Not a replacement for the review gate or the question channel: those stop *inside* a run; this is what remains *after* it.
- Not a verdict on correctness; an accepted finding is the person's decision, recorded, not a pass.
- Not user accounts: an answer has no author.
- No automatic upload or sharing of a handover.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| a source throws | one `unknown` item names the source; the rest of the handover is produced |
| the run ended by stop or crash | the handover is built from what the record has; items say the run did not finish |
| the ledger file is corrupt or unreadable | the handover still shows; the ledger error is one `unknown` item and nothing is overwritten |
| two answers arrive for one item (web and TUI) | the later by the injected clock wins; both are in the history |
| a fingerprint was accepted, then the finding text changes | a new fingerprint: it is open again, by design |
| the project folder is read-only | answering fails with a plain message; the handover itself is still shown |

## 6. Security and data handling

Findings and check texts are untrusted (an agent wrote the finding; an author wrote the check). They are escaped like any workflow
text before display and never reach a shell, a path or a log line unescaped. The stores are files under `.indaba/handover/` resolved
through the confined resolver; the ledger is append-only JSON lines, parsed with the same limits as other run files. No item holds a
secret value, so nothing needs redaction, but the run's existing redaction still applies to finding text copied from agent output.
The *fix* workflow is started through the run control with the item's text as a `text` input, never as a command.

## 7. Where it lives

| Part | Package |
| :--- | :--- |
| `HandoverSource`, `HandoverStore`, `Handover`, `HandoverAnswer`, `buildHandover` (pure) | `@indaba/core` |
| the `handover` field: parser, schema, catalog | `@indaba/engine` |
| the file store, the ledger, the built-in sources, building at the end of a run | `@indaba/engine` |
| `indaba handover`, injection into the TUI | `indaba` |
| the list and the answers | `@indaba/tui` (when `tui-questions` is unblocked), `@indaba/web`, `@indaba/server` (routes) |

## Parity

| Surface | Delivers |
| :--- | :--- |
| web view | the handover panel on a finished run; the three answers; the deferred list |
| TUI | read-only list at the end of a run in release 1 of this feature; the answers when `tui-questions` ships (blocked until `tui-questions` is unblocked) |
| `--plain` / CLI | `indaba handover <run>`, `--answer`, `indaba handover deferred` |

A person who uses only the terminal can answer from the CLI form until the TUI answer surface exists.

## 8. Clarifications

- **C-01. Name.** `handover`: it names the moment a run hands the person what is left.
- **C-02. Three answers, as a closed set.** fix, accept, defer. More answers would be a task tracker (non-goal).
- **C-03. Accept is per workflow and fingerprint**, not global: the same text in another workflow is a different thing.
- **C-04. The ledger is in the project**, under `.indaba/` (already gitignored), not in the user's home, so it travels with the folder.
- **C-05. `fix_workflow` is optional and last.** The first release may record intent only. **Open for the maintainer.**
- **C-06. Same item shape as readiness** (`AttentionItem`), so one list component draws both. `critical` is always `false` here.
- **C-07. Sources are an extension point** (`HandoverSource` through `PluginHost`), with no privileged built-in.

## Artifacts not written

- `events.md`: stage 3 adds `HandoverBuilt` and `HandoverAnswered` (counts and ids only); until then `api-surface.md` names them
- `plan.md`: written at stage 3 or 4, when the feature is scheduled; the contract is in `api-surface.md`
- `research.md`: written at stage 3 or 4, when the feature is scheduled; the contract is in `api-surface.md`
- `data-model.md`: written at stage 3 or 4, when the feature is scheduled; the contract is in `api-surface.md`
- `tasks.md`: written at stage 3 or 4, when the feature is scheduled; the contract is in `api-surface.md`
