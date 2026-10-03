# Specification: Runner adapters

> **Status**: Implemented in the initial commit; specified retroactively from `docs/vision.md`
> section 3C. Treat as a description to be corrected by review.
> **Stage entry**: 1 (retroactive)
> **Semver impact**: minor (first public surface; below 1.0)

---

## 1. The problem

Agents come in different shapes: terminal CLIs that want a pseudo-terminal, HTTP APIs that stream
Server-Sent Events, and plain commands that verify work. The engine must not care which, and a
workflow author must be able to swap one for another by changing a name in the file.

## 2. User stories

- **US-01.** As a workflow author, I name a runner per role (`claude-code`, `openrouter`, `shell`) and
  the engine treats them identically.
- **US-02.** As a workflow author, a runaway agent is stopped by a timeout and its process is gone.
- **US-03.** As a developer embedding Indaba, I implement `RunnerInterface` and register my runner
  without touching Indaba.

## 3. Acceptance criteria

- [ ] One `RunnerInterface` with `name()` and `run(RunRequest): RunResult`.
- [ ] A runner that ran and failed returns a `RunResult` with a non-zero code; one that could not
      run throws `RunnerException`.
- [ ] `ShellRunner` runs the declared verification commands, and is the only place a command string
      reaches a shell.
- [ ] `ClaudeRunner` and `CursorRunner` run their CLIs through `Symfony\Component\Process\Process`,
      using a PTY where supported, and report clearly where it is not.
- [ ] `OpenRouterRunner` consumes an SSE stream through `SseParser`, which handles partial chunks.
- [ ] `RunnerRegistry` resolves names from the workflow file and rejects unknown names.
- [ ] Token usage is reported when the provider reports it and is null otherwise, never invented.
- [ ] No process outlives its `run()`; the timeout and cancellation are honoured.
- [ ] The API key is never logged, traced or put in an exception message.

## 4. Non-goals

- Pooling or reusing agent processes between steps.
- A plugin loader discovering runners from the filesystem.
- Retrying inside a runner; retry belongs to the engine's `on_failure`.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| non-zero exit | `RunResult` with that code and a bounded output tail |
| timeout | the process (group) is killed; the result or exception says so |
| binary or network unavailable | `RunnerException` naming the fix, containing no secret |
| PTY unsupported on this platform | `RunnerException` that says so |

## 6. Security and data handling

Arguments are arrays; prompts never go into a shell string. Environment is explicit. HTTP goes
through `symfony/http-client` with timeouts. See `.agents/skills/application_security/SKILL.md` and
`.agents/skills/runner_adapter/SKILL.md`.

## 7. Where it lives

`src/Runners/`, infrastructure. The engine and the mesh depend on the interface; only
`RunnerRegistry` and the console's composition root name concrete runners
(`tests/Unit/Architecture/BoundaryTest.php`).

## 8. Clarifications

Which CLI flags `ClaudeRunner` and `CursorRunner` pass is an implementation detail of those classes
and a moving target as the CLIs change; it is not part of the contract.

## Artifacts not written

- `plan.md`: retroactive spec.
- `research.md`: no options were recorded at the time.
- `data-model.md`: `RunRequest` and `RunResult` are listed in api-surface.md; there is no state.
- `events.md`: runners emit no event; the engine and tracer record their runs.
- `tasks.md`: the work is done.
