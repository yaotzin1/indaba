# Logging and reporting an issue

Every `indaba` command keeps a log of what Indaba itself did: which configuration it read, which process it started,
which request it sent, which step changed state, what went wrong. Traces say what a run did; the log says what Indaba
did to run it. It is there so a problem seen once can be found again, compared with the next time, and handed to
someone who helps you.

With no setup there is nothing to do: the log is written to `.indaba/logs/` in the project, and `indaba report` turns
the part of it that belongs to one run into a folder you can attach to an issue.

## What is written, and where

Records are JSON lines, one per line, in `.indaba/logs/indaba-<yyyy-mm-dd>.log.jsonl` of the project (for `run`, the
`--workdir` one). Each record has `time`, `level`, `component` (such as `engine.step` or `runner.process`), a fixed
`message`, and `fields`; when they exist, `context` holds `taskId`, `stepId` and `traceId`, and `pid` the process.

| Recorded | Level | Holds |
| :--- | :--- | :--- |
| A command starts and ends (`process.start`, `process.end`) | info | the command name, Indaba and Node versions, platform and architecture; the exit code. Never the arguments |
| A step changes state, a span ends with an error | info | the step, task and trace ids, the reason as one printable line |
| A runner starts and ends a process | info | the program's name, the working folder, PTY or pipes, the exit code. Never the arguments (they carry the prompt) or the environment |
| A runner sends an HTTP request | info | the method, host and path, the status. Never the query, headers or body |
| A plugin registers, or fails to | info | the plugin's name |
| What a step streams | debug | printable text, cut at 1000 characters a field |
| Trouble of Indaba's own: a folder that cannot be written, a collector that is down, a sink that failed | warn | also printed on standard error |

Records at `warn` and above are also printed on standard error as one plain line. Standard output does not change.

## Secrets

Every record passes one redaction before any file, terminal or collector sees it. It removes:

- the value of every environment variable whose name contains `key`, `token`, `secret`, `password`, `passwd` or
  `credential` (four characters or longer), and the credential of every log collector;
- `Authorization` values and bearer tokens;
- text shaped like an API key or token: OpenAI-style `sk-...`, GitHub, GitLab, Slack, AWS, Google, a JWT, a private
  key block;
- a credential in a URL's query or fragment (`?access_token=`, `#token=`) and the password in `scheme://user:password@`.

The same redaction applies to the errors, traces and events Indaba writes. A secret of another shape, in a variable
named otherwise, is not known to it: a log still names paths, commands and what agents wrote, so read it before you
send it.

## Configuring it: `indaba.config`

Put a YAML file named `indaba.config` in the project root to change the defaults. It holds one section, `logging:`,
and you can commit it with the workflow; it never holds a secret.

```yaml
logging:
  level: info            # error, warn, info or debug: how much is recorded at all
  sinks:
    - type: file         # the JSON-lines files
      level: debug
      folder: .indaba/logs
      maxFileBytes: 10485760
      maxFiles: 10
    - type: stderr       # standard error
      level: warn
    - type: gelf         # Graylog, or anything that takes GELF 1.1
      address: https://graylog.example.com:12201/gelf
      level: warn
      secretEnv: GRAYLOG_TOKEN
    - type: http-json    # any collector that takes one JSON record per POST
      address: https://logs.example.com/indaba
```

Leave a key out and its default applies; leave the file out and everything does. An unknown key, a wrong type or an
unknown section is a usage error naming the key, so a typo is never ignored. `indaba settings` opens a screen to edit
the file (below), and keeps your comments and other keys when it saves.

