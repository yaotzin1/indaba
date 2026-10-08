# Indaba

**A council for your AI agents.** Indaba is an open-source, deterministic orchestration, debate and
observability engine for AI agents, written in TypeScript for Node 22 and newer. It runs the same on
Windows, macOS and Linux. The name is Zulu for a gathering convened to resolve a hard matter by
reaching consensus.

```bash
npx indaba validate workflow.ai.yml
npx indaba plan workflow.ai.yml
npx indaba run workflow.ai.yml
```

> **Status.** `0.1.0-alpha.0` is published, mainly to reserve the package names: `npx indaba@next` runs it.
> It is a preview and the API is not stable below 1.0. To work on Indaba, run from a checkout (see
> [Development](#development)).

- **Deterministic pipelines.** A declarative workflow file is a DAG of steps with quality gates,
  filesystem guards and artifact handoffs. The engine, not a model, decides what runs next.
- **Multi-agent cross-examination.** Roles are backed by different engines (Claude Code, Codex,
  Cursor, Antigravity, reasoning models over OpenRouter) and review each other through a blackboard
  with a consensus arbiter, quorum rules and ping-pong detection.
- **Isolation.** Implementation steps run in an ephemeral `git worktree`; the result leaves as a
  patch artifact and the worktree is always removed.
- **Observability.** Every task is a trace; steps and LLM or tool calls are spans carrying
  OpenTelemetry GenAI attributes, token counts and USD cost where known, written to
  `.indaba/traces/<traceId>.jsonl`.
- **Not only for code.** A step is an agent, an API call or a command, so a workflow can drive any
  tool reachable by `shell` or an MCP server: for example a media pipeline. Indaba ships no integration
  with any particular application.

MIT licensed. [`docs/vision.md`](docs/vision.md) is the founding requirement.

## What does "Indaba" mean?

**Indaba** (isiZulu, also used in isiXhosa and other Nguni languages) means a *council*, a
*conference* or *a matter for discussion*: the traditional gathering where elders and community
members talk a difficult question through, hear every voice and reach a shared decision. That is the
job this tool does for AI agents: an architect, an implementer and a reviewer, each possibly a
different model or vendor, put their positions on the table, cross-examine each other, and the work
moves forward only when the council reaches consensus.

## What is it for?

AI coding agents are powerful but unreliable alone: they declare victory without running the tests,
edit files they were told not to touch, and agree with themselves. Indaba is the layer around them
that makes the outcome trustworthy and inspectable:

- Run a pipeline you can reason about: spec, implementation, verification, review, as a declared
  graph of steps instead of one long chat.
- Stop agents marking their own homework. Verification is plain commands (`pnpm test`) whose exit
  codes decide pass or fail; review is a structured debate that needs quorum.
- Enforce boundaries. An RFC step cannot touch `packages/`; implementation happens in a disposable
  worktree and leaves as a patch.
- Retry without drowning the model. A failed step is retried with only the latest failure.
- See what it cost. Every step and LLM call is a span with token counts, latency and USD cost.

## Packages

| Package | Holds | Dependencies |
| :--- | :--- | :--- |
| `indaba` | The command line (`validate`, `plan`, `run`, `watch`), plugin loading, the composition root | the three below; optional `@indaba/tui` |
| `@indaba/core` | The pure domain: workflow model, DAG, step state, mesh, `Runner`, `Guard`, `Plugin` and `PluginHost` contracts, tracer. Imports no `node:` module | none |
| `@indaba/engine` | Workflow parser and validator, guards, `WorkflowEngine`, git worktrees, JSONL span exporter | `@indaba/core`, `yaml` |
| `@indaba/runners` | `ShellRunner`, `OpenAiCompatibleRunner` and `OpenRouterRunner`, `AcpRunner`, the agent CLI runners, `RunnerRegistry` | `@indaba/core`; optional `node-pty` |
| `@indaba/tui` | Optional terminal dashboard for a run (`indaba watch`, `indaba run --tui`), built on Ink | `@indaba/engine`, `ink`, `react` |

All packages are ESM, ship their types, and need Node 22 or newer.

## Quick start

Prerequisites: Node 22 and git, plus whichever agent CLIs your workflow uses, installed and logged in.

```bash
npx indaba validate examples/task-pipeline.workflow.ai.yml
npx indaba plan     examples/task-pipeline.workflow.ai.yml
npx indaba run      examples/task-pipeline.workflow.ai.yml -w /path/to/project -v
```

More in `examples/`: `transport-fallback.workflow.ai.yml` (API, ACP and CLI in one workflow) and
`api-only.workflow.ai.yml` (the smallest one). A guided first run of this alpha is in
[docs/using-the-alpha.md](docs/using-the-alpha.md).

`run` exits `0` on success, `1` on failure, `2` when a step was escalated (retries exhausted or no
consensus: a human is needed) and `130` when cancelled.

[`docs/getting-started.md`](docs/getting-started.md) covers prerequisites, environment variables, each
runner and what a run leaves on disk. [`docs/workflow-format.md`](docs/workflow-format.md) describes
every field of a workflow file. The repository's own root `workflow.ai.yml` is a different thing: the
rules for developing Indaba itself.

## Runners

An agent is reached over an **API**, over **ACP** (the Agent Client Protocol), or, as a last resort,
through its **CLI**. A role lists runners in priority order and the first one that can run is used:

```yaml
roles:
  implementer:
    runner: ["acp", "claude-code"]   # ACP first, the CLI only if ACP cannot start
    agent: "claude"
```

| Runner | Runs | Needs | Choose it for |
| :--- | :--- | :--- | :--- |
| `openrouter`, and any OpenAI-compatible endpoint you configure | a streamed chat completion | `OPENROUTER_API_KEY`, or your endpoint's variables | text work: specs, reviews, debate |
| `acp` | any ACP agent (`claude`, `codex`, `gemini`, `opencode`, or your own command) over stdio, with a permission gate | the agent program | agents that edit code |
| `shell` | commands from the workflow file | nothing | verification |
| `claude-code` | `claude -p` | the `claude` CLI | last resort |
| `codex` | `codex exec --sandbox workspace-write` | the `codex` CLI | last resort |
| `antigravity` | `agy -p` | the `agy` CLI | last resort |
| `cursor` | `cursor-agent -p` | the `cursor-agent` CLI | last resort |
| `opencode` | `opencode run` | the `opencode` CLI | last resort; prefer `acp` with `agent: "opencode"` |

A runner is skipped for the next one only when it could not run at all (no key, program not found,
endpoint unreachable). A runner that started and failed is a failed task, never retried elsewhere. See
[docs/using-the-alpha.md](docs/using-the-alpha.md) to try it, and
[docs/workflow-format.md](docs/workflow-format.md#transports-and-fallback) for the rules.

The agent CLIs run in a pseudo-terminal when the optional `node-pty` package is available, and over
plain pipes otherwise. The prompt is always a single argument, never composed into a shell string. On
Windows a CLI that is only a `.cmd` shim cannot be started; use a native executable.

## Extension

A runner, a guard type or an event listener is added without editing Indaba: write a plugin that
default-exports `{ name, register(host) }` and load it with `--plugin`. The contracts live in
`@indaba/core`, and the built-ins register through the same host a plugin gets.

```bash
npx indaba run workflow.ai.yml --plugin ./plugins/demo.js
```

See [`docs/extending.md`](docs/extending.md) for a complete example.

## Versioning

Indaba follows [Semantic Versioning 2.0.0](https://semver.org/). The first
published version is `0.1.0-alpha.0`; prereleases go to the `next` dist-tag. While the major version is `0`, a breaking change bumps the minor version. The
public surface is the workflow file schema, the command line, the exported API of the five packages,
emitted events and span attribute names. See [`CHANGELOG.md`](CHANGELOG.md).

## Development

Node 22 and pnpm 9 on any OS; nothing else.

```bash
pnpm install
pnpm qa                                  # biome, tsc strict, vitest
pnpm build
node scripts/install-hooks.mjs           # once per clone
```

Read [`AGENTS.md`](AGENTS.md) and [`workflow.ai.yml`](workflow.ai.yml) first, pick a track, write a
spec under [`specs/`](specs), and pass the gates before committing. [`CONTRIBUTING.md`](CONTRIBUTING.md)
has the details. Run the CLI from a checkout with `node packages/cli/dist/bin.js <command>` after
`pnpm build`.

## License

MIT
