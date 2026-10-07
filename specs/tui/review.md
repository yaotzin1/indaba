# Self-review: Terminal UI (`@indaba/tui`)

> **Status**: self-review done on 2026-10-07, on branch `feat/tui-impl`, on Windows 11 only. Linux and macOS
> are left to CI; the manual run in a real terminal is **not** done (see Known gaps).

Answered against [`.agents/rules/review.md`](../../.agents/rules/review.md).

## 1. Boundary and layering

- `@indaba/core` gained one event, `StepOutput`; it imports nothing new (`architecture.test.ts` passes).
- `@indaba/engine` imports no `ink` or `react` (`layers.test.ts`); `ink` and `react` are imported in one file of
  `@indaba/tui` only, `ink/adapter.ts` (`packages/tui/test/layers.test.ts`). `@indaba/core`, `engine` and `runners`
  never import `@indaba/tui`.
- The run view model (`reduceRun`), the plain formatter, the trace reader and the sanitizer sit in `@indaba/engine`, not
  in the TUI package, so `indaba watch --plain` and a future web app need none of Ink. They are pure over the record
  types, and the decisions that matter (what a record means) live there, not in a component.
- The command line reads the process and the environment only in `main.ts` and `bin.ts` (`layers.test.ts`, which
  caught `run-tui.ts` and `run-child.ts` doing otherwise while this was written; both now take `environment` and
  `noColor` from `main`). It names no concrete runner.
- `@indaba/tui` is loaded by a dynamic import that is allowed to fail. It gets no access a third-party view would
  lack: it reads the same files through the exported `TraceReader`.

## 2. Determinism and failure isolation

- `reduceRun` and the formatters are pure. The event writer and the replay take their clock and sleep by injection;
  the polling in `run --tui` takes `sleep`, `pollMs` and `waitMs` as options and counts polls instead of reading a clock.
- **Every process `run --tui` starts has an owner on every path.** The child is started in one place
  (`runWithDashboard`) and each way out is handled and tested: cancel (cancel, then wait for its exit), detach (release),
  the dashboard failing (release, and the message says how to follow the run), the run never writing files (cancel, and
  say why), looking for the run throwing (cancel, then rethrow), and an interrupt of the command line (cancel). A run
  that ended by itself needs nothing. One path is deliberate: detach leaves the child running, on purpose.
- Cancel is a message on the child's IPC channel, not a signal, because a signal is not a gentle request on Windows
  (the existing SIGINT cancellation test is skipped there for that reason). The new end-to-end test
  (`packages/cli/e2e/run-child.e2e.test.ts`) cancels a real `bin.js` run on Windows and checks exit 130, no worktree
  left and `CANCELLED` in the event file. The child closes the channel when it finishes, otherwise it would never exit.
- The dashboard failing never affects the run (AC-11); the terminal is restored by the dashboard's own tests.
- Retries: not touched. The event stream is written by listeners that fail alone (`onError` once, never thrown).

## 3. Public surface and semver

Minor (below 1.0), recorded in `api-surface.md` and `CHANGELOG.md`: the new package, the `StepOutput` event, the event
file and its records, `TraceReader`, `RunEventWriter`, `reduceRun`, the formatters, `sanitize` exported from the engine,
`indaba watch`, `indaba run --tui`, and on the CLI `Io.startRun?` (optional, so additive) with `RunChild`, `RunStarter`,
`StartOptions` and `createRunStarter` exported so that the new field's types can be named. The existing trace file is
byte-identical with the writer on and off (`run-event-stream.test.ts`). A changed default: every `run` now writes the
event file; it is recorded under "Defaults introduced". `StartOptions` names its field `environment`, not `env`, only to
keep the layers rule honest; it is new and unreleased.

## 4. Security

