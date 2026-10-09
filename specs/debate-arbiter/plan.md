# Plan: Debate arbiter

> Stage 3. Contract: [`api-surface.md`](api-surface.md). Behaviour: [`spec.md`](spec.md).

## Where each piece goes

| Piece | Package | Why there |
| :--- | :--- | :--- |
| `Verdict`, `Ruling`, `RulingRequest`, `Adjudicator`, `AdjudicatorRegistry` | `@indaba/core` (`src/mesh/adjudicator.ts`) | pure types, the extension contract |
| `arbiter` on `StepDefinition` | `@indaba/core` (`workflow/model.ts`) | the workflow model |
| `PluginHost.registerAdjudicator` | `@indaba/core` (`extension/index.ts`) | extension contract |
| parse and validate `arbiter` | `@indaba/engine` (`parser/`) | existing parser; the validator already knows debate steps (`validator.ts:127`) |
| `DecisionLedger`, memo key, transcript and ruling writers | `@indaba/engine` (new `src/arbiter/`) | needs `node:fs` and `node:crypto` |
| consult in `runConsensus` | `@indaba/engine` (`step-executor.ts:291`) | the only place a debate runs |
| `TerminalAdjudicator`, `registerAdjudicator` in `RegistryPluginHost`, wiring | `indaba` (CLI) | the composition root owns the terminal; `redact` lives here |

## Flow in `runConsensus`

1. Compute the memo key (workflow name, step id, topic, `HEAD`, clean tree). Read `HEAD` and the tree
   status through the existing `Git` wrapper (argument arrays, no shell): `rev-parse HEAD` and
   `status --porcelain`. Any failure means no memo (`memo = skipped`), never a failed step.
2. If the step has an arbiter and the ledger has the key: return the recorded ruling as the outcome and
   skip the debate. Span: `source = memo`, `verdict`.
3. Otherwise run the debate as today. Write the transcript artifact (redacted) whatever the outcome.
4. Quorum reached: `StepOutcome.ok()`, nothing else.
5. Failed and the step has an arbiter: resolve the adjudicator by name. Missing: escalate with reason
   "arbiter unavailable". Ask it. `null`: escalate, `verdict = unavailable`. A throw: `FAILED`.
6. A ruling: append to the ledger, write `<step>.ruling.md`, set the attributes. `accept` returns
   `ok()`; `reject` returns `escalated` with the note.

Cancellation: the signal is passed to `rule`; an abort ends the step cancelled and writes nothing.

## Terminal adjudicator

`node:readline/promises` on `process.stdin`, only when `stdin.isTTY` and not under `--tui`. The transcript
is stripped of control characters before display. It reads `accept` or `reject` (also `a` / `r`), then an
optional one-line note; three bad answers return `null`. Its streams are injected so tests need no
terminal.

## Decisions recorded

- **No new runtime dependency.** `node:crypto`, `node:fs` and `node:readline` only.
- **Ledger format**: JSON Lines, UTF-8, LF. Each entry is written with one `appendFile` of one complete
  line, so a crash cannot leave a half entry that parses.
- **Key**: hex SHA-256 over the four fields, each length-prefixed so field boundaries cannot be forged.
- **Lookup reads the whole file.** Rulings are rare and small; no index, no cache.
- **`.indaba-decisions/` is committed**: absent from `.gitignore`, and `docs/` explains it.

## Analysis (stage 5)

| Check | Result |
| :--- | :--- |
| Published signature broken? | No. All additions are optional; `PluginHost` gains a method nobody outside the CLI implements. Minor. |
| `node:` import in core? | No. Core holds types only; hashing, files and the terminal are outside it. |
| New runtime dependency? | None. |
| Untrusted data to shell, path, URL or log? | Transcript and note are untrusted and reach no command, span or log. Paths come from the step id (validated charset) and the workflow name reduced to `[A-Za-z0-9_-]`, confined to their directory. Git gets fixed argument arrays. |
| Wall clock, randomness, environment in decision logic? | `decidedAt` comes from the injected `Clock`. The key is a pure function of its inputs. |
| Unbounded loop or buffer? | The prompt retries 3 times. The transcript is bounded by the round limit. A very long message is written whole to the artifact but truncated for the terminal; the limit is set in T10. |
| Secrets? | `redact` is injected and applied to the transcript and the note before any write. |

**One gap found, resolved here.** A dirty-tree check would always report dirty: the run itself writes into
the untracked `.indaba/`. The check therefore excludes `.indaba/` and `.indaba-decisions/` (pathspec
exclusions) and nothing else. The spec's "clean working tree" means that; AC-13 gets a test for it.
Excluding the ledger matters too: appending to it must not invalidate the next lookup.
