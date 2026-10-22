# Self-review: Logging

> **Status**: self-reviewed for the second slice on `feat/logging-sinks-config` (T-03, T-05, T-06, T-07, T-09 for the
> runners, T-11, T-13, T-16, T-17, T-19, T-20), on top of the first (#53). T-10 (the server's logging) was done on
> `feat/web-app`; T-12 (the web Settings screen) is on `feat/web-app-logging`, the web-app branch rebased on this one.

See [`.agents/rules/review.md`](../../.agents/rules/review.md). Stages run: implement, verify, review. Specify, clarify
and plan were done in the first slice; this one followed them, recording the maintainer's confirmation of section 8,
item 7 (`indaba.config`, `indaba report`) and one decision of its own (the terminal Settings screen is a command,
`indaba settings`, not a pane of the run dashboard).

## 1. Boundary and layering

The redaction and the settings serializer are pure and live in `@indaba/core`; the environment arrives as a value.
The remote sinks and `indaba.config` are in `@indaba/engine` (`node:http`, `node:https`, `node:net`, `node:dgram`,
`node:fs`, `yaml`). The runners log through wrappers of the seams they already had (`ProcessSpawner`,
`StreamingProcessSpawner`, `fetch`), so no runner class changed. The Settings screen is in `@indaba/tui`, importing
only the engine, which now re-exports the settings description. Only `main.ts` reads the environment and the
process; `report.ts` and `settings.ts` receive what they need. A plugin adds a sink through `Plugin.logSinks` or
`PluginHost.registerLogSink`, the same `addSink` the composition root has: AC-10 is met.

## 2. Determinism and failure isolation

No clock or randomness in the engine's new files: a GELF chunk id is the process id and a counter, a GELF timestamp
the record's own time. Timers bound attempts and `flush`. A remote sink only queues in `write`; it sends one record at
a time, drops the oldest `debug` record when full, tries once while the collector is down, reports trouble once per
outage, and never rejects. T-16 runs a workflow with an unwritable file sink and a throwing plugin sink and compares
states, output, plugin effects and trace files with a normal run. A second Ctrl+C waits at most 2 s for the flush.

## 3. Public surface and semver

Minor, additive (below 1.0), listed in `api-surface.md` and `CHANGELOG.md`. `createLogger` returns a subtype of what
it returned. `PluginHost.registerLogSink` is optional so a host written elsewhere still type-checks. New commands
`report` and `settings`, a new file `indaba.config`; no existing option, default, event or span attribute changed.
Behaviour a person will notice: errors and traces are redacted by the wider rule (more is replaced, never less), and
a broken `indaba.config` makes every command a usage error, as AC-13 asks.

## 4. Security

The redaction covers the environment's secret values, collectors' credentials, `Authorization` and bearer values,
key and token shapes, URL query and fragment credentials and URL passwords, with hostile-input tests built from
fragments. A collector address comes only from `indaba.config`, must be http, https, tcp or udp, may not hold userinfo,
and a redirect is never followed. A credential is read from the variable `secretEnv` names and is never in a file or
a record. The runners' records hold the program name and the host and path only. `indaba.config` is refused when it is
a link out of the project and is replaced in one rename. `indaba report` redacts every file again, confines a
relative `--out`, and sends nothing. TLS over TCP is not offered (section 8, item 8).

## 5. Observability and honest numbers

No span, attribute or event changed. The numbers (queue 1000, 5 s, 3 retries, 250 ms between retries, 2 s for an
early exit, 20 000 report lines) are named starting values in one place each and in `docs/logging.md`.

## 6. Dependencies and packaging

No dependency added. `pnpm audit --audit-level low`: `No known vulnerabilities found`. `pnpm build && pnpm smoke`:
`smoke-pack: 5 packages packed, installed and booted (indaba 0.1.0-alpha.2)`.

## 7. Verification

```
pnpm qa (Linux, Node v22.22.0, pnpm 9.15.1)
Biome: Found 1 warning. Found 1 info.   (both on main already)
tsc: no errors
      Tests  1424 passed | 1 skipped
All files          |   97.3 |    93.1 |   96.8 |   97.5 |
pnpm e2e: Test Files 8 passed, Tests 31 passed
node scripts/check-workflow.mjs: workflow.ai.yml matches the repository
security audit: no findings; 72 script self-tests pass
```

Tests that would catch a regression: `core/test/redaction.test.ts`, `engine/test/remote-log-sink.test.ts` (real HTTP,
TCP and UDP listeners), `engine/test/project-config.test.ts`, `runners/test/logging.test.ts`,
`cli/test/logging-config.test.ts` (config, collectors, plugin sinks, T-16, the early exit), `cli/test/report.test.ts`,
`cli/test/settings.test.ts`, `tui/test/settings.test.ts`. Run on Linux only; CI runs Windows and macOS.

## Known gaps

- Two processes writing the same day's file each keep their own byte count, so the size cap is approximate then.
- The early exit is tested through `EarlyExit` and `main`, not by sending a real second SIGINT to the built binary.
- The web Settings screen (T-12) is on `feat/web-app-logging`; it merges after this branch and `feat/web-app`.
