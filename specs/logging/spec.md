# Specification: Logging

> **Status**: Draft (stage 1, with the clarifications of section 8 as recommendations for the maintainer to confirm)
> **Stage entry**: 1
> **Semver impact**: minor (a new `Logger` contract in `@indaba/core`, a CLI option and a new file under `.indaba/`;
> nothing existing changes meaning)

---

## 1. The problem

Indaba has traces (what a run did, for the dashboards) and a typed event stream, but nothing records what Indaba itself
did: which configuration it read, which process it started, which request the local server refused, why a plugin failed to
load, which error was swallowed. When a run, a runner or `indaba ui` misbehaves, the person has the terminal text of that
moment and nothing afterwards, and a non-developer (who may not keep a terminal open at all) has nothing to send to whoever
helps them. Every package prints, or stays silent, in its own way.

The purpose is **reporting and tracking issues**. Without a record that ties each line to the run, the step and the
process it belongs to, a problem seen once cannot be found again, compared with the next occurrence, or handed to someone
else. A team that already keeps logs somewhere (Graylog, a log server, a file collector) must be able to send Indaba's
there, and a person with nothing must still get usable files with no setup.

## 2. User stories

- **US-01.** As a person running Indaba, when something goes wrong I find a log file that says what happened, in plain
  words, and I can attach it to a report without reading it first for secrets.
- **US-02.** As a developer embedding the engine, I pass one `Logger` and every package writes through it; I pass none and
  nothing is printed or written.
- **US-03.** As the author of a plugin, I receive a logger and log through it like a built-in does; I can also register a
  sink (a place logs go) without editing core, engine or runners.
- **US-04.** As a maintainer, I raise one level to see more, without a code change.

## 3. Acceptance criteria

- [ ] AC-01. `@indaba/core` defines `Logger`, `LogLevel`, `LogRecord` and `LogSink` as declarations plus a small
  `createLogger` that takes a sink list, a clock and a minimum level. It imports no `node:` module and reads no clock,
  environment or process by itself.
- [ ] AC-02. The levels are `error`, `warn`, `info`, `debug`, in that order. A record below the minimum level is dropped
  before any sink sees it. The default minimum level is `info`.
- [ ] AC-03. Logging is **a must for the whole project**: every package that starts a process, reads or writes a file,
  calls HTTP, loads a plugin, parses a workflow, or catches an error logs it through the injected `Logger`. A layers test
  in each package fails on a bare `console.*` or `process.stdout.write` outside the one module that is the output of the
  command line (the existing `cli` rule, extended to engine, runners, server and tui).
