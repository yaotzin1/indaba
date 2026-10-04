# Getting started

Indaba runs a workflow file: a graph of steps executed by agent CLIs, an LLM API or plain commands,
with quality gates, retries and a trace of what happened. This page gets you from nothing to a run.

The `indaba` package is published as a preview, `0.1.0-alpha.0`. `npx indaba@next` downloads it; the
commands below write `npx indaba`, which resolves to the same version for now. To work on Indaba itself,
use a checkout of the repository (see "Running from a checkout" below).

## Prerequisites

- Node 22 or newer
- git (steps with `isolation: git_worktree` and the `git_diff_empty` guard use it, and the project
  directory must be a git repository for those)
- the agent CLIs your workflow uses, installed and logged in (see "Runners")

Nothing else: no container runtime, no WSL and no other language runtime. Indaba runs natively on
Windows, macOS and Linux.

## The three commands

```bash
npx indaba validate workflow.ai.yml   # check the file; lists every problem at once
npx indaba plan workflow.ai.yml       # show the order steps will run in, and MCP findings
npx indaba run workflow.ai.yml        # execute it
```

The file argument is optional and defaults to `.indaba/workflow.ai.yml`. On Windows use PowerShell or
Command Prompt the same way; paths may use either slash. On macOS and Linux any shell works.

```powershell
npx indaba validate .\workflow.ai.yml
$env:OPENROUTER_API_KEY = "sk-or-..."
npx indaba run .\workflow.ai.yml
```

```bash
export OPENROUTER_API_KEY="sk-or-..."
npx indaba run ./workflow.ai.yml
```

`validate` prints `<name> is valid (N steps, M roles).` or `<file> is invalid:` followed by one line per
problem, and exits 1 on an invalid file. `plan` prints a numbered list such as
`2. code [implementer] (after rfc)`; shell steps show their commands. Neither starts an agent.

The workflow file format is described in [workflow-format.md](workflow-format.md). Two examples to start
from are in [`examples/`](../examples/).

### `run` options

| Option | Meaning |
| :--- | :--- |
| `-w, --workdir <dir>` | The project directory the workflow runs against (default: the current directory) |
| `--task-id <id>` | Names the task, its worktree and its trace; a random id otherwise |
| `--timeout <secs>` | Per-step timeout in seconds (default 900); applies to every runner |
| `--plugin <spec>` | Load a plugin (repeatable); also accepted by `validate` and `plan`. See [extending.md](extending.md) |
| `-v` | Print the cost of each span that has one; `-vv` also streams the agent's output live |
| `-h, --help`, `-V, --version` | Help and version |

Exit codes: 0 completed, 1 failed (also: any error), 2 escalated or a usage error, 130 cancelled. Press
Ctrl+C once to cancel a run: the running step is stopped and worktrees are removed. A second Ctrl+C
exits immediately.

## Environment variables

Indaba reads only these from its environment, and passes only these to the runners it builds:

| Variable | Used by | Meaning |
| :--- | :--- | :--- |
| `OPENROUTER_API_KEY` | `openrouter` runner | Your OpenRouter key. A step that uses the runner without it fails with `OPENROUTER_API_KEY is not set.` |
| `INDABA_CODEX_CMD` | `codex` runner | Replaces the built-in Codex command line. Space-separated words; `{prompt}` and `{model}` mark where those go |
| `INDABA_ANTIGRAVITY_CMD` | `antigravity` runner | The same, for Antigravity |

A key is never written to a trace, event, error message or artifact, and anything that looks like a
credential in the environment is replaced with `[redacted]` if it appears in output Indaba prints. Never
put a key in a workflow file.

## Runners

A runner is what a role's `runner:` (or a step's) names.

| Runner | What it runs | Needs on your `PATH` or in the environment |
| :--- | :--- | :--- |
| `shell` | A command line from the workflow file, through the platform shell | nothing |
| `claude-code` | `claude -p <prompt> --permission-mode acceptEdits` (plus `--model`, MCP config) | the `claude` CLI, logged in |
| `codex` | `codex exec --sandbox workspace-write <prompt>` | the `codex` CLI, logged in (`codex login`) |
| `antigravity` | `agy -p <prompt>` | the `agy` CLI |
| `cursor` | `cursor-agent -p <prompt>` | the `cursor-agent` CLI |
| `openrouter` | A streamed chat completion over HTTPS | `OPENROUTER_API_KEY`, and a `model` on the role |

Each agent CLI authenticates itself; Indaba does not log you in.

### Pseudo-terminal, and the piped fallback

Agent CLIs behave better when they see a terminal. If the optional `node-pty` package is installed and
loads on your platform, the CLI runners run the agent in a pseudo-terminal. If it is missing or its
native part does not load, they use plain pipes instead; nothing crashes. In a pseudo-terminal, stdout and stderr arrive merged.

### Windows: use a native executable

Indaba starts processes without a shell, so it cannot start a `.cmd` or `.bat` shim. A CLI installed with
npm on Windows is often such a shim (`claude.cmd`), and starting it fails. If an agent CLI fails to
start on Windows, point at a native `.exe` (for `codex` and `antigravity`, set `INDABA_CODEX_CMD` or
`INDABA_ANTIGRAVITY_CMD` to the full path of the executable followed by its arguments). The `shell`
runner is different: it deliberately goes through `cmd.exe`, so commands such as `pnpm test` work there.

This is a known limitation, and the Windows behaviour of the pseudo-terminal runners has not been
confirmed on real installs yet.

## What a run leaves behind

| Path (under the project directory) | Content |
| :--- | :--- |
| `.indaba/traces/<traceId>.jsonl` | One JSON object per ended span: the task, each step, each agent call or command, with `gen_ai.*` attributes, token counts and cost where known. Safe to read and diff; it never contains secrets |
| `.indaba/worktrees/<taskId>` | The git worktree of an isolated step. It exists only while the run is going and is removed when it ends, however it ends |
| the paths your workflow names under `artifacts` | Whatever the steps wrote there, and the diff of an isolated worktree if you named a `patch` artifact |

`.indaba/` is runtime state; add it to your `.gitignore`.

A cost is shown only when the model's price is known and the usage was reported; an unknown cost is
absent, not zero.

## Running from a checkout

Until a release is published, run the CLI from the repository:

```bash
git clone <the repository> indaba
cd indaba
pnpm install
pnpm build
node packages/cli/dist/bin.js validate examples/task-pipeline.workflow.ai.yml
```

`pnpm install` needs pnpm 9 (`corepack enable` provides it). Run the command from your own project
directory (use an absolute path to `bin.js`) so that traces and worktrees land in that project.

## Next

- [workflow-format.md](workflow-format.md): every field of a workflow file
- [extending.md](extending.md): add a runner, a guard type or a listener with a plugin
