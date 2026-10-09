# Self-review: Debate arbiter

> **Status**: self-review done by the implementing agent. Not independent: no second reviewer has read it.

## 1. Boundary and layering

`packages/core/src` gains `mesh/adjudicator.ts` and small additions to `workflow/model.ts`, `extension/index.ts`
and `index.ts`. It imports only itself; `architecture.test.ts` passes. Hashing (`node:crypto`), files and git live
in `@indaba/engine` (`src/arbiter/`), the terminal prompt in `indaba` (`arbiter-prompt.ts`). Imports still point
toward core (`layers.test.ts` in engine and cli pass).

The terminal arbiter is registered as `human` through `RegistryPluginHost.registerAdjudicator`, the same door a
plugin uses; the engine never names it. `StepExecutor` finds adjudicators only by the name in the workflow. A test
registers a plugin adjudicator end to end and settles a failed debate with it.

## 2. Determinism and failure isolation

`decidedAt` comes from the injected `Clock`. The memo key is a pure function of its inputs (workflow, step, goal,
file listing). The one default that reads the system is `new SystemClock()` when no clock is injected, the same
pattern as the tracer and the id generator; the CLI always injects.

The prompt retries three times and then gives up (`null`). The wait for a person is not bounded by the step timeout
by design (spec section 8); Ctrl-C ends it through the `AbortSignal`, and a test covers both cancelling before and
while waiting. Nothing here starts a process or a worktree of its own; the git calls are short-lived and go through
the existing `Git` wrapper.

## 3. Public surface and semver

Minor, recorded in `api-surface.md` and `CHANGELOG.md`. Added: `Adjudicator`, `Ruling`, `RulingSource`, `Verdict`,
`RulingRequest`, `AdjudicatorRegistry` (core); `PluginHost.registerAdjudicator`; the step field `arbiter`;
`DecisionLedger`, `LedgerEntry`, `MemoKey`, `LEDGER_DIRECTORY` (engine); `StepExecutorOptions.adjudicators`,
`.ledger`, `.clock`, `.redact`; `CreateEngineOptions.humanAdjudicator`; four span attributes; three files.

Not strictly additive: **every debate step now writes `.indaba/artifacts/<step>.transcript.md`**, and a debate that
fails to write it now fails the step. That is a behaviour change for existing workflows, though only inside the
gitignored runtime directory. **Adding `registerAdjudicator` to `PluginHost` breaks anyone who implements the
interface** (rather than calling it); the only implementer in this repository is the CLI's `RegistryPluginHost`.
Both are noted in the CHANGELOG; I judged them minor, and a reviewer may reasonably call the second one a major
below 1.0.

## 4. Security

- The transcript, the note and a ledger line are untrusted. They reach no shell, no path and no span attribute
  (tested: neither the note nor any message text appears in `span.attributes`).
- Paths: the transcript and ruling are written to `<workdir>/.indaba/artifacts/<step-id>.<suffix>.md` after
  re-checking the id against `[A-Za-z0-9_-]+`; the ledger file name is the workflow name reduced to the same
  set, so `../../x` cannot leave `.indaba-decisions/` (tested).
- Terminal and files: escape sequences and bidi controls are removed with the engine's existing `sanitize`;
  fenced blocks use a fence the text cannot contain, so a message cannot inject markdown structure (tested).
- A hand-edited ledger line is cleaned the same way before it reaches the failure reason or a span (found during
  this review; fixed and tested).
- Git is called with fixed argument arrays; the memo key is never built from text a model wrote except the goal,
  which is hashed.

**Limits of the redaction (see known gaps):** `redact` removes the values of environment variables whose names
look like credentials. It cannot know a secret that is not in the environment, such as one a model quoted from a
file or one a person types into a note.

## 5. Observability and honest numbers

Attributes added: `indaba.arbiter.kind`, `.verdict` (`accept`, `reject`, `unavailable`), `.source` (`asked`,
`memo`) and `.memo` (`skipped`). They follow the existing `indaba.consensus.*` naming; there is no GenAI
convention for them. No token or cost number is added. A memo hit records no cost for the debate it skipped
because there was none: the span has no consensus attributes, so an absent debate is absent, not zero. Failures
surface sentences: `The arbiter "x" is not available`, `could not answer`, `Rejected by the arbiter ...`, and
a ledger error naming file and line.

## 6. Dependencies and packaging

No new dependency (`node:crypto`, `node:fs`, `node:readline` only). `pnpm audit` was not run separately; no
manifest changed. No new path reaches an npm package. The packed-install smoke test was not run by me (see below).

## 7. Verification

See the output below. Run on Windows 11, Node 22 only; the macOS and Linux runs happen in CI. The interactive
prompt was exercised with injected streams, **not at a real terminal**.

```
pnpm qa: exit 0. Test Files 65 passed (65), Tests 1221 passed (1221)
All files 97.54 / 93.38 / 97.39 / 97.73 (statements, branches, functions, lines; floor 85)
src/arbiter: ledger.ts 100 / 95.23 / 100 / 100; records.ts 100 / 83.33 / 100 / 100
```

`pnpm e2e`: 6 files passed, 28 tests passed, 1 skipped (`cancel.e2e.test.ts`, which skips itself on Windows). Node gates: skills, pointer sync, agent-docs sync, check-workflow, security-audit and the 57 script self-tests all pass. The packed-install smoke test and `pnpm audit` run in CI.

## Known gaps

- **A committed ledger can be edited.** Anyone who can commit can add an `accept` line for a key and make a later
  run skip its debate. The ledger is reviewable in a pull request, which is the control; Indaba does not sign it.
  A signed ledger would justify a separate spec if rulings ever gate something irreversible.
- **Secrets typed into a note** or quoted by a model are not redacted unless they are environment values. The
  ledger is committed, so a person should not put a secret in a note. A warning on the prompt would be cheap.
- **No prompt in the TUI or `watch`.** `run --tui` has no stdin, so a failed debate escalates there. The condition
  that would justify building it is someone running arbitrated debates mostly through the dashboard.
- **No model arbiter and no voters.** Wanted; the `Adjudicator` contract is where they plug in. Separate specs.
- **Memo only for an exact repeat.** Any change to a committed file is a new question, so a normal edit-and-rerun
  loop never hits; the value is in re-runs after a crash or a cancel and in CI repeats on one commit.
- **Not tested with the real agents.** The reported two-reviewer run (`claude-code` and `antigravity`) was before
  this feature; I have not re-run it with an arbiter.
- **The ledger is read whole on each lookup.** Fine for rulings, which are few; revisit if one grows past thousands.
