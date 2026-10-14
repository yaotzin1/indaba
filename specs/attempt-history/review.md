# Self-review: the attempts of a step, one by one

> **Status**: self-review done (stage 8)

## 1. Boundary and layering

The state and the reducer are in `@indaba/engine` (`trace/view.ts`), the line formatter beside the plain view
(`trace/plain.ts`), and the dashboard calls it from `@indaba/tui`. Nothing under `packages/core/src` changed and no
import was added; the tui already imported from `@indaba/engine`.

## 2. Determinism and failure isolation

`reduceRun` stays a pure function of state and record; no clock, randomness or environment (durations come from the
record timestamps). The history is bounded (`MAX_ATTEMPTS_KEPT`). The engine's retry behaviour is untouched, and the
next attempt still receives only the last failure.

## 3. Public surface and semver

Minor, recorded in `api-surface.md` and `CHANGELOG.md`: `StepView.history`, `AttemptView`, `MAX_ATTEMPTS_KEPT` and
`attemptLines`, plus extra lines in two views for a retried step. `attempts` and `reason` keep their meaning. All new
types in a public signature are exported.

## 4. Security

Reasons come from run files and reach a terminal: `attemptLines` sanitises them, takes the first line and bounds it to
120 characters; tests cover an escape sequence, a line break and a 300-character reason. Nothing new is stored. The
engine already redacts a failing step's text before it is recorded.

## 5. Observability and honest numbers

No span, event or attribute is added. A duration is shown only for an attempt that has ended (`-` otherwise); no cost
or token figure is involved.

## 6. Dependencies and packaging

No dependency added; nothing new reaches a published package beyond the changed source.

## 7. Verification

`pnpm qa` on Windows 11, Node 22: 65 test files, 1245 tests passed; coverage 97.69% statements, 93.69% branches,
97.59% functions, 97.89% lines. Tests added: three on the reducer (attempt bounds and outcomes, no invented entry,
the 20-attempt bound), two on the plain view and two on the dashboard (one row each, the current attempt left out,
nothing for a single attempt, sanitising). Not run here: macOS and Linux (CI does). Not tried by hand: a real retried
run in the dashboard.

## Known gaps

- The output pane is still one stream per step, not split by attempt.
- An agent CLI's own internal retries are not recorded, so they cannot be shown; that needs the runners to emit them.
- Only the first line of an earlier attempt's reason is shown; the full text is in the trace.