| Setting | Default | Meaning |
| :--- | :--- | :--- |
| `level` | `info` | The least severe records kept at all. `debug` adds what steps stream |
| `sinks` | `file`, `stderr` | Where records go. Each sink has its own `level`, at or above the one of the log |
| file `folder` | `.indaba/logs` | A relative folder stays inside the project; an absolute one is allowed because you typed it |
| file `maxFileBytes` | 10 MiB | A new file is started when the current one would pass it |
| file `maxFiles` | 10 | The oldest files beyond this number are deleted |
| file `level` | `debug` | |
| stderr `level` | `warn` | |
| gelf, http-json `address` | none | `https://`, `http://`; for GELF also `tcp://host:port` and `udp://host:port`. No user name or password in it |
| `secretEnv` | none | The **name** of the variable holding the collector's credential, sent as the `Authorization` header (a bare value as `Bearer <value>`) |
| `queueLength` | 1000 | Records held while a collector is slow; when full, the oldest `debug` record goes first |
| `timeoutSeconds` | 5 | One attempt that has not finished in this time has failed |
| `retries` | 3 | Further attempts while the collector is up; while it is down, each record is tried once |
| gelf, http-json `level` | `info` | |

The numbers are starting values, not measurements, and will be revised from real logs.

What decides the level, strongest first: `--log-level`, the variable `INDABA_LOG_LEVEL`, `indaba.config`, the default.
`--log-dir <dir>` replaces the folder of every file sink for one command.

## Sending logs to Graylog or a collector

A remote sink never holds up a command. Records are queued and sent in the background, one at a time; a collector that
does not answer costs one warning per outage (`a log collector cannot be reached`), not one per record, and another
when it answers again. When a command ends it waits at most one timeout for what is still queued, and says how many
records it dropped.

For Graylog, the GELF HTTP input is the easiest: a plain POST that goes through most firewalls. TCP (each message ended
by a zero byte, on one kept connection) and UDP (chunked past 8 KiB) are there because many installations only open
those. TLS over TCP is not offered; use the HTTPS input for an encrypted connection. Every record field becomes a GELF
additional field (`_component`, `_stepId`, `_pid`, ...), and `timestamp` is the record's own time.

The credential never goes in the file. Name the variable that holds it:

```yaml
    - type: gelf
      address: https://graylog.example.com/gelf
      secretEnv: GRAYLOG_TOKEN
```

and set `GRAYLOG_TOKEN` in the environment of the command. When the variable is not set, the command warns once and
sends without a credential.

## The Settings screen: `indaba settings`

On a terminal, with `@indaba/tui` installed, `indaba settings` shows every setting with its value and its default
beside it. The arrows move and change a level, Enter edits a value, `d` puts back the default, `x` removes a sink, the
rows at the bottom add one, `t` sends one test record through the selected sink, `s` saves and `q` leaves (and asks
first when something is not saved). Every value is checked as you type by the same rules as the file, so what the
screen saves is what the file would accept. A collector's credential is entered as the name of its variable; the
screen shows whether that variable is set, never what it holds.

Anywhere else, and with `--plain`, it prints the settings in use. `-w <dir>` names another project.

## Reporting an issue: `indaba report`

```bash
npx indaba report            # the latest run
npx indaba report 3f2a91     # a run by the start of its id (indaba watch lists them)
```

It writes a folder under `.indaba/reports/` (or `--out <dir>`) and prints what is in it:

| File | Holds |
| :--- | :--- |
| `log.jsonl` | the log lines of the commands that ran the run, from every file sink of the project |
| `events.jsonl`, `trace.jsonl` | what the run did, and its spans with tokens and cost |
| `workflow.ai.yml` | the workflow file (`.indaba/workflow.ai.yml`, or `--workflow <file>`) |
| `indaba.config` | the project configuration, when there is one |
| `environment.json` | Indaba, Node, the platform and architecture, now and when the run started |
| `README.txt` | what is here, and what could not be included |

Everything in it passes the redaction again. It sends nothing anywhere: read the folder, then attach it to an issue.

## For plugin authors

`host.logger` is the logger of the command; see [extending.md](extending.md#logging-from-a-plugin). A plugin can also
add a place records go, a **sink**, for a service Indaba does not ship:

```js
export default {
  name: 'my-sink',
  logSinks: [{ level: 'warn', write: (record) => send(record), flush: () => drain() }],
  register(host) {
    // or, from inside register:
    host.registerLogSink?.({ write: (record) => send(record) });
  },
};
```

A sink receives the same redacted records as the built-ins. `write` must not throw and must not wait: queue and send in
the background, and let `flush` (called once when the command ends) wait for the queue. A sink that throws is dropped
for the rest of the command after one warning to the others; it never reaches the run.
