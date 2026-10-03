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

Extend the shared runner contract test case in `tests/Unit/Runners` with a subclass that builds your
runner against a fake backend: a tiny PHP or shell script written to a temp directory for a CLI, a
`MockHttpClient` response sequence for HTTP. The contract cases (success, non-zero exit, timeout,
cancellation, missing binary, large output) must pass without changes to the base class.

## 3. Implement `RunnerInterface`

```php
declare(strict_types=1);

namespace Indaba\Runners;

final class ExampleRunner implements RunnerInterface
{
    public function __construct(private readonly string $binary = 'example') {}

    public function run(RunRequest $request): RunResult
    {
        // build an argument ARRAY, start the Process, stream output to the request's sink,
        // stop the child in finally, map the outcome to a RunResult
    }
}
```

Checklist while writing it:

- the command is an array; the prompt goes through stdin or a dedicated argument, never into a shell
  string;
- environment: only what the agent needs; the API key from the caller's environment, never logged;
- the timeout and cancellation in the request are honoured and the child is killed with its group;
- a missing binary or refused connection throws `RunnerException` with a message that names the
  fix and contains no secret;
- usage is parsed from the provider's own reporting; unknown is `null`, not zero.

## 4. Register it

Add its name to `RunnerRegistry` (and the console composition root's default registry). The name is
public schema: choose it once.

## 5. Document it

A section in `docs/` with a workflow snippet, required binary or key, what usage it reports and its
limits (for PTY runners, the Linux-only caveat). The snippet is run by a test where it can be.

## 6. Verify and ship

`docker compose run --rm php composer qa`, the self-review in `review.md`, the changelog entry under
Added. A runner with side effects outside its workspace is a security question: say so in the spec.
