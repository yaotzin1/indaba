---
name: runner_adapter
description: Use when changing RunnerInterface, RunRequest, RunResult, a PTY CLI runner, the OpenRouter SSE runner, ShellRunner or the runner registry. Covers the contract, process lifetime, streaming, cancellation and token usage reporting.
---

# Runner Adapter Specialist

A runner is the one thing that turns a request into an agent's or a command's output. The engine
knows only `RunnerInterface`.

## The contract

`Runners\RunnerInterface::run(RunRequest $request): RunResult`.

- `RunRequest` (final readonly): prompt or command, working directory, environment additions,
  timeout, model hint, a cancellation signal, and a callback or sink for streamed output.
- `RunResult` (final readonly): exit code, bounded output tail, the full output location if kept,
  `TokenUsage` (or null when unknown), duration, and the runner's own metadata.
- Ran and failed: return a `RunResult` with a non-zero code. Could not run: throw
  `RunnerException`. Never return a result for a missing binary.

## The runners

- **`ShellRunner`**: deterministic verification commands (`composer test`, `vendor/bin/phpstan`).
  The only runner that takes a command string the workflow author wrote, and the only user of
  `fromShellCommandline`. Anything composed from agent output must not reach it.
- **`ClaudeRunner`, `CursorRunner`**: CLI agents through `Symfony\Component\Process\Process` with a
  pseudo-terminal where the CLI requires one. PTY is only available on Linux/macOS (`Process::isPtySupported()`); on
  Windows hosts and in a container without a tty the runner must report that clearly, not hang or
  silently fall back to pipes.
- **`OpenRouterRunner`**: HTTP through `symfony/http-client` consuming Server-Sent Events;
  `Runners\SseParser` is a pure, incremental parser (partial chunks, multi-line `data:`, `[DONE]`,
  comments, `: keep-alive`).

## Process rules

- Argument arrays, never concatenated strings (`application_security`).
- `try`/`finally` stops the child on every exit path; a timeout kills the process group, not just the
  parent. Nothing outlives its `run()`.
- Environment is explicit: pass what the agent needs and the secret it is meant to hold, nothing
  inherited by accident from the parent.
- Output is streamed to the sink as it arrives and the result keeps a bounded tail.

## HTTP and SSE rules

Timeouts on connect and total, a bounded body, TLS verification on, the base URL from configuration.
Parse the stream incrementally; a reasoning model can stream for minutes. Take usage from the
provider's final usage frame; if absent, report `null`, not zero.

## Registry

`RunnerRegistry` maps the names in the workflow file (`claude-code`, `openrouter`, `shell`, ...) to
runner instances, rejects unknown names at parse time, and is the only code besides the console
composition root that names a concrete runner.

## Testing

A shared abstract contract test (timeout, cancellation, non-zero exit, missing binary, huge output)
runs against every runner that can run offline. HTTP runners use `MockHttpClient` with a scripted
SSE body split at awkward byte boundaries. No real agent and no network in `tests/Unit`.

To add one: `create_runner`.
