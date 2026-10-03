# API surface contract: Runner adapters

> Written retroactively. Names are the intended public classes; signatures are to be confirmed
> against `src/Runners/` in review.

## Semver classification

**minor**: first public surface (below 1.0).

## Public symbols added

| Name (FQCN) | Kind | Notes |
| :--- | :--- | :--- |
| `Indaba\Runners\RunnerInterface` | interface | `name(): string`, `run(RunRequest): RunResult`; the extension point |
| `Indaba\Runners\RunRequest` | final readonly class | prompt or command, workdir, environment, timeout, model, output sink |
| `Indaba\Runners\RunResult` | final readonly class | exit code, output, usage, duration |
| `Indaba\Runners\ShellRunner` | final class | declared verification commands |
| `Indaba\Runners\ClaudeRunner` | final class | Claude Code CLI via PTY |
| `Indaba\Runners\CursorRunner` | final class | Cursor CLI via PTY |
| `Indaba\Runners\OpenRouterRunner` | final class | HTTP and SSE |
| `Indaba\Runners\RunnerRegistry` | final class | name to runner |
| `Indaba\Runners\SseParser` | final class | incremental SSE parser |
| `Indaba\Core\Exception\RunnerException` | exception | the runner could not run |

`@internal`: `AbstractCliRunner`, `CommandRunner` (shared plumbing, to be marked in review if not
already).

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow file | runner names `claude-code`, `cursor`, `openrouter`, `shell` | added; names are public schema |
| environment | `OPENROUTER_API_KEY` | read for the OpenRouter runner |

## Defaults introduced

To be filled from the code in review: default timeout, the OpenRouter base URL and default model,
output tail size. Each is a major to change.

## Checks

- [ ] Every type in a public signature is public or deliberately `@internal`
- [ ] Concrete runners are `final`; the extension point is the interface
- [ ] No concrete runner is named outside the registry and the console
- [ ] `composer stan` passes without an ignore
