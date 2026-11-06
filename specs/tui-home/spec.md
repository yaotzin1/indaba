# Feature TUI-1: home, navigation and layout (`tui-home`)

> **Level**: feature of [`tui-epic`](../tui-epic/spec.md) (TUI-1). **Status**: Draft, specification only (revised 2026-11-06 after review).
> **Stage entry**: 1 · **Semver impact**: minor below 1.0, labelled as a changed default (a major from 1.0); see `api-surface.md`
> **Depends on**: `TUI-0` (the delivered dashboard). Nothing unimplemented.

---

## 1. The problem

The dashboard opens only for one run, from `watch` or `run --tui`. There is no place to start from and no way to move between views
with keys. Today `indaba` with no arguments is a usage error: it writes "No command given." and the usage to stderr and exits 2
(`packages/cli/src/main.ts`, `EXIT_USAGE`); only `--help` prints the usage to stdout and exits 0.

## 2. Stories

- **TUI-1.1** As a person on a terminal, I run `indaba` with no arguments and a full-screen application opens on a Home screen.
- **TUI-1.2** As that person, I move between the views that exist with single keys, and `?` lists them. A view whose feature has not shipped is absent from the key map and from `?`, never shown empty.
- **TUI-1.3** As that person, Home shows the most recent runs (read from the same trace folder `indaba watch` reads), the keys that are available, and a first-run hint saying what to press first; further entries appear as their features ship (workflows in `TUI-2`).
- **TUI-1.4** As a person on a wide terminal, the shell shows a side-by-side layout; on a narrow one it shows one pane and a key reaches the rest.
- **TUI-1.5** As a person whose terminal has no colour or only ASCII, everything is still readable (symbol and word for each state).
- **TUI-1.6** As a person in a pipe, in CI, or who sets `INDABA_NO_TUI=1`, bare `indaba` behaves exactly as today.

## 3. Acceptance criteria

- [ ] AC-01 (1.1) On a terminal, `indaba` opens the application; quitting exits 0.
- [ ] AC-02 (1.6) Without a terminal (stdin or stdout is not a TTY), or with `INDABA_NO_TUI=1`, bare `indaba` is byte-for-byte as today: "No command given." and the usage on stderr, exit 2. `packages/cli/test/main.test.ts` and `packages/cli/e2e/basics.e2e.test.ts` stay valid unchanged, and an e2e case runs `indaba` with a non-TTY stdin.
- [ ] AC-03 (1.2) A key map table is the single source for the keys, the `?` overlay and the docs; a test fails if they differ.
- [ ] AC-04 (1.4) The shell layout is the existing pure `computeLayout` extended, tested at the code's own constants (40, 80 and 160 columns) and at 24 rows; arranging N agent panes belongs to `tui-agent-panes`, not here.
- [ ] AC-05 (1.5) With `NO_COLOR` or when ASCII is chosen, no state is conveyed by colour or a non-ASCII glyph alone. Bare `indaba` has no option parser, so `NO_COLOR` and a new `INDABA_ASCII=1` apply; `--ascii` stays an option of the commands that have it.
- [ ] AC-06 Quitting asks nothing when no run was started from this screen, and asks detach or stop when one was (epic R-05).
- [ ] AC-07 (1.3) Home lists the runs from the same source as `indaba watch` and shows "no runs yet" when there are none.
- [ ] AC-08 If standard input cannot be put in raw mode, the application does not start, says why, and names `--plain`.
- [ ] AC-09 `TuiModule` gains the new entry as an **optional** member, and the loader checks it as it checks `editLoggingSettings`; an older `@indaba/tui` leaves bare `indaba` as today.
- [ ] AC-10 R-01 parity check: `scripts/check-workflow.mjs` fails a `tui-*` spec without a "Parity" section or with an empty cell (protected file; `Workflow-Change:` trailer).

## 4. Terminals

The floor is the code's: 40 columns by 8 rows (`MIN_COLUMNS`, `MIN_ROWS`), stacked below 80 columns (`SPLIT_COLUMNS`), a board dock from 160
(`DOCK_COLUMNS`). The new screens are comfortable at 80 by 24 and show one pane plus a hint below it. Targets: Windows Terminal and one
Linux terminal xterm-class (tested with the fake terminal and by hand); the old Windows console, macOS Terminal, iTerm2, tmux and SSH
are best effort and documented as unverified. PowerShell and bash are shells, not the unit of support. Keys avoid function keys and
timing-sensitive Esc sequences where a letter will do.

## 5. Non-goals

- Mouse support. Themes beyond the existing colour switch. Any new runtime dependency.

## 6. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| Ink cannot load | bare `indaba` behaves as today and says why on stderr |
| not a terminal / `INDABA_NO_TUI=1` | as today (AC-02) |
| stdin not raw-capable | does not start; names `--plain` |
| terminal below the floor | one line saying so, and `--plain` |
| terminal resized | the layout is recomputed; no state is lost |
| crash or signal | the terminal is restored and the cause is logged |

## 7. Parity

| Capability | Web view | TUI | `--plain` / CLI |
| :--- | :--- | :--- | :--- |
| Home / navigation | header and routes | this feature | `indaba --help` |
| Recent runs | Runs screen | Home | `indaba watch` |

## 8. Where it lives

`@indaba/tui` (router, key map, layout, Home), `indaba` (the entry point in `main.ts` and the loader), `scripts/check-workflow.mjs` (AC-10).

## Artifacts not written

- `plan.md`: written at stage 3 when the feature is scheduled.
- `tasks.md`: written at stage 4 when the feature is scheduled.
- `research.md`: nothing external is relied on.
- `data-model.md`: no data is added.
- `events.md`: the feature emits no event or span.
