# Indaba

**A council for your AI agents.** Indaba is an open-source, deterministic orchestration, debate and
observability engine for AI agents, written in PHP 8.4. The name is Zulu for a gathering convened to
resolve a hard matter by reaching consensus.

- **Deterministic SDLC pipelines.** A declarative workflow file is a DAG of steps with quality gates,
  filesystem guards and artifact handoffs. The engine, not a model, decides what runs next.
- **Multi-agent cross-examination.** Roles are backed by different engines (Claude Code over a PTY,
  Cursor, Codex, Antigravity, reasoning models over OpenRouter SSE) and review each other through a
  blackboard with a consensus arbiter, quorum rules and ping-pong detection.
- **Isolation.** Implementation steps run in an ephemeral `git worktree`; the result leaves as a
  patch artifact and the worktree is always torn down.
- **Observability.** Every task is a trace; steps and LLM/tool calls are spans carrying
  OpenTelemetry GenAI attributes, token counts and USD cost, streamed as PSR-14 events and written to
  `.indaba/traces/<traceId>.jsonl`.

MIT licensed. See [`docs/vision.md`](docs/vision.md) for the founding requirement.

## What does "Indaba" mean?

**Indaba** (isiZulu, also used in isiXhosa and other Nguni languages) means a *council*, a
*conference* or *a matter for discussion*. It is the traditional gathering where elders and community
members meet to talk a difficult question through, hear every voice and reach a shared decision. The
word is also used today for conferences, such as the Deep Learning Indaba, an African machine
learning gathering.

That is exactly the job this tool does for AI agents: several independent agents (an architect, an
implementer, a reviewer, each possibly a different model or vendor) put their positions on the table,
cross-examine each other, and the work moves forward only when the council reaches consensus.

## What is it for?

AI coding agents are powerful but unreliable alone: they declare victory without running the tests,
edit files they were told not to touch, and agree with themselves. Indaba is the layer around them
that makes the outcome trustworthy and inspectable:

- **Run an AI software-development pipeline you can reason about.** Spec, then implementation, then
  verification, then review, as a declared graph of steps (a DAG) instead of one long chat.
- **Stop agents marking their own homework.** Verification is plain shell commands (`composer test`,
  `phpstan`) whose exit codes decide pass or fail; review is a structured debate between different
  models that needs quorum.
- **Enforce boundaries.** An RFC step cannot touch `src/`; implementation happens in a disposable
  git worktree and leaves as a patch.
- **Retry without drowning the model.** A failed step is retried with only the latest failure, not
  the whole history.
- **See what it cost.** Every step and LLM call is a trace span with token counts, latency and USD
  cost, following OpenTelemetry GenAI conventions.

Typical uses: automated feature implementation with independent AI code review, multi-model
verification of architecture decisions, auditable agent workflows in CI, and benchmarking different
models against the same pipeline.

Keywords: multi-agent orchestration, AI agent consensus, LLM observability, OpenTelemetry GenAI,
Claude Code, OpenRouter, agentic SDLC, git worktree isolation, PHP.

## Versioning

