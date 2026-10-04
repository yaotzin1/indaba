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

> **Status.** The first release, `0.1.0`, has not been published yet. `npx indaba` will work once it
> is; until then, run from a checkout (see [Development](#development)). The API is not stable below 1.0.

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
| `indaba` | The command line (`validate`, `plan`, `run`), plugin loading, the composition root | the three below |
| `@indaba/core` | The pure domain: workflow model, DAG, step state, mesh, `Runner`, `Guard`, `Plugin` and `PluginHost` contracts, tracer. Imports no `node:` module | none |
| `@indaba/engine` | Workflow parser and validator, guards, `WorkflowEngine`, git worktrees, JSONL span exporter | `@indaba/core`, `yaml` |
| `@indaba/runners` | `ShellRunner`, `OpenRouterRunner`, the agent CLI runners, `RunnerRegistry` | `@indaba/core`; optional `node-pty` |

All packages are ESM, ship their types, and need Node 22 or newer.

## Quick start

Prerequisites: Node 22 and git, plus whichever agent CLIs your workflow uses, installed and logged in.

```bash
npx indaba validate examples/task-pipeline.workflow.ai.yml
npx indaba plan     examples/task-pipeline.workflow.ai.yml
npx indaba run      examples/task-pipeline.workflow.ai.yml -w /path/to/project -v
```

`run` exits `0` on success, `1` on failure, `2` when a step was escalated (retries exhausted or no
consensus: a human is needed) and `130` when cancelled.

[`docs/getting-started.md`](docs/getting-started.md) covers prerequisites, environment variables, each
runner and what a run leaves on disk. [`docs/workflow-format.md`](docs/workflow-format.md) describes
every field of a workflow file. The repository's own root `workflow.ai.yml` is a different thing: the
rules for developing Indaba itself.

## Runners

| Runner | Runs | Needs |
| :--- | :--- | :--- |
| `shell` | commands from the workflow file | nothing |
| `claude-code` | `claude -p` | the `claude` CLI |
| `codex` | `codex exec --sandbox workspace-write` | the `codex` CLI |
| `antigravity` | `agy -p` | the `agy` CLI |
| `cursor` | `cursor-agent -p` | the `cursor-agent` CLI |
| `openrouter` | a streamed chat completion | `OPENROUTER_API_KEY` |

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

Indaba follows [Semantic Versioning 2.0.0](https://semver.org/). The first release will be `0.1.0` and
has not been published. While the major version is `0`, a breaking change bumps the minor version. The
public surface is the workflow file schema, the command line, the exported API of the four packages,
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