- Agent and child text is untrusted, and a terminal is a programmable surface: all of it goes through the allow-list
  `sanitize` (printable text and newlines pass, everything else is dropped, a sequence split across chunks is still
  caught). The reason a `run --tui` run did not start (the child's error text) is redacted and then sanitised; a test
  feeds it control sequences. Hostile strings in tests are built from fragments.
- The child is started with `spawn` and an argument array, no shell; the program is `process.execPath` and the script is
  the CLI's own `bin.js`, both named by `bin.ts`. The arguments are the person's own, with `--tui` removed; a test passes
  an argument shaped like a command substitution and sees it arrive as one literal.
- A run id is checked as lowercase hexadecimal before it becomes a path (`isRunId`, tested with path-like ids). Trace
  paths are resolved inside `.indaba/traces`.
- Secrets: output is redacted before it is stored (the command line's own rule, built from the environment), capped at
  4096 characters a record and 2 MiB a run with one `truncated` record, and the file stays under `.indaba/`. It can
  still hold whatever an agent printed that does not look like a credential: said in the CHANGELOG. MCP server
  definitions are never shown, only names. The dashboard opens no socket and logs nothing.
- `node scripts/security-audit.mjs --source`: no findings (it did flag a key-shaped literal in a first draft of a test;
  the string is now built from fragments).

## 5. Observability and honest numbers

- Cost follows the honesty rule in `reduceRun` and the screens: a model missing from the pricing table is "unknown", a
  total that includes one is marked partial, an ACP step that reported no cost shows none. Tests cover each case.
- A fix on this branch records the cost an agent reports on the step's span, so the stream and the trace agree.
- No span or attribute name was added; the event file is a new record format, not a GenAI span attribute.
- A run that dies leaves no final record: `watch` says so after `--stale` seconds instead of showing "running", and a
  `run --tui` that never writes files says "The run did not start" with the reason.

## 6. Dependencies and packaging

- New runtime dependencies, in `@indaba/tui` only: `ink@8.0.0` and `react@19.3.0`, both pinned exactly, recorded in
  `plan.md` as the maintainer's decision, with `@indaba/tui` as an optional peer of `indaba`. Re-run license check in
  `research.md`: 40 packages in the production tree, 38 MIT, 1 ISC, 1 `MIT OR CC0-1.0`; none outside the permitted set.
  `project.optional_dependencies` and `workflow.ai.yml` name the package.
- `pnpm audit` is part of the release workflow's verification; `pnpm smoke` packs five packages, installs them in a
  clean directory and boots the CLI.
- `release.yml` now packs and stages `@indaba/tui` with the others (it did not before). The package is not on npm yet:
  its trusted publisher is created and pending validation by the first staged publish.

## 7. Verification

Run on Windows 11 with Node 22 and pnpm 9, after the last code change (see the output below). **Not run:** Linux and
macOS locally (CI runs them), and a session in a real terminal (see the gaps).

```
pnpm qa            exit 0   Test Files 60 passed (60), Tests 1142 passed (1142)
                            Coverage (All files): statements 97.33, branches 93.2, functions 97.24, lines 97.54
                            (floor 85 on each); biome: no errors; tsc strict: clean
pnpm e2e           exit 0   Test Files 6 passed | 1 skipped (7), Tests 28 passed | 1 skipped (29)
                            (the skipped one is the SIGINT cancel test, which cannot run on Windows;
                             run-child.e2e.test.ts covers cancel there through the channel)
pnpm smoke         exit 0   smoke-pack: 5 packages packed, installed and booted (indaba 0.1.0-alpha.2)
pnpm audit --audit-level low   No known vulnerabilities found
node scripts/validate-skills.mjs            All 23 skills validated (0 Security Threats / 0 Syntax Errors)
node scripts/sync-claude-skills.mjs --check .claude/skills is in sync (23 skills)
node scripts/sync-agent-docs.mjs --check    AGENTS.md, GEMINI.md and the cycle file are in sync
node scripts/check-workflow.mjs             workflow.ai.yml matches the repository
node scripts/security-audit.mjs --source    security audit: no findings
node --test scripts/*.test.mjs              tests 57, pass 57, fail 0
```

`node scripts/check-track.mjs` looks at commits and is run by the hook when the change is committed; it was not run
on this working tree.

**Mutation testing** (StrykerJS, scoped to the four modules T-20 names, 2026-10-07; thresholds high 85, low 70):

| Module | Score | Note |
| :--- | :--- | :--- |
| `trace/sanitize.ts` | 100.00 % | nothing survived |
| `trace/event-writer.ts` (the caps) | 94.68 % | 5 survived |
| `trace/view.ts` (`reduceRun`) | 90.12 % | 32 survived, 2 not covered |
| `trace/trace-reader.ts` | 85.11 % | after a second pass: 79.39 % first, five tests added for the legacy trace-file lines, the file-name anchors, an unreadable directory and the run-id message |

What still survives in `trace-reader.ts` (33 mutants, 6 not covered) is defensive detail: the options of the abort
listener in the poll wait, the shape checks inside `isMissing`, a buffer size that is only ever read up to the file's
length, and two branches for a file that disappears between a listing and a read. They are listed rather than hidden;
none is a behaviour a person would see.

## Known gaps

- **No manual run in Windows Terminal yet.** The dashboard's rendering, keys and terminal restore are tested against a
  fake terminal; `run --tui` is tested with a fake dashboard and, for the child, against the real built binary. The two
  have not been seen together by a person in a real terminal. The maintainer should do that once before announcing it
  (`node packages/cli/dist/bin.js run <workflow> --tui`, then quit with `d` and with `c`).
- The IPC cancel and the detached child are verified end to end on Windows here. On Linux and macOS they rest on CI
  (the new e2e test is not skipped there), not on a local run.
- Finding the new run is a heuristic: the first run in `.indaba/traces` that was not there before the child started.
  Two runs started in the same project in the same instant could be confused; `--task-id` does not help yet because the
  trace id is only known to the child.
- The consensus transcript is not shown (the mesh messages are recorded in no file; a decision of the spec, question 9).
- Legacy `cmd.exe` is not claimed; `--plain` is the fallback.
