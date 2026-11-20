# Self-review: run-readiness

> **Status**: slices 1 and 2 of 3 reviewed (slice 2 below). Slice 1 of 3 reviewed (core, engine, `indaba plan`, `indaba run`, `--confirm`). Slices 2 (TUI) and 3 (server, web) are not built and not reviewed. An independent review (a fresh agent that read the diff and the spec, 2026-11-20) found nine defects; the ones below marked fixed are fixed with tests.

## Independent review findings

| # | Finding | State |
| :--- | :--- | :--- |
| 1 | `INDABA_CODEX_CMD` and `INDABA_ANTIGRAVITY_CMD` replace the program of those runners; the probe still looked for `codex` and `agy` | fixed: the probe takes the first word of the configured command |
| 2 | A runner's `preset` and `agent.command` are not checked (`acp` with an unknown preset shows ready) | **open, accepted for slice 1**: the engine cannot know the ACP presets without a new runner contract, which the spec forbids (section 4). Revisit with a probe method in a plugin (C-06) |
| 3 | A `.cmd`-only install said only "not available" | fixed in the `how` sentence (native executable, not a `.cmd` shim); the runner message itself stays generic because the probe answers a boolean |
| 4 | A symlinked project root made every existing file "outside" | fixed: the root is resolved with `realpath` first |
| 5 | Workflow text reached the terminal unescaped | fixed: control characters become spaces in `readiness-report.ts` |
| 6 | `.git` was only looked for in the folder itself; the isolation item existed only for worktree steps | fixed: parents are searched; the item is always present (AC-05) |
| 7 | PATH scan ignored the execute bit, `git.exe` given with its extension, quoted PATH entries | fixed (the execute bit is checked where the host file system has one) |
| 8 | Every step got a permission item when `defaults.permissions` is set | fixed: an item only when the level differs from the workflow default |
| 9 | An empty `how` printed "How: ." | fixed; an empty `name` is already refused by the parser |

## What the first CI run found

The three Verify jobs failed on the first run of slice 1, for two reasons this self-review had missed. (1) The probe required a host execute bit even when a test injected `platform: 'win32'`, so two tests failed on Linux and macOS (fixed, `8bd2d0b`). (2) `pnpm e2e` had not been run: the `plan` e2e test expected output without the readiness report (fixed, `6859f40`). The verification skill now lists `pnpm e2e`. Verification of a slice includes `pnpm qa`, `pnpm e2e` and the node gates; the other operating systems are CI's.

## 1. Boundary and layering

`@indaba/core` gained `attention.ts`, `readiness.ts` and `readiness-runners.ts`: pure, no `node:` import (the architecture test passes). The machine is the `ReadinessProbe`; the real one is in `@indaba/engine`. Nothing outside the CLI names a concrete runner except the table of program names in the engine probe, which is a recorded limit (finding 2).

## 2. Determinism and failure isolation

The analysis reads no clock, randomness or environment: the probe is injected. Order is a stable sort by severity then insertion (step) order. A probe that throws gives `unknown` for that item.

## 3. Public surface and semver

Minor: the optional `requires` field, `analyzeReadiness` and its types, `createReadinessProbe`, `RunOptions.readiness`, `indaba run --confirm`, three span attributes. Recorded in `api-surface.md` and `CHANGELOG.md`. Stage 5 corrected the names the specification had wrong. `ReadinessProbe` gained `envNamesOf`, so a probe can say which variables a runner reads.

## 4. Security

A variable is read only to say set or not set; a test greps the serialised report and the span attributes for the fake value and its length. `requires` file names are refused when absolute or containing `..` at parse time and confined again by the probe, including a link that leads out. `PATH` is scanned as directories; nothing is started. Control characters in workflow text are neutralised before printing.

## 5. Observability and honest numbers

The run span records the two counts and the id and state of each item. A check that cannot be made is `unknown`, never ready. **Not done:** AC-03 (input checks), because `workflow-inputs` is not implemented; the `ReadinessChecked` event beyond the span event; the real-terminal check of the output on Windows Terminal.

## Slice 2: the terminal start dialog (independent review, 2026-11-20)

A fresh agent read the uncommitted diff and the spec. It found no way to block a start for good, no option injection into the child, and no contract break; it found two important and three minor defects. Each was read in the code before it was acted on.

| # | Finding | State |
| :--- | :--- | :--- |
| 1 | While the report was being had, only Esc was taken: a slow or stuck check (the probe scans PATH synchronously) left no way to start, against AC-15 | fixed: Enter starts from `checking`; the late answer is dropped; the run control yields before the synchronous probe so the "checking" frame is drawn first. **Open, accepted:** the probe itself is synchronous, so a pathological PATH entry (an unreachable network share) can still hold the event loop for as long as the operating system takes to answer |
| 2 | `c` on the last open item made the answer empty, so the dialog started the run: the person had pressed confirm, not start | fixed: after a confirmation the report is shown again ("Nothing is left to look at"), and only Enter starts. The automatic start remains for the first look only |
| 3 | The selection could move to an item that was not drawn (ten rows, more items) | fixed: a window over the items follows the selection, with "above" and "more below" |
| 4 | The Enter hint was clipped away at 40 columns; a long report could push the key line off a short terminal | fixed: Enter is first in the line, and the number of items drawn follows the terminal's height |
| 5 | The id filter let C1 controls through | fixed: refused (the ids are only ever argv entries and a set lookup today, but AC-17 or a later view may print them) |

Verification: `pnpm qa` and `pnpm e2e` run on the host before the commit. Windows, macOS and Linux are CI's.

## Slice 3: the server route and the web start dialog (independent review, 2026-11-20)

A fresh agent read the uncommitted diff and the spec (reading the code, not running it). It found no defect in: a report that blocks or loses a start (AC-15), a late answer starting twice or dropping a confirmation, confirmations lost between the dialog's views, hostile ids in the query or body, markup from an item's text, the token and method rules of the new route, or the layer rules. Two notes, neither acted on: after the automatic start fires, `busy` reads false in a stale closure until the next render (the same pattern as before this slice, no practical window); and the route runs a file-system probe per GET without a rate limit (loopback, token-gated).

Verification: `pnpm qa` and `pnpm e2e` on the host; the real `indaba ui` in a browser showed the report with the critical item first, the item that needs a person and its confirm button, and Start anyway. **Not proven:** the page at a real 320 px viewport (the browser window could not be made that narrow and the server refuses to be framed); only the dialog's CSS (width `min(44rem, 100%)`, wrapping buttons) and the absence of overflow at a forced 320 px width were checked.

## What this slice does not deliver

The planned `POST /api/runs/:id/confirm` (a confirmation travels with its start instead). The confirmations are recorded with the run by the engine (slice 1); a view of them in the run record is not built in the TUI or web yet.
