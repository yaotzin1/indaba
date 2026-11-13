# Self-review: tui-run-control

> **Status**: self-review by the author, then challenged by an Indaba debate (`claude-code` against `antigravity`, trace `a2cb389c5d6d8c7b29d06d7c6523a63d`). Both are the same family of models as the author; no human has reviewed this.

See [`.agents/rules/review.md`](../../.agents/rules/review.md).

## 1. Boundary and layering

The flow is pure: `run-flow.ts` (the reducer) and `run-flow-screen.ts` (a screen per state) import only `@indaba/engine` and each other, and `home-layers.test.ts` holds the pure files to that. Ink is reached through the adapter only; `ink/home-app.ts` runs the effects and owns every timer. `@indaba/tui` declares its own `RunControlPort` from wire types that `@indaba/engine` re-exports and imports no CLI module; `home-control.test.ts` assigns the CLI's adapter to that port, so a drift is a compile error. The CLI reads the environment only in `main()` (its layers test), and passes plain values to `home.ts`.

## 2. Determinism and failure isolation

Each state of the flow carries a `seq` and the one effect to run; the component runs an effect once per `seq` and disposes its timer and drops a late answer when the dialog moves on or the screen ends. A start has three ends that are not a run: refused (shown), failed (shown), and lost or timed out. The last two leave `unsure` set, because a child may exist that the screen cannot name; leaving then asks as it does for a run it knows, and `c` goes through `stopAll`, which covers that start. Leaving is refused while a start is pending, and while the runs are being stopped for a quit no key changes anything (the review found `d` could turn a stop into a detach; fixed). A failed `stopAll` keeps Home open and says so. A run cancelled from its dashboard is recorded as stopping, so leaving at once does not ask about it.

## 3. Public surface and semver

Minor below 1.0, all optional (`api-surface.md`). New: `HomeOptions.runs` and `pollMs`; the flow's exports of `@indaba/tui`; type re-exports of `@indaba/engine`; `UiRunControl.detach?` and `createRunControl().detach()`. Changed: the sweep of `.indaba/run-inputs` now keeps copies younger than `RUN_INPUT_MAX_AGE_MS` (15 minutes); `indaba ui` still sweeps at start, but a copy written a moment ago by another process survives. `KeyName` gains `'backspace'`, an addition to a union the dashboard's reducer ignores.

## 4. Security

The confirmation is the web view's own two-step protocol through the same control: the hash the screen echoes is always the one of the latest answer, a changed file drops both hashes and says so, and full access needs its own key with no default. Every string that comes from the control is cleared of credentials at one boundary (`homeRunControl`: results, thrown refusals, and every other call, the review found only `start` was guarded; fixed), then of control sequences (`plain`: C0, C1 including the terminal's CSI, and the bidi controls; the review found C1 and bidi were left in; fixed) and bounded before it is drawn. A refusal with a known code shows the screen's own words, never the control's text. Ids only are logged. A released child is not cancelled by its channel closing: the child entry point has no listener for it, and a test fails if one is added.

## 5. Observability and honest numbers

Records at `info`: a start (with the workflow id), a stop (with the run id), the runs being stopped for a quit, a failed list, an unopenable run, a failed stop or release; none carries a message of a failure except the redacted reason of `runHome`. No number is shown that was not given.

## 6. Dependencies and packaging

None added.

## 7. Verification

`pnpm qa` and the node gates are green before the last change of the review round; see the pull request for the final run on Linux, Windows and macOS. Coverage stays above the floor on every metric.

| AC | Test |
| :--- | :--- |
| AC-01 | `home.test.ts`, `cli/test/home.test.ts` (the runs list is `indaba watch`'s, from `tui-home`) |
| AC-02 | `run-flow.test.ts` (both hashes, a changed file), `home-run-control.test.ts` (the whole protocol on a fake terminal) |
| AC-03 | deferred (section 9 of the spec) |
| AC-04 | `run-flow.test.ts` (one question, names the run), `home-run-control.test.ts` (stop, finished, unknown) |
| AC-05 | `run-control.test.ts` (detach releases and never stops; stopAll skips released), `home-control.test.ts` (no listener for the channel closing), `home-run-control.test.ts` (d keeps the run) |
| AC-06 | `run-flow.test.ts` (the refusal at the cap shows the control's own number) |
| AC-07 | `home-layers.test.ts`, `home-control.test.ts` (the port is satisfied by the adapter) |
| AC-08 | `home-control.test.ts` (every call redacted), `home-run-control.test.ts` (ids only in the log) |
| AC-09 | `run-flow.test.ts` (filter bounded and sanitised) |
| AC-10 | `run-flow.test.ts`, `home-run-control.test.ts` (the file changes between the two confirmations) |
| AC-11 | `home-state-control.test.ts`, `home-run-control.test.ts` (q c d during a pending stop; refusal while starting; stopAll throwing; the lost start) |
| AC-12 | `run-flow.test.ts` (lost, timeout, thrown poll), `home-run-control.test.ts` (no poll after the screen ends) |
| AC-13 | `run-flow.test.ts`, `run-flow-screen.test.ts`, `home-control.test.ts` |

## Known gaps

- **No real terminal and no real child.** The fake terminal and a fake control are the evidence; nothing here started a real run from the screen. A manual run (start, detach, quit, `indaba watch` the run, then stop) on Windows Terminal and a Linux terminal is still to be done by hand.
- **The confirmed copy is not deleted by the child.** After a detach it stays under `.indaba/run-inputs` until a later control sweeps it (15 minutes or more). The debate suggested the child delete it once parsed; that changes `indaba run` and is left out.
- **Inputs** (story 2.5, AC-03) wait for `workflow-inputs`; a workflow that needs them fails to start and the screen shows the engine's reason.
- **`stopAll` can take up to 15 seconds** (three grace periods) with the screen showing nothing new but the unchanged question; it does not say "stopping". A line for it is a small follow-up.
- **A start the screen lost** is stopped only by `c` at the quit question (through `stopAll`); it cannot be stopped one by one because its run id is unknown.
- **Frame-count tests are weak** where Ink drops identical output; the reducer tests are the guard, as in `tui-home`.
