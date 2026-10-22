# Self-review: The local web view, delivery step 2 (Run and Stop)

> **Status**: done, 2026-10-22, on `feat/web-app-run-stop` (pull request #59). Stages 6 and 7 ran; stage 8 is the
> maintainer's merge.

Answers to [`.agents/rules/review.md`](../../.agents/rules/review.md).

## 1. Boundary and layering

`@indaba/core` gained declarations only, in `web-contract/api.ts`; `core/test/web-contract.test.ts` (no value, type-only
imports from its own folder) and `architecture.test.ts` pass unchanged. `@indaba/server` spawns nothing and writes nothing:
it defines `RunControl` and calls it, and its `layers.test.ts` is not edited and passes (AC-17). The scan, the confirmation
store, the run copy and the child are in `packages/cli/src/run-control/`, the composition root. `bin.ts` supplies the
platform and `process.kill` to `treeKiller`, and `main.ts` the environment variables to `userConfigFolder`, because
`cli/test/layers.test.ts` keeps `process` and `env` reads in those two files. No runner is named; nothing new for
plugins.

One choice to know about: the server recognises a refusal by `name === 'RunControlError'` and a string `code`, as well as
by class. The command line does not import the optional `@indaba/server`, so it throws its own class with that name; two
installed copies of the package would defeat `instanceof` anyway. Tested on both sides.

## 2. Determinism and failure isolation

The run control takes its id generator, sleep, grace period, limit, parser, config file, pid and child environment by
injection; nothing in it reads the clock, randomness or `process.env` (the CLI is outside the deterministic directories,
but the spec asked for it). The concurrency limit holds across concurrent starts: a slot is reserved before the first
`await` and released in `finally` (test: five starts against four).

Process ownership: every child is in the control's map from the moment it is spawned. Stop is `cancel()` (the IPC
message `bin.ts` already listens for). `stopAll`, called by the server's `close()` before the listener closes, cancels
every live child, waits at most `STOP_GRACE_MS`, then `kill()`s only those still alive; a child that exited is never
signalled (`kill()` is a no-op after its own `close` or `error`). Each child's exit handler deletes its copy, and
`stopAll` waits for those handlers. The e2e test closes `indaba ui` while a run sleeps in a worktree and sees the step's
process gone, the worktree removed and `.indaba/run-inputs/` empty. A crash of `indaba ui` itself leaves its children
running (parent C-12, documented); the next start sweeps the copies.

## 3. Public surface and semver

Minor, as `api-surface.md` classified it before the code. Added: the core types, `canStop`, `RunControl`,
`RunControlError`, `MAX_CONCURRENT_RUNS`, `ServerOptions.runs`, three resources and `POST` on `/runs`;
`CONTRACT_VERSION` 1.1.0. Tightened: a write without an `Origin` is `403` (also the settings `PUT`), recorded under
Changed in `CHANGELOG.md`. CLI: `indaba ui`'s help and closing line changed, no option added. Not changed: no engine
event, span attribute, workflow field, runner, guard or plugin contract. Internal, not exported from `indaba`:
`RunChild.kill()`, `createRunStarter`'s third parameter (now required; its only callers are `bin.ts` and tests).

## 4. Security

- **Request body**: only `workflowId` (a string of 1 to 256 characters) and `confirmedHash` (64 lowercase hex) are read;
  anything else, including `taskId: "../x"`, never reaches the control (test). `workflowId` is only compared with the
  ids of a fresh scan.
- **Paths**: the file that runs is the scan's, re-checked at read time as a regular file whose realpath is inside the
  realpath of its root; the scan follows no link. The copy's name is the server's start id (`web-` and hex), written with
  `wx`, so an existing file or planted link at that name fails the start (test).
- **Command line**: an argument array through `spawn`, no shell, `--` before the file; `taskkill` as an argument array
  with `windowsHide`. `scripts/security-audit.mjs` was run against both kill forms before they were written: no
  findings.
- **Ids from URLs**: start ids match `[A-Za-z0-9_-]{1,64}`, run ids `isRunId`, before any lookup (tests, including `..`
  folded by the URL parser).
- **Writes**: token, `Host`, and the page's own `Origin`, now required (AC-16).
- **Secrets**: the child's environment is `indaba ui`'s, never the page's. A failed start's first line goes through
  `sanitize(redact(...))` (test with a key-shaped value and an escape sequence). No secret is in the confirmation store,
  the copy's name or a log record (the logged fields are ids, a relative path, codes and counts).
