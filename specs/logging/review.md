# Self-review: Logging

> **Status**: self-reviewed for the slice on `feat/logging` (T-01, T-02, T-04, T-07 in part, T-08, T-09 in part, T-14,
> T-15, T-18, T-21, T-22). The rest of `tasks.md` is open and named under Known gaps.

See [`.agents/rules/review.md`](../../.agents/rules/review.md).

## 1. Boundary and layering

`packages/core/src/logging` imports only itself; `architecture.test.ts` checks it. `FileLogSink` and `logEngineEvents`
are in `@indaba/engine` and import only `node:` modules and `@indaba/core`. The engine re-exports the logging contract
so `@indaba/tui`, which may only import the engine, uses the same `Logger`; its layers test is unchanged. Only the
command line builds a logger; every other package receives one. The layers tests of core, engine, runners and tui now
fail on `console.*` and on a direct `process.stdout`/`process.stderr` write. A plugin receives the same logger as the
built-ins through `host.logger`, but **it cannot add a sink yet** (T-03): until then the built-in file and standard-error
sinks have a door a plugin lacks, which AC-10 does not allow once the feature is complete.

## 2. Determinism and failure isolation

The clock, the process id and the redaction are injected into `createLogger`; the command line passes `new Date()` and
`process.pid` from `main.ts`, the one module allowed to read the process. The file sink takes the date of a file from the
record, never from the wall clock. `logEngineEvents` gives the same records in the same order for the same events and
clock (a test, AC-12). A sink that throws is dropped after one warning to the others; a file sink that cannot write
stops after one warning and never throws; a bridge whose every sink throws does not fail the dispatch (a test). No
process or worktree is started by this change. AC-11 for a whole run with every sink failing (T-16) is not tested yet.

## 3. Public surface and semver

Minor, additive (below 1.0), recorded in `api-surface.md` and `CHANGELOG.md`. Added: in `@indaba/core` the logging
contract, `LOGGING_DEFAULTS`, `LOGGING_SETTINGS`, `resolveLoggingSettings` and the optional `PluginHost.logger`; in
`@indaba/engine` `FileLogSink`, `FileLogSinkOptions`, `logEngineEvents`, `EventSource` and the re-exported contract; in
`indaba` `--log-level`, `--log-dir`, `INDABA_LOG_LEVEL` and `CreateEngineOptions.logger`; in `@indaba/tui`
`WatchOptions.logger`. No existing signature, default, workflow field, event or span attribute changed, and standard
output of every command is byte-for-byte the same (the existing CLI tests are unchanged). **One behaviour a person will
notice:** `validate`, `plan` and `watch` now write `.indaba/logs/` in the directory they run in, where they wrote nothing
before. `PluginHost.logger` is optional so a host someone else implemented still type-checks; making it required later
is a breaking change.

## 4. Security

The log folder is resolved and confined to the project when relative (also through a link, checked with `realpath`);
an absolute one is accepted only from the person's own `--log-dir`. File names come from the record's time, never from
input. The values of environment variables named like a key, token, secret, password or credential are redacted in
`createLogger`, before any sink. **Not yet:** bearer tokens, API-key shapes and the `#token=` fragment (T-06). Until
then a secret that is not in the environment but appears in a step's failure reason or a span's status message (both
logged at `info` by the bridge) reaches the file; both are printable-filtered, put on one line and cut at 1000
characters. Agent output is logged only at `debug`. Arguments are never logged, only the command name. No HTTP.

## 5. Observability and honest numbers

No span, attribute or event is added or changed; the bridge reads events and writes nothing back. The numbers
(10 MiB a file, 10 files, 1000 characters a field) are named as starting values in one module and in the docs, not as
measurements. A log folder that cannot be written is one sentence naming the folder, and the command goes on.

## 6. Dependencies and packaging

No dependency added (`node:fs`, `node:path` only). `pnpm audit --audit-level low` reports 6 advisories, all in `vite`
8.3.0 to 8.3.2 through the dev dependency `@stryker-mutator/vitest-runner`; `main` at `e505fe2` reports the same 6, so
this branch adds none. Packages publish `dist` only; `pnpm build && pnpm smoke` passes:
`smoke-pack: 5 packages packed, installed and booted (indaba 0.1.0-alpha.2)`.

## 7. Verification

```
pnpm qa (Linux 6.18, Node v22.22.0, pnpm 9.15.1)
Biome: Found 1 warning. Found 1 info.   (both on main already: an unused variable in arbiter-flow.test.ts,
                                         the deprecated "recommended" field in biome.json)
tsc: no errors
 Test Files  69 passed (69)
      Tests  1319 passed | 1 skipped (1320)
All files          |   97.63 |    93.59 |   97.32 |   97.88 |

node scripts/check-workflow.mjs
workflow.ai.yml matches the repository
```

The node gates (skills, pointer sync, agent docs sync, security audit, 72 script self-tests) pass, and
`check-track --range main..HEAD` reports every commit matching its track. Tests that would catch the absence or a
regression: `engine/test/file-log-sink.test.ts`, `engine/test/log-events.test.ts`, `cli/test/logging.test.ts` (a real
run with a plugin that logs through `host.logger`), the logging cases in `tui/test/dashboard.test.ts` and
`tui/test/watch.test.ts`, and the layers tests. Run on Linux only; Windows and macOS run in CI. The link test uses a
junction so it needs no privilege on Windows, which has not been seen to pass there yet.

## Known gaps

- `indaba.config` (`logging:`) waits for section 8, item 7 to be confirmed; until then only the options and the
  variable configure logging.
- T-03 plugin sinks, T-05 remote sinks, T-06 the full redaction, T-16 the all-sinks-failing run, T-10 and T-12/T-13
  (the server and the settings screens), T-17 a docs page of its own, T-20 the rule in `workflow.ai.yml`.
- The runners do not receive the logger; the server gets it when `feat/web-app` is rebased on this.
- A second Ctrl+C exits before the sinks are flushed, so the last records can be lost.
- Two processes writing the same day's file each keep their own byte count, so the size cap is approximate then.
