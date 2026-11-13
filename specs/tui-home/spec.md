# Feature TUI-1: home, navigation and layout (`tui-home`)

> **Level**: feature of [`tui-epic`](../tui-epic/spec.md) (TUI-1). **Status**: Stage 3 to 5 written (plan, api-surface, tasks); implementation on `feat/tui-home` (revised 2026-11-13 after an Indaba debate, section 9).
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
- [ ] AC-02 (1.6) Without a terminal (stdin or stdout is not a TTY), or with `INDABA_NO_TUI=1`, bare `indaba` is byte-for-byte as today: "No command given." and the usage on stderr, exit 2. Only the exact value `1` of `INDABA_NO_TUI` disables the application (`0`, empty and `true` do not). One case is not byte-for-byte: with a terminal, but `@indaba/tui` cannot be loaded, one line saying why is written to stderr before that same usage error. `packages/cli/test/main.test.ts` and `packages/cli/e2e/basics.e2e.test.ts` stay valid unchanged, and an e2e case runs `indaba` with a non-TTY stdin.
- [ ] AC-03 (1.2) A key map table is the single source for the keys, the `?` overlay and the docs; a test fails if they differ.
- [ ] AC-04 (1.4) The shell layout is the existing pure `computeLayout` extended, tested at the code's own constants (40, 80 and 160 columns) and at 24 rows; arranging N agent panes belongs to `tui-agent-panes`, not here.
- [ ] AC-05 (1.5) With `NO_COLOR` or when ASCII is chosen, no state is conveyed by colour or a non-ASCII glyph alone. Bare `indaba` has no option parser, so `NO_COLOR` and a new `INDABA_ASCII=1` apply; `--ascii` stays an option of the commands that have it.
- [ ] AC-06 Quitting asks nothing when no run was started from this screen, and asks detach or stop when one was (epic R-05).
- [ ] AC-07 (1.3) Home lists the runs from the same source as `indaba watch` and shows "no runs yet" when there are none.
- [ ] AC-08 If standard input cannot be put in raw mode (`stdin.setRawMode` is not a function), the application does not start, says why on stderr, names `indaba watch --plain`, and exits 1.
- [ ] AC-09 `TuiModule` gains the new entry as an **optional** member, and the loader checks it as it checks `editLoggingSettings`; an older `@indaba/tui` leaves bare `indaba` as today.
- [ ] AC-10 R-01 parity check: `scripts/check-workflow.mjs` (`checkParity`, with a self-test in `scripts/check-workflow.test.mjs`) fails a feature spec of the TUI epic without a "Parity" section, without a table in it, or with an empty cell (protected file; `Workflow-Change:` trailer).
- [ ] AC-11 (debate) Home shows a run row as a mark and a word for its status, the workflow name, the start time and the cost; a name that came from a trace is sanitised, and in ASCII mode a non-ASCII character is replaced. `Enter` opens that run in the existing dashboard and leaving it returns to Home; the run source is the one `indaba watch` uses.
- [ ] AC-12 (debate) A list that arrives after the person left the screen, or after they opened a run, changes nothing and writes nothing; pressing `r` while a refresh is in flight does not let an older answer overwrite a newer one.

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
| stdin not raw-capable | does not start; names `indaba watch --plain`; exit 1 |
| `@indaba/tui` loads but has no `run` (an older version) | as today, no extra line |
| `listRuns` fails | Home shows the failure on one line and `r` tries again |
| `run` throws | the message is redacted and logged, one line on stderr, exit 1, terminal restored |
| terminal below the floor | one line saying so, and `indaba watch --plain` |
| terminal resized | the layout is recomputed; no state is lost |
| crash or signal | the terminal is restored and the cause is logged |

## 7. Parity

| Capability | Web view | TUI | `--plain` / CLI |
| :--- | :--- | :--- | :--- |
| Home / navigation | header and routes | this feature | `indaba --help` |
| Recent runs | Runs screen | Home | `indaba watch` |

## 8. Where it lives

`@indaba/tui` (router, key map, layout, Home), `indaba` (the entry point in `main.ts` and the loader), `scripts/check-workflow.mjs` (AC-10).

## 9. Clarifications (an Indaba debate, 2026-11-13)

`claude-code` and `antigravity` debated the design for three rounds and reached consensus (trace `95c0346a61eb823b82e167fc5d36e889`). Decided:

- The routes are `home`, and a run opened from it; `?` is an overlay, not a route. Settings stays a command (`indaba settings`) in this release; a key for it appears when a later feature wires it, and is absent until then (TUI-1.2).
- The CLI injects a data source (`listRuns`, `openRun`), never the screens: the router stays in `@indaba/tui`.
- Gate order of bare `indaba`: no terminal or `INDABA_NO_TUI=1`, usage error as today; no raw mode, AC-08; `@indaba/tui` missing, one stderr line then the usage error; no `run` in it, usage error as today; else open it. Exit codes: close 0, cancel and abort 130.
- On a narrow terminal (below 80 columns) Home shows the run list only; `Enter` reaches the run. Side by side from 80 columns, the list and the details of the selected run.
- Quitting is asked about only for a run started from the screen (`attached`); this release starts none, so `q` closes at once, and the question exists in the state and is tested there (AC-06).

## Artifacts not written

- `data-model.md`: no data is added.
- `research.md`: nothing external is relied on.
- `events.md`: the feature emits no event or span.