- **The summary of use** is text only, sanitised and cut to `MAX_USE_ITEM`; the page renders commands in `<code>`.

## 5. Observability and honest numbers

No span or attribute added. New log records: `cli.ui` `run started` (start id, relative path), `run ended` (start id,
exit code), `runs stopped at exit` (cancelled, killed), `the run copy could not be written`, `a confirmation could not be
saved`; `server.runs` `start refused` (code) and `run stop requested`. `api-surface.md` lists `run started` under
`server.runs`; it is written by the command line, which has the path, under `cli.ui`.

Numbers: every limit (`MAX_CONCURRENT_RUNS`, `STOP_GRACE_MS`, scan depth, files, folders, 1 MiB, ten hashes, item
length) is a named constant labelled a starting value; none was measured. Each refusal is a sentence with a next action,
from the server and, by its code, from the page's catalogue.

Wording found wrong during implementation and fixed: an empty `fs.read` restricts nothing (`docs/workflow-format.md`),
so the summary says "read anything", not "read nothing". Left as the spec words it: a step with no `permissions` reads
"runner default (unrestricted)", though the `acp` runner's own default refuses edits; that overstates what a run may do,
the safe direction for a confirmation.

## 6. Dependencies and packaging

No runtime or optional dependency added (SHA-256 is `node:crypto`). `apsw-gridwright` went from 0.21.3 to 0.22.0 in its
own `chore` commit: a dev dependency of the private page, bundled at build time. `pnpm audit --prod`: no known
vulnerabilities. `pnpm smoke` packs and audits the six packages and boots the installed CLI without the optional ones.

## 7. Verification

```
$ pnpm qa
Checked 298 files in 572ms. No fixes applied.
 Test Files  100 passed (100)
      Tests  1802 passed | 1 skipped (1803)
Statements   : 96.78% ( 7045/7279 )
Branches     : 91.98% ( 5167/5617 )
Functions    : 96.34% ( 1557/1616 )
Lines        : 97.08% ( 6783/6987 )

$ pnpm e2e
 Test Files  10 passed (10)
      Tests  33 passed (33)

$ pnpm smoke
smoke-pack: 6 packages packed and audited; indaba 0.1.0-alpha.2 boots without @indaba/tui and @indaba/server, and the installed server finds its page

$ node scripts/check-workflow.mjs
workflow.ai.yml matches the repository

$ node scripts/security-audit.mjs --source
security audit: no findings (source, manifests, tsconfig, biome.json)

$ node --test scripts/*.test.mjs
# pass 83
# fail 0
```

`node scripts/check-track.mjs --range` could not run in this shallow clone (the baseline commit is not in it); the
pre-commit hook checked each commit's track, and CI runs the range.

Tests that fail without the change: `server/test/run-control.test.ts` (20, over HTTP, including the hostile inputs),
`cli/test/run-control.test.ts` (26, a fake child, real files, traces written by the engine's `RunEventWriter`),
`cli/test/run-child.test.ts` (the group kill takes a grandchild with it), `web/test/client.test.ts` and
`web/test/ui.test.ts` (the panel and Stop), and `cli/e2e/ui-run.e2e.test.ts`.

Operating systems: Linux only here. CI runs the unit and e2e tests on Windows and macOS. The close-while-running part of
the e2e test does not run on Windows, where a signal ends `indaba ui` at once.

## Known gaps

- **The real-browser check of T-18** (320 px, both themes, keyboard) was not done: this environment's network refuses
  the Playwright browser download. The behaviour is tested in happy-dom (focus moves in and stays, Escape, focus
  returns, announcements); the layout below 480 px is CSS only. Do it with `pnpm try:ui -- --demo` before the release.
- **Two `indaba ui` on one project**: the second one's sweep at start can delete the first one's live copies. A child
  reads its file when it starts, so this matters only in the moment between the copy and that read. Worth fixing (a lock
  file, or sweeping only copies whose start id the sweeper owns) if two servers on one project become a supported use.
- **Windows signals**: `Ctrl+C` in a Windows terminal ends `indaba ui` without its teardown in some hosts; the runs it
  started then continue, as after a crash.