- [ ] AC-04. A record is `{ time, level, component, message, fields? }`. `time` comes from the injected clock, `component`
  is the package and area (`engine.worktree`, `server.http`), `message` is a fixed sentence, and `fields` holds only
  strings, numbers and booleans. Untrusted text (agent output, a workflow's goal, a request path) goes in `fields`, never
  into `message`.
- [ ] AC-05. **Secrets never reach a record.** Every record passes the existing redaction (the environment's secret
  values, bearer tokens, API-key shapes, the `#token=` fragment) before any sink sees it, so a sink cannot forget to.
  Agent output and prompts are not logged at `info`; at `debug` they are length-limited and printable-filtered (the
  `printable.ts` rule).
- [ ] AC-06. With no setup, the command line writes a JSON-lines file to `.indaba/logs/indaba-<yyyy-mm-dd>.log.jsonl` in
  the project, one record per line. The size of a file and the number of files kept are **settings** (`maxFileBytes`,
  `maxFiles`); the defaults are in section 8. It never writes outside the project root unless the person names another
  folder (AC-13), and the path never comes from untrusted input.
- [ ] AC-13. **Logging is configurable.** A `logging` section of the project configuration (and the command-line options
  for the common ones) sets: the minimum level; the list of sinks and each one's settings; `maxFileBytes` and `maxFiles`
  for the file sink; the folder of the file sink (a path resolved and confined like `--workdir`, or an absolute path the
  person typed themselves); and whether `stderr` also receives `warn` and above. Unknown keys and wrong types are a
  usage error that names the key, never ignored.
- [ ] AC-14. **Records can be correlated.** Every record carries, when they exist, `runId`, `taskId`, `stepId`, `traceId`
  and `pid`, so one run, or one failure, can be found with a filter. Each process writes a `process.start` record with the
  Indaba version, Node version, operating system and the command name (never its arguments' values when they could hold
  a secret), so a report states its environment without being asked.
- [ ] AC-15. **Sinks shipped.** `file` (AC-06), `stderr` (AC-08), `gelf` (Graylog's JSON format, GELF 1.1, over HTTP, TCP
  or UDP, written with `node:http`, `node:net` and `node:dgram`: no dependency is added) and `http-json` (one JSON record
  per POST to a URL, for any collector that takes JSON). Any other destination is a plugin sink (AC-10). Each sink has its
  own level, so a collector can receive `warn` while the file keeps `debug`.
- [ ] AC-16. **A remote sink never stops a run.** Sends are asynchronous, bounded (a queue of limited length; when it is
  full the oldest `debug` records are dropped and the count is logged once), time-limited, and retried a bounded number of
  times. A destination that is down costs one `warn` per outage, not one per record. The destination address comes from
  configuration only, must be `http`, `https`, `tcp` or `udp`, is never taken from a workflow, an agent or a request,
  and a credential in it is read from a named environment variable, never written in the file or the log.
- [ ] AC-18. **Defaults.** Every setting has a default, so Indaba logs usefully with no configuration and a fresh clone
  needs no file. The defaults are the table in section 8 (item 2), named constants in one module of `@indaba/core`, shown
  by `indaba` in the settings screens as "default" next to the value in use, and restorable one by one.
- [ ] AC-19. **One description of the settings.** `@indaba/core` exports a declarative `LOGGING_SETTINGS` schema: for each
  setting its key, type, default, allowed range or values, a plain-words label and help text, and whether it is secret.
  The configuration parser, the command-line help, the web page and the terminal dashboard are all built from it, so a
  setting is added in one place and a UI never carries a second, drifting copy of a default or a limit.
- [ ] AC-20. **Editable from the UI and the TUI.** The web page (`indaba ui`) and the terminal dashboard each have a
  Settings screen for logging: the values in use, the default beside each, validation as the person types, a test of a
  sink ("send one test record"), and Save. Save writes the `logging:` section of `indaba.config` through the same parser
  and validation as a hand-edited file, keeping comments and unrelated keys. This is the first thing the read-only server
  writes, so it arrives with the actions step of `specs/web-app`, not with step 1, and has its own requirements there: the
  token, the `Host` check, a `PUT` the server accepts for this one resource only, a confined path, and the secret rule
  below. Until then the file, the options and the variable are the way.
- [ ] AC-21. **Secrets in settings.** A setting marked secret (a collector's password or token) is entered in the UI as
  the *name of an environment variable*, never the value, and is never sent back to the page, written to the file or
  logged. The page shows whether that variable is set in the server's environment (set / not set), not what it holds.
- [ ] AC-17. **Reporting an issue.** `indaba report [run]` writes one redacted bundle (a folder or an archive) with the
  relevant log lines, the run's trace and events, the workflow file, and the environment record of AC-14, and prints what
  it contains and where it is. It sends nothing anywhere. (Recommendation; see section 8, item 7.)
- [ ] AC-07. `indaba <command> --log-level <error|warn|info|debug>` and the environment variable `INDABA_LOG_LEVEL` set
  the minimum level; the option wins. Anything else is a usage error that names the allowed values. Only `main`, `bin` and
  the engine factory read the environment (the existing layers rule).
- [ ] AC-08. `warn` and `error` records are also written to standard error in plain text (`level: message`, then
  `key=value` fields); `info` and `debug` go to the file only, so the output of a command does not change.
- [ ] AC-09. `indaba ui` logs through the same logger: the server starting and stopping, the address (never the token),
  each refused request (method, path without any query or fragment, status, reason), and each stream opening and closing.
  It logs no request body and no `Authorization` header.
- [ ] AC-10. A sink is an extension contract: `Plugin` and `PluginHost` accept a `LogSink`; a failing sink is isolated (it
  is dropped for the rest of the run after one `warn` to the other sinks and never throws into the engine), and the
  built-in file sink gets no access an external sink lacks.
- [ ] AC-22. **The engine's events reach the log.** `logEngineEvents(events, logger)` in `@indaba/engine` listens to
  the events a run already dispatches and writes: every step state change (`info`, `taskId` and `stepId` in the
  context, the reason as a printable one-line field), every span that ends with an error (`info`, `traceId` in the
  context), and what a step streams (`debug` only, printable-filtered and cut by the logger). None of it is `warn`: the
  outcome of a run is already on standard output, and `warn` is kept for trouble of Indaba's own. Code that announces
  what it does through events needs no logger calls of its own, and the ids lead from a log line to the trace.
- [ ] AC-23. **One place to plug a logger in.** The engine package re-exports the logging contract, so a package that
  may only import the engine (the terminal dashboard) takes `Logger` from the same place as the others. `createEngine`
  of `indaba` takes `logger` and connects it to the engine's events and to the plugins (`PluginHost.logger`); the
  dashboard's `watch` takes `logger` and records when it opens and closes and a run source that fails (at `info`,
  because `warn` would be printed over the screen).
- [ ] AC-11. Logging never changes behaviour: a run with every sink failing ends with the same states, events and traces as
  one with none.
- [ ] AC-12. The engine stays deterministic with a logger: the same inputs and the same fake clock produce the same
  records in the same order, which a test asserts.

## 4. Non-goals

- A log viewer in the web page or the terminal dashboard (the page may add one later; the files are readable now).
- Sinks for services beyond `gelf` and `http-json` (syslog, OpenTelemetry logs, a vendor's API). A sink plugin can do
  it; the project does not ship them.
- A log server, a search index or an issue tracker inside Indaba. Indaba produces and forwards the records; tracking
  happens in the tool the team already uses.
- Replacing traces or events. Traces say what a run did and feed the dashboards; logs say what Indaba did to run it.
  Logs are not sent as events either: the dispatcher of a run exists only once an engine does, while a command logs
  from its first line, and every event is public surface. The bridge of AC-22 goes the other way, events into the log,
  and keeps to the state changes and errors a report needs, with the ids that lead to the trace for the rest.
- Log levels per package or per component in this step (one global minimum).
- Logging of agent conversations as a record of the debate (that is the transcript, `specs/run-blackboard`, T-21 of
  `specs/web-app`).

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the log directory cannot be created or written | one `warn` on standard error naming the folder; the command goes on without the file sink |
| the disk fills during a run | the file sink stops after one `warn`; the run is not affected (AC-11) |
| a sink throws | it is dropped for the rest of the run; the other sinks get one `warn`; nothing propagates |
| a field value is not a string, number or boolean | the value is replaced by its type name and the record is kept |
| a field holds a secret the redaction does not know | the guarantee is as strong as the redaction; a new key shape is added to the redaction and its test, never worked around in a sink |
| two commands write the same day's file at once | each appends whole lines (one write per record); lines may interleave but are never cut |
| `--log-level` has an unknown value | usage error naming the four levels, exit code 2 |

## 6. Security and data handling

- **Untrusted data never reaches a shell, a path or a log.** For logging the third clause is the point: a record's
  `message` is a constant of the source; everything from outside goes in `fields`, is printable-filtered and is
  length-limited. A log file is data, and a viewer that shows it must treat it as text (the same rule as AC-16 of
  `specs/web-app`).
- The log path is `<project root>/.indaba/logs/`, derived from the root the command already confined. A date in a file name
  is produced by the injected clock, never taken from input.
- `.indaba/` is already gitignored. A log may still name paths and commands, so the redaction is the only promise made about
  secrets, and any page that asks someone to send a log must say so.
- Redaction is applied in `createLogger`, once, before the sinks (AC-05), and has hostile-input tests with strings built
  from fragments, as `scripts/security-audit.mjs` requires.

## 7. Where it lives

- `@indaba/core`: `Logger`, `LogLevel`, `LogRecord`, `LogSink`, `createLogger`. The redaction is passed in as a function, so
  core reads no environment. Pure domain.
- `@indaba/engine`: the file sink (`.indaba/logs`, size cap, rotation), beside the JSONL span exporter that already does the
  same kind of work.
- `indaba` (the CLI): `--log-level`, `INDABA_LOG_LEVEL`, the standard-error sink, and the composition root that builds the
  one logger and hands it to the engine, the runners, the server and the plugins.
- `@indaba/runners`, `@indaba/server`, `@indaba/tui`: receive a `Logger` in their options; a missing one is a no-op logger.

## 8. Clarifications (recommendations, for the maintainer to confirm)

1. **Format:** JSON lines, one record per line; plain text only on standard error. A file a person attaches to a report and
   a tool can filter.
2. **Location, retention and defaults:** `.indaba/logs/indaba-<date>.log.jsonl`. The maintainer asked for defaults, so
   these are proposed **starting values, not measurements**: no data in this repository says what a typical log size is,
   and the rule against invented numbers is met by naming them as starting values in one module and revising them from
   the first real logs.

   | Setting | Default | Why this starting value |
   | :--- | :--- | :--- |
   | `level` | `info` | `debug` adds prompts and output and is opt-in |
   | `sinks` | `file`, `stderr` | works with no setup; remote sinks are opt-in |
   | `maxFileBytes` | 10 MiB | a day of `info` should fit in one file; a person can still open it in an editor |
   | `maxFiles` | 10 | about ten days of history in a bounded amount of disk |
   | `folder` | `.indaba/logs` | inside the gitignored runtime folder |
   | `stderr.level` | `warn` | stdout and normal output stay unchanged |
   | remote queue length | 1000 records | bounds memory when a collector is down |
   | remote send timeout | 5 seconds | a slow collector must not hold up a command |
   | remote retries | 3 | bounded, then dropped with one warning |

   All of them are settings (AC-13) and editable (AC-20).
3. **User-chosen location:** a `folder` setting and `--log-dir <dir>`, the same idea as the debate log (answer 8 of the
   web-app sketches). A relative path is confined to the project like `--workdir`; an absolute one is accepted only
   because the person typed it in their own configuration, never from a workflow file.
4. **Default level `info`;** `debug` adds prompts and output (limited, filtered) and is off unless asked.
5. **Standard error carries `warn` and above** so nothing on standard output changes (scripts that parse it keep working).
6. **A workflow rule?** "A must for the whole project" belongs in `workflow.ai.yml` as an architectural rule enforced by the
   layers tests. That file is protected: the change needs a `Workflow-Change:` trailer and the sync scripts. Recommendation:
   yes, in a separate commit after the contract exists.
7. **Where the settings live.** No project configuration file exists yet (`specs/agent-sandbox` mentions `indaba.config`
   without defining it). Recommendation: this feature introduces the `logging` section of `indaba.config` (YAML, parsed
   with the `yaml` package the engine already uses) and nothing else, and the sandbox spec adds its keys later. Options
   and `INDABA_LOG_LEVEL` override it. The alternative is only options and variables, which cannot express a list of
   sinks. **`indaba report` (AC-17)** is a recommendation too: it is what makes "report an issue" one command for a
   non-developer. It may ship in a second step after the sinks.
8. **Graylog.** GELF over HTTP is the recommended default for Graylog (a plain POST, easiest through firewalls); TCP and
   UDP are supported because many installations only open those. TLS for TCP is out of this step unless the maintainer
   needs it, because `node:tls` is a security surface of its own.

## Artifacts not written

- `events.md`: logging adds no event and no span attribute (records are not events).
- `data-model.md`: the record shape is in `api-surface.md`.
- `research.md`: no library is added; the logger is small and a dependency is a recorded decision this does not need.
