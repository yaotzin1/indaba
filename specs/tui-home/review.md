# Self-review: tui-home

> **Status**: self-review done by the author, then challenged by an Indaba debate (`claude-code` against `antigravity`, trace `fb9964632ca8e2d64422cdc8f2d8be02`). Both are the same family of models as the author; no human has reviewed this.

See [`.agents/rules/review.md`](../../.agents/rules/review.md).

## 1. Boundary and layering

The deciding files (`keymap.ts`, `home-state.ts`, `home-screen.ts`) are pure: they import only each other, `layout.ts`, `screen.ts` and `@indaba/engine`, read no clock or environment, and `home-layers.test.ts` fails if one imports Ink, React or a `node:` module. Ink is reached only through `ink/adapter.ts`. The CLI injects a data source (`listRuns`, `openRun`), never the screens. `packages/cli/test/layers.test.ts` forbids reading the environment outside `main.ts`, so `main()` reads `INDABA_NO_TUI`, `INDABA_ASCII` and `NO_COLOR` and hands plain values to `home.ts`. The only change to existing code in `@indaba/tui` is the optional `embedded` prop of the dashboard `App`; its tests did not change.

## 2. Determinism and failure isolation

Home starts and stops no run. A list fetch carries a generation, and an answer from an older fetch, or one that arrives while a run is open, changes nothing (the debate found the second half missing; fixed, `home-state.test.ts`). A throwing `listRuns` shows one line and `r` retries. A throwing `openRun` returns to the list and logs a fixed message. A throwing `run` is caught in `runHome`: redacted, logged, one stderr line, exit 1. The terminal is restored in a `finally`.

## 3. Public surface and semver

Minor below 1.0, labelled as a changed default (`api-surface.md`, `CHANGELOG.md`). New exports of `@indaba/tui`: `run`, `HomeOptions`, `HomeResult`, `HomeRunSource`, `KEYS`, `shippedKeys`, `KeyDef`, `initialHome`, `reduceHome`, `HomeState`, `HomeEvent`, `HomeContext`, `buildHomeScreen`, `HomeScreenOptions`, `costText`. `TuiModule.run` is optional in the loader, which still requires only `watch`. Two environment variables are new (`INDABA_NO_TUI`, `INDABA_ASCII`).

## 4. Security

Text from a trace (workflow name, start time, run id) goes through `sanitize` and, in ASCII mode, loses every character above 7-bit (the debate found the run id skipped it; fixed). An error from reading the traces is redacted in the CLI before the screen can draw it; the thrown `run` message is redacted and logged. No typed value exists in this feature. A fake credential in the tests is built from fragments.

## 5. Observability and honest numbers

Two `info` records (`home opened`, `home closed` with the quit kind and code) and one for a failed list, an unopenable run and a failed `run`; none carries the text of a failure except the redacted `reason` of `runHome`. Cost is shown as the run recorded it: no model call is `-`, an unpriced call is said to be unpriced (`$0.10+2 unpriced`), never counted as free.

## 6. Dependencies and packaging

None added. `@indaba/cli` already depended on `@indaba/tui` and `@indaba/engine`.

## 7. Verification

`pnpm qa` after the last change: all test files passed, coverage above the 85% floor on every metric (statements 96.88%, branches 92.13%, functions 96.64%, lines 97.11%; 183 test files, 3272 tests passed, 2 skipped). The node gates pass (`check-workflow`, `security-audit`, `build-site --check`, the script self-tests, skills and agent docs). The e2e cases ran against the rebuilt CLI: `home.e2e.test.ts` and `basics.e2e.test.ts`.

The acceptance criteria and where each is tested:

| AC | Test |
| :--- | :--- |
| AC-01 | `home.test.ts` (tui) "lists the runs, and q closes it with code 0"; `cli/test/home.test.ts` "opens Home on a terminal" |
| AC-02 | `cli/test/home.test.ts` (no terminal, `INDABA_NO_TUI`, load failure, no `run`); `cli/e2e/home.e2e.test.ts` (piped stdin) |
| AC-03 | `keymap.test.ts` (table, `?` overlay and the documentation agree) |
| AC-04 | `home-screen.test.ts` (40, 80, 160 columns; below the floor; details only from 80) |
| AC-05 | `home-screen.test.ts` (ASCII marks, no non-ASCII character), `home.test.ts` (no colour codes) |
| AC-06 | `home-state.test.ts` (quit and the detach question), `home.test.ts` (detach 0, cancel 130) |
| AC-07 | `home-screen.test.ts` ("no runs yet"), `cli/test/home.test.ts` (the runs of the project) |
| AC-08 | `cli/test/home.test.ts` (no raw mode: exit 1, names `indaba watch --plain`) |
| AC-09 | `cli/test/home.test.ts` (an older `@indaba/tui`; `loadTui` accepts a module with no `run`) |
| AC-10 | `scripts/check-workflow.test.mjs` (`checkParity`) and the repository passing its own check |
| AC-11 | `home-screen.test.ts`, `home.test.ts` (open and come back; the feed is aborted) |
| AC-12 | `home-state.test.ts` (older generation, open run), `home.test.ts` (list after quit) |

```
pnpm qa: exit 0 (see the pull request for the CI runs on Linux, Windows and macOS)
```

## Known gaps

- **No real terminal.** The fake terminal is the evidence for the Ink binding; a pseudo-terminal run on Windows Terminal and one Linux terminal is still to be done by hand, as `spec.md` section 4 says. The old Windows console, macOS Terminal, iTerm2, tmux and SSH are unverified.
- **The frame test for AC-12 is weak.** Ink drops identical output, so `home.test.ts` "does not draw again" passes with or without the fix; the reducer test is what guards it. A real check would need to count renders, which the adapter does not expose.
- **Settings and workflows are not in Home.** `indaba settings` stays a command; a key for it appears when a later feature wires it (`spec.md` section 9). Starting a run from Home is `tui-run-control`, so `attached` and the detach question are exercised in tests only.
- **A key line longer than the width is cut**, not wrapped, on a 40-column terminal (the keys are listed in full by `?`).
- **`checkParity` is textual**: it checks the section, the rows, the empty cells and the row width, not that a "not yet" names a date or a spec.
