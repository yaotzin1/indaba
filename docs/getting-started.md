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
| `OPENROUTER_API_KEY` | `openrouter` runner | Your OpenRouter key. Without it the runner cannot run (`OPENROUTER_API_KEY is not set.`), and a workflow that lists another runner after it moves on to that one |
| `INDABA_OPENAI_COMPAT_<NAME>_BASE_URL` | an OpenAI-compatible runner | Adds a runner named `<name>` in lower case with `_` as `-` (`LM_STUDIO` is `lm-studio`). The URL is `http` or `https`, up to the version segment, for example `http://localhost:11434/v1` |
| `INDABA_OPENAI_COMPAT_<NAME>_KEY_ENV` | the same | The **name** of the variable that holds that endpoint's key. Without it the endpoint is treated as keyless (a local server) |
| `INDABA_OPENAI_COMPAT_<NAME>_MODEL` | the same | The model used when a role names none |
| `INDABA_ACP_PASS_ENV` | `acp` runner | Extra variables to pass on to an ACP agent: comma-separated names, or a prefix ending in `*`. See [ACP agents](#acp-agents) |
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
| `openrouter` | A streamed chat completion over HTTPS. The API choice for text work | `OPENROUTER_API_KEY`, and a `model` on the role |
| `acp` | An agent over the Agent Client Protocol. The choice for agents that edit code | the agent program (see [ACP agents](#acp-agents)) |
| `claude-code` | `claude -p <prompt> --permission-mode acceptEdits` (plus `--model`, MCP config). A last resort | the `claude` CLI, logged in |
| `codex` | `codex exec --sandbox workspace-write <prompt>` | the `codex` CLI, logged in (`codex login`) |
| `antigravity` | `agy -p <prompt>` | the `agy` CLI |
| `cursor` | `cursor-agent -p <prompt>` | the `cursor-agent` CLI |

Each agent CLI authenticates itself; Indaba does not log you in.

### Which runner when

Prefer the API for text work, ACP for agents that edit code, and a CLI only as a last resort; put the
first choice first in a `runner` list and the rest after it. The reasoning, the fallback rules and a
step-by-step walkthrough are in [using-the-alpha.md](using-the-alpha.md) and
[workflow-format.md](workflow-format.md#transports-and-fallback).

### API runners

`openrouter` needs `OPENROUTER_API_KEY` and a `model` on the role. Any other OpenAI-compatible service
(OpenAI, vLLM, Ollama, LM Studio) is added by environment variables, never by the workflow file:

```
INDABA_OPENAI_COMPAT_LOCAL_BASE_URL=http://localhost:11434/v1
INDABA_OPENAI_COMPAT_LOCAL_MODEL=llama3
```

makes a runner called `local`. Add `INDABA_OPENAI_COMPAT_LOCAL_KEY_ENV=MY_KEY_VARIABLE` when the server
needs a key, and set `MY_KEY_VARIABLE` to it. A built-in runner's name cannot be reused.

### ACP agents

`acp` talks the Agent Client Protocol (version 1) to an agent program over its standard input and output,
so there is no terminal to scrape. The role or step names the agent:

| `agent:` | Starts |
| :--- | :--- |
| `claude` | `npx --yes @agentclientprotocol/claude-agent-acp` |
| `codex` | `npx --yes @agentclientprotocol/codex-acp` |
| `gemini` | `gemini --acp` |
| `{ command: [program, arg, ...] }` | exactly that, for any other agent or a pinned, locally installed copy |

Things to know:

- The `npx` presets download code when they run, and on Windows `npx` is a `.cmd` shim that Indaba does
  not start (see below): use `{ command: [...] }` with a native executable there, or install the agent
  and name it. A start failure is a runner that could not run, so a fallback list moves on.
- Only an allowlist of your environment reaches the agent: `PATH`, home and temp folders, proxy and
  certificate settings, the variables with the agent's own prefix (`ANTHROPIC_`, `OPENAI_`, `GEMINI_`
  and so on), plus whatever `INDABA_ACP_PASS_ENV` names. Your other keys do not.
- An agent may need you to log in; see the next section.
- Indaba does not offer the agent a terminal. File access is offered only to a step with `permissions`.

### Logging in to an ACP agent

An ACP agent lists the ways it can log in (Gemini, for example: "Log in with Google", an API key, Vertex
AI). Some agents accept a session without being logged in and fail only when they first call the model,
for example Gemini with `403 ... unregistered callers`. So Indaba logs in up front, the way an editor does:

- **Name the method in the workflow** to log in without being asked, for any run, including unattended
  ones: `agent: { command: [...], auth: "gemini-api-key" }`. The ids are the agent's own; if you name one
  it does not offer, the step fails with the list it does offer. An API-key method reads the key from the
  agent's own environment variable, which has to be passed on (`GEMINI_API_KEY` is, through the
  `GEMINI_` prefix; others by `INDABA_ACP_PASS_ENV`).
- **Or be asked.** When you run `indaba run` in a terminal, the workflow names no method and the agent
  offers some, Indaba lists them and you pick one by number. `0` or Enter goes on without logging in
  (for an agent that is already logged in). The question names the `auth:` line that skips it next time.
  With no terminal (CI, a pipe) Indaba never asks and does not log in.

A browser-based method opens the agent's own login; Indaba waits for it. The agent decides what it still
supports: the Gemini CLI, for one, now refuses its personal "Log in with Google" method ("migrate to the
Antigravity suite of products"), so with Gemini use an API key (`gemini-api-key`, from `GEMINI_API_KEY`) or
Vertex AI. Indaba reports such a refusal as a runner that could not run, with the agent's own message. The
agent keeps the credentials itself, so the next run's login is quick. A login that fails is a runner that
could not run: a fallback list moves on to the next runner.

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
| `.indaba/traces/<traceId>.events.jsonl` | The run as it happens: span starts and ends, step status changes and the output steps stream (credentials redacted, 2 MiB at most). `indaba watch` reads it |
| `.indaba/traces/<traceId>.jsonl` | One JSON object per ended span: the task, each step, each agent call or command, with `gen_ai.*` attributes, token counts and cost where known. Safe to read and diff; it never contains secrets |
| `.indaba/worktrees/<taskId>` | The git worktree of an isolated step. It exists only while the run is going and is removed when it ends, however it ends |
| the paths your workflow names under `artifacts` | Whatever the steps wrote there, and the diff of an isolated worktree if you named a `patch` artifact |

`.indaba/` is runtime state; add it to your `.gitignore`.

A cost is shown only when the model's price is known and the usage was reported; an unknown cost is
absent, not zero.

## Watching a run

```bash
npx indaba watch                  # list the runs, newest first
npx indaba watch latest           # follow the newest, or read it if it has finished
npx indaba watch latest --replay  # replay a finished run with its original timing (--speed 10 for ten times faster)
npx indaba watch latest --plain   # lines instead of the dashboard (also the default without a terminal)
```

Open a second terminal, or run it after the fact: `watch` only reads the files above, so it never touches the run.
On a terminal, with the optional dashboard package installed (`npm install @indaba/tui`), a run opens as a
dashboard: steps on the left, the selected step's output on the right (stacked below 80 columns). `?` lists the
keys: arrows or `j`/`k` select, `PgUp`/`PgDn` scroll, `f` follows the newest output, `q` quits. States are
shown as a symbol and a word, never by colour alone; `--ascii` avoids box and arrow characters, and `NO_COLOR`
turns colour off. Without the package, or with `--plain`, it prints lines. The exit status mirrors the run:
0 completed, 1 failed, 2 escalated, 130 cancelled, 3 when the files end without a final state.

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