Indaba follows [Semantic Versioning 2.0.0](https://semver.org/). Releases are git tags `vMAJOR.MINOR.PATCH`
(see [`CHANGELOG.md`](CHANGELOG.md)). While the major version is `0`, the API is not yet stable and a
breaking change bumps the minor version. The public surface is the workflow file schema, the
`bin/indaba` command line, the PHP classes in `src/`, emitted events and span attribute names.

## Quick start (Docker)

PHP 8.4 is provided by the container; nothing PHP-related is needed on the host.

```bash
docker compose build
docker compose run --rm php composer install
docker compose run --rm php composer qa          # php-cs-fixer, PHPStan level 9, PHPUnit

docker compose run --rm php bin/indaba validate examples/task-pipeline.workflow.ai.yml
docker compose run --rm php bin/indaba plan     examples/task-pipeline.workflow.ai.yml
docker compose run --rm php bin/indaba run      examples/task-pipeline.workflow.ai.yml -w /path/to/project -v
```

`run` exits `0` on success, `1` on failure and `2` when a step was **escalated** (retries exhausted or
no consensus: a human is needed).

## The workflow file

[`examples/task-pipeline.workflow.ai.yml`](examples/task-pipeline.workflow.ai.yml) is the reference.
By default the CLI reads `.indaba/workflow.ai.yml` in the target project; the repository's own root
`workflow.ai.yml` is a different thing: the rules for developing Indaba itself.

| Key | Meaning |
| :--- | :--- |
| `artifacts` | Named paths, referenced as `${{ artifacts.name }}`. An artifact named `patch` receives the worktree diff after each isolated step. |
| `roles` | `runner` (`claude-code`, `cursor`, `codex`, `antigravity`, `openrouter`, `shell`) and an optional `model`. |
| `steps[].depends_on` | Edges of the DAG. Ordering is topological and stable. |
| `steps[].outputs` | Files that must exist when the step ends, or it fails. |
| `steps[].guards` | `git_diff_empty` with `paths`: the step may not change them (e.g. no `src/` edits during an RFC). Fails closed outside a git repository. |
| `steps[].isolation` | `git_worktree`: run in `.indaba/worktrees/<taskId>`; dependents continue in the same worktree. |
| `steps[].runner: shell` + `commands` | Quality gates. Any non-zero exit fails the step. |
| `steps[].on_failure` | `retry_step` (with `target` and `max_retries`), `escalate` or `fail`. |
| `steps[].consensus_with` + `decision_type` | A debate between `role` and the listed roles; `consensus` (unanimous) or `majority`. |

Step lifecycle: `PENDING -> RUNNING -> VALIDATING -> COMPLETED`, with `FAILED` and `ESCALATED` exits.

**Retry-loop isolation.** When `verify` fails and retries `code`, only the latest failure (tail-trimmed
to 4000 characters) is injected into the new prompt, never the accumulated history.

**Consensus protocol.** Agents begin replies with `AGREEMENT`, `CRITIQUE`, `PROPOSAL`, `QUESTION` or
`TOOL_INTENT`. Anything untagged counts as a proposal and can never approve. A debate that repeats
itself is stopped as stalled; one that does not converge within the round budget escalates.

## Layout

| Path | Holds |
| :--- | :--- |
| `src/Core` | exceptions shared by every layer |
| `src/Workflow` | model, parser, DAG, state machine, guards, engine |
| `src/Mesh` | blackboard, messages, consensus arbiter, ping-pong detection |
| `src/Runners` | `RunnerInterface` and the shell, CLI-PTY and OpenRouter-SSE adapters |
| `src/Workspace` | git worktrees and patches |
| `src/Observability` | tracer, spans, pricing, JSONL exporter |
| `src/Console` | the `bin/indaba` commands and composition root |

The pure layers (`Core`, `Mesh`, `Workflow/Model|Graph|State`) import no framework code; a test
enforces it.

## Runner notes

- CLI runners allocate a PTY where the platform supports it (Linux/macOS, so inside the container) and
  receive the prompt as a single argument, never through a shell.
- `ClaudeRunner` runs `claude -p` with `--permission-mode acceptEdits`; `CodexRunner` runs
  `codex exec --sandbox workspace-write` (Codex is read-only by default); `AntigravityRunner` runs
  `agy [--model m] -p` (file edits are auto-approved by the CLI, shell commands need a grant in its
  `settings.json`; Indaba never adds `--dangerously-skip-permissions`). Each CLI must be logged in
  beforehand. Replace a command line with `INDABA_CODEX_CMD` / `INDABA_ANTIGRAVITY_CMD`
  (space-separated, `{prompt}` and `{model}` mark where those go).
- **More engines later:** implement `RunnerInterface` and call `RunnerRegistry::register()`; a workflow
  selects it by `name()`. `CommandRunner` wraps any prompt-as-argument CLI without a new class.
- `OpenRouterRunner` reads `OPENROUTER_API_KEY`. Built-in prices are indicative; pass your own
  `PricingTable` for billing-grade cost.
- Claude Code, Cursor and the other agent CLIs must be installed and authenticated inside whatever
  environment runs `bin/indaba`; the stock Docker image contains none of them.

## MCP (Model Context Protocol) through agents

Declare MCP servers once; roles and steps say which they need. The **agent** does the tool calling:
Indaba only makes sure the agent can see the servers, and refuses to start a step that would run
without tools it was written for.

```yaml
defaults:
  mcp_policy: required        # required (default) | optional

mcp_servers:
  docs:   { command: npx, args: ["-y", "my-docs-mcp"], env: { DOCS_REGION: "eu" } }
  tracker: { url: "https://mcp.example.com/sse" }

roles:
  implementer: { runner: claude-code, mcp: [docs] }     # every step of this role gets `docs`
  reviewer:    { runner: antigravity }

steps:
  - id: code
    role: implementer
    mcp: [tracker]                                       # plus `tracker` for this step only
    goal: "Implement the ticket"
  - id: review
    role: reviewer
    mcp: [docs]
    mcp_policy: optional                                 # this step may run without it
```

| Runner | MCP support | What Indaba does |
| :--- | :--- | :--- |
| `claude-code` | **injected** | writes a private temporary file, passes `--mcp-config <file> --strict-mcp-config` (the agent sees exactly the declared servers), deletes it afterwards |
| `codex` | **injected** | passes `-c mcp_servers.<name>.command=...` style overrides |
| `antigravity`, `cursor` | **agent-managed** | the agent reads its own MCP settings; Indaba cannot inject or verify them, so it assumes they are configured and says so (`plan` warning, `indaba.mcp.assumed` span attribute) |
| `openrouter`, `shell`, custom `CommandRunner` | **none** | no MCP at all |

**When an engine has no MCP support**, the policy decides, and it is checked *before the first step
runs* (`bin/indaba plan` shows it too):

- `required` (default): the run is refused with `step "x" (runner y), server "z": the runner has no MCP
  support (policy: required)`. Nothing starts and nothing is spent.
- `optional`: the step runs without that server and `indaba.mcp.skipped` records its name.

The policy is set per workflow (`defaults.mcp_policy`) and can be overridden per step
(`mcp_policy`). Server definitions can hold secrets (`env`, URLs), so only server *names* ever reach
spans, events, errors or logs. A runner declares its support by implementing `McpCapable`; one that
does not is treated as `none`. Not in this version: an Indaba-hosted MCP client for API-only models,
and starting or health-checking servers (the agent does that).

## How a PHP tool escapes the one-request model

PHP was built for short, stateless web requests: one process per request, a time limit, nothing
remembered afterwards. An agent run is the opposite: minutes or hours, several child processes,
streaming output, shared state. Indaba is built around that mismatch:

- **It is a CLI process, not a web request.** `bin/indaba` runs under `php-cli`, where there is no
  `max_execution_time`, and one process owns the whole run. Do not run workflows inside php-fpm or
  Apache; run them from a shell, a container, a CI job or a queue worker.
- **Long work happens in child processes, not in PHP.** Each agent or command is a separate OS process
  started with `symfony/process` (argument vectors, an optional PTY, a per-step timeout that kills it).
  PHP only orchestrates, so a slow or hung agent cannot exhaust PHP's memory or time.
- **Streaming instead of buffering.** Process output arrives through callbacks and OpenRouter replies are
  read chunk by chunk from the SSE stream with `symfony/http-client`'s non-blocking `stream()`. Nothing
  waits for a whole response.
- **State lives in the process and on disk.** Step states are an in-memory state machine for the run;
  every span is appended to `.indaba/traces/<traceId>.jsonl` as it ends; work products are files
  (artifacts, a patch) and an isolated git worktree. There are no PHP sessions, globals or request
  scope involved.
- **Live observability without a server.** Spans and step transitions are PSR-14 events. A frontend can be
  fed by adding a listener that pushes them to SSE, Mercure or WebSockets from a *separate* process (for
  example, tail the JSONL traces); the engine itself never blocks on a client.
- **Clean shutdown.** The worktree is removed in a `finally`, and a timed-out child process is killed.

**Honest limits.** One run is one process and one thread: steps run sequentially, there is no resume
after the process itself is killed (the trace and artifacts survive, the in-memory state does not), and
`pcntl` signals are not yet used for graceful cancellation. A supervisor (systemd, Docker restart
policy, a queue worker) is the right place for restarts. Parallel steps and resumable runs are future
work, not hidden features.

## Developing Indaba

This repository follows the same spec-driven process as `apsw-gridwright`: read
[`AGENTS.md`](AGENTS.md) and [`workflow.ai.yml`](workflow.ai.yml) first, pick a track, write a spec under
[`specs/`](specs), and pass the gates before committing.

## License

MIT
