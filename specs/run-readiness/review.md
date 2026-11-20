# Self-review: run-readiness

> **Status**: slice 1 of 3 reviewed (core, engine, `indaba plan`, `indaba run`, `--confirm`). Slices 2 (TUI) and 3 (server, web) are not built and not reviewed. An independent review (a fresh agent that read the diff and the spec, 2026-11-20) found nine defects; the ones below marked fixed are fixed with tests.

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

## What this slice does not deliver

AC-12 (confirm in the TUI and web), AC-13 (the start dialogs), AC-15 for the TUI and web, the two HTTP routes. They are slices 2 and 3.
