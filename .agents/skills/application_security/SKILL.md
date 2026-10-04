---
name: application_security
description: Use before touching anything that starts a process, runs git, builds a path, reads or writes files, calls HTTP, parses YAML or JSON, handles an API key, or emits a log, trace or exception message. Covers the exploit classes Indaba has, with banned constructs and no exceptions.
---

# Application Security Guardian

Indaba runs agents that run commands, on a developer's machine, with API keys in the environment,
fed by text a model wrote. Treat everything a model, a workflow file, a repository or a provider
returns as untrusted. `scripts/security-audit.mjs` blocks the commit on what a scanner can see; the
rest is yours.

## Banned, everywhere, no exceptions

`eval`, `new Function`, the `vm` module, `exec` and `execSync` (a command given as one string),
`shell: true`, any, `!` non-null assertions and inline suppressions (`@ts-ignore`,
`@ts-expect-error`, `@ts-nocheck`, `biome-ignore`, `eslint-disable`). A design that seems to need
one needs a different design.

## Command injection

- Start processes with `spawn` or `execFile` and an argument array, `shell: false`:
  `spawn('git', ['worktree', 'add', '--', path, branch], { cwd })`. No shell, no quoting problem to
  get wrong. On Windows that means a native executable: a `.cmd` shim cannot be started without a
  shell, so do not reach for `shell: true`; resolve the real binary instead.
- A shell interpreter (`/bin/sh -c`, `cmd.exe /c`) is named only inside `ShellRunner`
  (`packages/runners/src/shell-runner.ts`), for the commands the workflow author declared. The audit
  allowlist names that file and nothing else. Nothing derived from model output, file names, branch
  names, task ids or artifacts is ever placed in that string. To pass data to a command, pass it as
  an argv element, stdin or an environment variable.
- A value that starts with `-` can be taken as an option. Put `--` before untrusted positionals and
  validate names against a strict pattern (`^[A-Za-z0-9._-]+$`, no leading dash).

## Path traversal

Artifacts, guard paths, worktree ids and file names from a workflow or a model are joined to a
root and then **resolved and checked to lie inside it**: `path.resolve`, then `path.relative(root,
candidate)` must not start with `..` or be absolute, and `fs.realpath` of the existing parent for
files that exist so a symlink cannot lead out. Reject NUL bytes. Do the check once in one helper
(the engine's `isInside`) and use it everywhere. Windows has drive letters and backslashes: compare
with `path.relative`, never with string prefixes. A guard path that escapes the workspace is a
validation error at parse time.

## Secrets

- Keys are read from the environment at the edge (the CLI) and passed to the one component that
  needs them. Decision logic never reads `process.env`.
- They are absent from: logs, spans, events, error messages, `RunResult`, artifacts, prompts, the
  workflow file, fixtures. An error that includes a request must include a redacted request.
- Authorization headers are set on the `fetch` call, not in URLs, and never echoed.
- A key in a repository is revoked, not just deleted. `.env` is gitignored; the audit fails if a
  `.env` exists in the tree.

## HTTP and SSRF

Global `fetch` with an `AbortSignal.timeout`, a bounded body, and redirects handled deliberately. The
target of a request is configuration chosen by the operator, never a URL taken from model output or
a repository file. If a feature must fetch a user-supplied URL, it resolves the host and refuses
loopback, link-local, private and metadata addresses, and re-checks after each redirect.

## Deserialization and parsing

YAML: the `yaml` package in core-schema mode, no custom tags, parsed into `unknown` and validated
field by field. JSON: `JSON.parse` inside a try, result typed `unknown`, shape checked before use.
No dynamic `import()` or `require` of a path taken from data; the only dynamic import is the CLI
loading a plugin the operator named with `--plugin`.

## Prompt injection reaches the shell

A model's output is the usual route to a shell. Whatever it says, it can only cause what an engine
step is declared to do: a guard, a runner invoked by name, a patch that passes `git apply --check`
and the path rules. A `TOOL_INTENT` message is a request, not an authorisation.

## Resource abuse

Bound output captured, recursion, debate rounds, retries and stream length. An unbounded loop is a
denial of wallet.

## When you find one

Fix the code, add a test that fails without the fix, and record a `Security` entry in the changelog.
Build hostile test strings from fragments so test files stay clean for the audit. Report privately
per `SECURITY.md` if it affects released versions.
