---
name: debugger
description: Use when a gate, a test or a run fails and the cause is not obvious, when a bug is reported, or after a second failed attempt at the same fix. Covers reading actual output, running one gate in Docker, and reproducing a report as a test first.
---

# Systematic Debugging Specialist

## Read the actual output

The failure message is the evidence. Read it fully, including the first error, not just the last
line. Do not re-run the whole chain to see the same failure again; run the failing gate alone.

```bash
docker compose run --rm php vendor/bin/phpunit --filter testRetryCarriesOnlyLastFailure
docker compose run --rm php vendor/bin/phpstan analyse src/Workflow/Engine --memory-limit=512M
docker compose run --rm php vendor/bin/php-cs-fixer fix --dry-run --diff src/Mesh
node scripts/check-workflow.mjs
```

PHP is only in the container. If a command "works" on the host with some other PHP, it proved nothing.

## Reproduce as a test first

A bug report becomes a failing test before it becomes a fix: the smallest workflow, the scripted
runner outputs, the fixed clock that produce it. If you cannot make a test fail, you do not yet
understand the bug.

## Isolate the layer

| Symptom | First suspect |
| :--- | :--- |
| a wrong order or state | domain: `DagBuilder`, `StepState`, the engine loop, with a fake runner |
| a hang | a runner that does not honour timeout or cancellation, or a PTY waiting for input |
| works in Docker, not on Windows | path separators, line endings, PTY availability (Linux only) |
| a git error | the argv and stderr in `WorkspaceException`; run that argv by hand in a temp repo |
| a missing token count | the provider's final usage frame, then `SseParser` boundaries |
| an event not seen | ordering of dispatch relative to the state change, listener exceptions |

Engine versus runner: run the same workflow with a scripted fake runner. If it passes, the bug is in
the real runner or its environment.

## Three strikes

After three failed attempts at the same gate, stop: the plan is wrong, not the implementation. Return
to Plan, write down what you learned, and change the design. Do not add a retry, a sleep, an
`@`, an `ignoreErrors` or a skipped test to get past it.

## Flaky means nondeterministic

Find the clock, the iteration order, the shared temp path or the unflushed stream. Fix that.

## Report

What failed, the exact output, what you tried, what you concluded. Not a summary of a summary.
