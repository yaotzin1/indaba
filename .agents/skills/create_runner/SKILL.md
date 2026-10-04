---
name: create_runner
description: Use when writing a new runner for an agent CLI, an HTTP API or a command that the built-in runners do not cover. A procedure: the contract, process or HTTP handling, streaming, usage, registration, tests and documentation.
---

# Runner Author's Guide

A procedure, not a policy. The policy is `runner_adapter` and `application_security`; read them first.

## 1. Spec it

It is a feature: copy `specs/_template`, name the runner and its workflow name, say what it wraps,
what it needs (binary, key, base URL), and classify it a minor in `api-surface.md`.

## 2. Write the test first

Vitest, in `packages/runners/test` for a built-in or in your own package for a plugin. Build the
runner against a fake backend: for a CLI runner, a `ProcessSpawner` fake (see
`packages/runners/test/support.ts`) that records the `ProcessSpec` and answers with a canned
outcome, plus one real run of a tiny `node -e` program as an argument vector so it works on every
OS; for HTTP, an injected `fetch` that returns a scripted `ReadableStream`. The contract cases
(success, non-zero exit, timeout, abort, missing binary, large output) must pass. Never make a unit
test depend on a real agent CLI.

## 3. Implement `Runner`

The contract is in `@indaba/core`:

```ts
import { RunResult, RunnerError, type RunRequest, type Runner } from '@indaba/core';

export class ExampleRunner implements Runner {
  readonly name = 'example';

  constructor(private readonly binary = 'example') {}

  async run(request: RunRequest, signal?: AbortSignal): Promise<RunResult> {
    // build an argument ARRAY, start the process, stream chunks to request.onOutput,
    // kill the whole tree on timeout or abort, map the outcome to a RunResult
    throw new RunnerError(`${this.binary} is not implemented`);
  }
}
```

For an agent CLI, extend `AbstractCliRunner` and implement `command(request)`, which returns the
argument vector; the base class handles the PTY or piped process, the timeout, abort and output
streaming. `CommandRunner` covers a CLI that is only a command template.

Checklist while writing it:

- the command is an array and `shell` is never enabled; the prompt goes through stdin or a dedicated
  argument, never into a shell string. On Windows an npm `.cmd` shim cannot be started without a
  shell: point the runner at a native executable;
- environment: only what the agent needs; the API key from the caller's environment, never logged;
- `request.timeoutSeconds` (default 900) and the `AbortSignal` are honoured and the child's whole
  process tree is killed;
- PTY comes from the optional `node-pty` and falls back to piped stdio when it is missing; a runner
  never crashes on import and says which mode ran;
- a missing binary or refused connection throws `RunnerError` with a message that names the fix and
  contains no secret;
- usage is parsed from the provider's own reporting; unknown is `undefined`, not zero.

## 4. Register it

A plugin registers it: `host.registerRunner(new ExampleRunner())`. The built-in set is registered by
the CLI through the same `PluginHost`, with no private path. The name is public schema: choose it
once.

## 5. Document it

A section in `docs/getting-started.md` (or `docs/extending.md` for a plugin) with a workflow snippet,
the required binary or key, what usage it reports and its limits. The snippet is run by a test where
it can be.

## 6. Verify and ship

`pnpm qa`, the self-review in `review.md`, the changelog entry under Added. A runner with side
effects outside its workspace is a security question: say so in the spec.
