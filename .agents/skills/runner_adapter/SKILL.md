---
name: runner_adapter
description: Use when changing the Runner interface, RunRequest, RunResult, a CLI agent runner, the OpenRouter SSE runner, ShellRunner or the runner registry. Covers the contract, process lifetime, streaming, cancellation and token usage reporting.
---

# Runner Adapter Specialist

A runner is the one thing that turns a request into an agent's or a command's output. The engine
knows only the `Runner` interface from `@indaba/core`.

## The contract

`Runner` (packages/core/src/runner): `readonly name: string` and
`run(request: RunRequest, signal?: AbortSignal): Promise<RunResult>`.

- `RunRequest` (readonly): `prompt`, `workdir`, optional `model`, `timeoutSeconds` (default 900,
  `DEFAULT_TIMEOUT_SECONDS`), `env` additions, an `onOutput(chunk)` callback for streamed output and
  `mcpServers`.
- `RunResult`: `exitCode`, `output`, `errorOutput`, optional `usage: TokenUsage` (absent when
  unknown), `durationMs`, `model`; `succeeded()` and `failureText()`.
- Ran and failed: return a `RunResult` with a non-zero code (timeout is 124, abort is 130). Could not
  run: throw `RunnerError`. Never return a result for a missing binary.

## The runners (packages/runners/src)

- **`ShellRunner`**: deterministic verification commands (`pnpm test`, `node scripts/...`). The only
  runner that takes a command line the workflow author wrote, and the only file that names a shell
  interpreter (`/bin/sh -c`, `cmd.exe /d /s /c`); `scripts/security-audit.mjs` allowlists exactly that
  file. Anything composed from agent output must not reach it.
- **`ClaudeRunner`, `CodexRunner`, `CursorRunner`, `AntigravityRunner`** (on `AbstractCliRunner`):
  agent CLIs started through a `ProcessSpawner` with an argument vector. `node-pty` is an optional
  dependency loaded lazily: with it the child gets a pseudo-terminal, without it (or when it fails to
  load) the runner uses piped stdio, never crashes on import, and the result says which mode ran.
  Do not assume a PTY exists; a unit test never depends on one.
- **`OpenRouterRunner`**: HTTP through the global `fetch` consuming Server-Sent Events;
  `SseParser` is a pure, incremental parser (partial chunks, multi-line `data:`, `[DONE]`, comments,
  `: keep-alive`).

## Process rules

- Argument arrays, never concatenated strings, `shell: false` (`application_security`).
- Windows cannot start a `.cmd` or `.bat` shim without a shell, and this repository never starts one
  with a shell: point a runner at a native executable (the real `claude.exe`, or `node` with the
  CLI's script), not at the `npm` shim.
- A timeout or an abort kills the **whole process tree** (`taskkill /T /F` on win32, a process-group
  signal elsewhere), not just the parent. Nothing outlives its `run()`; cleanup is in `finally`.
- Environment is explicit: pass what the agent needs and the secret it is meant to hold, nothing
  inherited by accident from the parent.
- Output is streamed to `onOutput` as it arrives. The `AbortSignal` and the timeout are both honoured.

## HTTP and SSE rules

Timeouts on connect and total, a bounded body, the base URL from configuration. Parse the stream
incrementally; a reasoning model can stream for minutes. Take usage from the provider's final usage
frame; if absent, leave `usage` undefined, not zero. The API key goes in the `Authorization` header
of that one request and in no span, event, error or result.

## Registry

`RunnerRegistry` maps the names in the workflow file (`claude-code`, `openrouter`, `shell`, ...) to
runner instances and rejects unknown names at parse time. The built-ins register through the same
`PluginHost` a third-party plugin gets; the engine never imports `@indaba/runners`, and only the
`indaba` CLI composes concrete runners.

## Testing

A fake `ProcessSpawner` drives process tests (timeout, abort, non-zero exit, missing binary, huge
output); the HTTP runner is tested with a stub `fetch` and an SSE body split at awkward byte
boundaries. No real agent and no network in the suite; tests must pass on Windows, macOS and Linux.

To add one: `create_runner`.
