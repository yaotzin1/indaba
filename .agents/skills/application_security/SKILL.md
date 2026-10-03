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

`eval`, the shell functions (`exec`, `shell_exec`, `system`, `passthru`, `popen`, `proc_open`,
`pcntl_exec`), the backtick operator, the `@` operator, `unserialize` on non-JSON data without
`allowed_classes => false`, variable includes, `extract`, raw `curl_*` and sockets, inline
`@phpstan-ignore`. A design that seems to need one needs a different design.

## Command injection

- Start processes with `new Process(['git', 'worktree', 'add', '--', $path, $branch])`: an argument
  array, no shell, no quoting problem to get wrong.
- `Process::fromShellCommandline` exists only inside `ShellRunner`, for the commands the workflow
  author declared. Nothing derived from model output, file names, branch names, task ids or
  artifacts is ever placed in that string. If you need to pass data to a command, pass it as an argv
  element, stdin or an environment variable.
- A value that starts with `-` can be taken as an option. Put `--` before untrusted positionals and
  validate names against a strict pattern (`^[A-Za-z0-9._-]+$`, no leading dash).

## Path traversal

Artifacts, guard paths, worktree ids and file names from a workflow or a model are joined to a
root and then **resolved and checked to lie inside it** (`realpath` of the parent for new files;
reject `..`, absolute paths, NUL bytes, and symlinks leading out). Do the check once in one helper
and use that helper everywhere. A guard path that escapes the workspace is a validation error at
parse time.

## Secrets

- Keys are read from the environment at the edge and passed to the one component that needs them.
- They are absent from: logs, spans, events, exception messages, `RunResult`, artifacts, prompts, the
  workflow file, fixtures. Exceptions that include a request must include a redacted request.
- Authorization headers are set on the HTTP client, not in URLs, and never echoed.
- A key in a repository is revoked, not just deleted. `.env` is gitignored; the audit fails if a
  `.env` exists in the tree.

## HTTP and SSRF

One shared `symfony/http-client` with timeouts, a maximum body size, TLS verification on, and
redirects limited. The target of a request is configuration chosen by the operator, never a URL
taken from model output or a repository file. If a feature must fetch a user-supplied URL, it
resolves the host and refuses loopback, link-local, private and metadata addresses, and re-checks
after each redirect.

## Deserialization and parsing

YAML: `Yaml::parse` with no `PARSE_OBJECT*` or `PARSE_CONSTANT` flags. JSON: `json_decode` with
`JSON_THROW_ON_ERROR`, then validate shape before use. Never `unserialize` data from a file, a
process or a provider.

## Prompt injection reaches the shell

A model's output is the usual route to a shell. Whatever it says, it can only cause what an engine
step is declared to do: a guard, a runner invoked by name, a patch that passes `git apply --check`
and the path rules. A `TOOL_INTENT` message is a request, not an authorisation.

## Resource abuse

Bound output captured, recursion, debate rounds, retries and stream length. An unbounded loop is a
denial of wallet.

## When you find one

Fix the code, add a test that fails without the fix, and record a `Security` entry in the changelog.
Report privately per `SECURITY.md` if it affects released versions.
