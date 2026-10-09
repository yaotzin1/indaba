# Plan: Ruling channel

> Stage 3. Contract: [`api-surface.md`](api-surface.md). Behaviour: [`spec.md`](spec.md).

## Where each piece goes

| Piece | Package | Why there |
| :--- | :--- | :--- |
| `RulingRequested`, `RulingAnswered` | `@indaba/core` (`observability/` beside the other events) | value types |
| `RulingFile`, `RulingAnswer`, `listPendingRulings`, `answerRuling`, `FileRulingAdjudicator` | `@indaba/engine` (`src/arbiter/rulings.ts`) | files and process liveness |
| `ruling_requested` and `ruling_answered` records | `@indaba/engine` (`trace/records.ts`, `event-writer.ts`) | the event stream lives here |
| `--rulings`, `rule`, choosing the implementation | `indaba` (`main.ts`, `bin.ts`, `run-tui.ts`) | composition root and front end |

## Protocol

1. `rule(request, signal)`: id `rul-` plus 8 hex digits from `IdGenerator`; build the `RulingFile` with cleaned and
   redacted text; write `<id>.request.json.tmp` then rename to `<id>.request.json`; dispatch `RulingRequested`.
2. Loop: if `signal` aborted, remove the request and return `null`; read `<id>.answer.json`; absent: `sleep(pollMs)`.
   Present: parse it with a strict reader (own function, no `any`); invalid: delete it, count it, continue. Valid:
   build the `Ruling`, dispatch `RulingAnswered`, remove both files, return.
3. A `finally` removes the request whatever happens, so an exception cannot leave a question hanging.
4. `listPendingRulings`: read the directory, parse each request, drop the files that do not parse (and report none:
   they are removed), drop and remove those whose `pid` is dead. `process.kill(pid, 0)` throws `ESRCH` when the
   process is gone and `EPERM` when it exists but is not ours; `EPERM` counts as alive.
5. `answerRuling`: validate id and answer, check that `<id>.request.json` exists, write
   `<id>.answer.json.tmp` and rename.

## CLI

`--rulings` is parsed with the other run options and carried to `createEngine` as the choice of adjudicator:
`terminal` is `terminalAdjudicator(stdin, stdout)` (and an error if there is no terminal), `files` is a
`FileRulingAdjudicator`, `none` registers none. `run-tui` appends `--rulings files` to the child's arguments.
`rule` is a new subcommand in `main.ts` that calls the two engine functions; `show` prints the transcript through
`printableText`.

## Decisions recorded

- **No new dependency.** `node:fs`, `node:process`.
- **Polling, not `fs.watch`.** `fs.watch` is unreliable on some network drives and across operating systems; 500 ms
  is imperceptible for a person answering a question and costs one `readFile` of a missing file per tick.
- **The adjudicator is not the only writer of its directory.** `answerRuling` is, by design, called from other
  processes; atomic rename means a half-written answer is never read.
- **Dead `pid` cleanup happens on listing**, not by a background job.

## Analysis (stage 5)

| Check | Result |
| :--- | :--- |
| Published signature broken? | No. Additions only; the default keeps today's behaviour. Minor. |
| `node:` import in core? | No. Core gets two value classes. |
| New runtime dependency? | None. |
| Untrusted data to shell, path, URL or log? | Transcript and note are cleaned, redacted and capped, and are never a path or command. The id is validated before a path is built. No port is opened. |
| Wall clock, randomness, environment? | `Clock`, `IdGenerator`, `sleep` and `redact` are injected. `process.kill(pid, 0)` is infrastructure in `rulings.ts`, outside decision logic. |
| Unbounded loop or buffer? | The wait loop is unbounded in time by design (spec section 8) and ends on abort. Sizes are capped. |
| Secrets? | `redact` is applied to the request and the answer note. |
| A front end exposed to other machines | Out of scope and stated in the spec (non-goal). |

**Flag for review.** The wait has no timeout, so a run whose question nobody sees stays alive and holds its
worktree. The dashboard shows it as waiting and `indaba rule list` finds it; the risk is a forgotten run on a
server. A configurable maximum wait could be added later without breaking anything; it was left out because there is
no right default.
