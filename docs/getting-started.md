# Getting started

Indaba runs a workflow file: a graph of steps executed by agent CLIs, an LLM API or plain commands,
with quality gates, retries and a trace of what happened. This page gets you from nothing to a run in a
few minutes, with no API key and no agent installed.

## What is on npm

Indaba is a preview. What npm has today, and what only a checkout of the repository has:

| | npm | A checkout of `main` |
| :--- | :--- | :--- |
| Version | `next`: `0.1.0-alpha.3` (2026-10-26). `latest`: `0.1.0-alpha.0` | everything merged since `0.1.0-alpha.3` (the CHANGELOG's Unreleased section) |
| `indaba validate`, `plan`, `run` | yes | yes |
| `indaba watch`, `report`, `settings`, `schema`, `catalog`, `workflows` | yes | yes |
| `indaba ui` (the web view) | the command, yes; `@indaba/server` `0.1.0-alpha.3` is on npm but cannot be installed yet, so use a checkout | yes |
| `--log-level`, `--log-dir`, `--tui`, `--permissions`, `--allow-full-access` | yes | yes |
| `@indaba/tui` (the terminal dashboard) | `0.1.0-alpha.3` (`npm install @indaba/tui@next`) | yes |

Always write `npx indaba@next`. Plain `npx indaba` resolves to `latest`, the older `0.1.0-alpha.0`. The rest of
this page writes `npx indaba` for short; from a checkout, write `pnpm indaba` (see
[Running from a checkout](#running-from-a-checkout)). The [CHANGELOG](../CHANGELOG.md) lists what `main` has gained.

## Your first run

Make an empty folder, save [`examples/hello.workflow.ai.yml`](../examples/hello.workflow.ai.yml) in it, and run it:

```yaml
version: "1.0"
name: "hello-council"

steps:
  - id: "draft"
    runner: "shell"
    commands:
      - node -e "require('fs').writeFileSync('draft.txt', 'hello from indaba')"

  - id: "check"
    depends_on: ["draft"]
    runner: "shell"
    commands:
      - node -e "const fs=require('fs'); const again=fs.existsSync('.tried'); fs.writeFileSync('.tried', ''); if (!again) { console.error('first try fails on purpose'); process.exit(1) }"
    on_failure:
      action: "retry_step"
      target: "draft"
      max_retries: 2
```

```bash
npx indaba@next validate hello.workflow.ai.yml   # hello-council is valid (2 steps, 0 roles).
npx indaba@next plan hello.workflow.ai.yml       # 1. draft ... 2. check ... (after draft)
npx indaba@next run hello.workflow.ai.yml
```

The run prints each step's state as it changes. `check` fails the first time, as it is written to, so its
`on_failure` sends the run back to `draft` with only that failure; the second time `check` passes and the task
ends `COMPLETED` with exit code 0. The commands are `node -e`, so the same file runs on Windows, macOS and Linux.

What it left behind is under `.indaba/`: the trace of the run, the steps and the retry as OpenTelemetry spans
(see [What a run leaves behind](#what-a-run-leaves-behind)). From here:

- give a step a `role` backed by an agent or a model: [Runners](#runners) and [workflow-format.md](workflow-format.md);
- let two agents debate a decision: [consensus steps](workflow-format.md#consensus-steps);
- follow, start and edit runs in a browser with `indaba ui`: [The web view](#the-web-view-indaba-ui) (from a checkout for now).

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

`npx indaba schema` prints the JSON Schema of the file, for an editor that completes and checks it as you type.
`npx indaba catalog` lists the runners, guard types and arbiters this installation offers, each in one line
(`--plugin <spec>` to include a plugin's, `--json` for a program).

`npx indaba workflows list` lists the workflow files of this folder and of the folders you add
(`indaba workflows add <folder>`), each valid or with its first problem, and its last run. The list is kept in
`.indaba/registry/` of each folder, on this machine only (it ignores itself in git); the files stay the workflows.
`annotate <id>` gives an entry your name, project and tags or hides it, `copy <id> --to <folder>` copies a file and
says what to review in it, and `remove <id>` takes a missing file out of the list; nothing deletes or rewrites a file.
`indaba workflows --help` has the rest.

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

The workflow file format is described in [workflow-format.md](workflow-format.md). Six examples to start
from are in [`examples/`](../examples/), from `hello.workflow.ai.yml` (shell only) to `review-debate.workflow.ai.yml`
(a debate).

### `run` options

| Option | Meaning |
| :--- | :--- |
| `-w, --workdir <dir>` | The project directory the workflow runs against (default: the current directory) |
| `--task-id <id>` | Names the task, its worktree and its trace; a random id otherwise |
| `--timeout <secs>` | Per-step timeout in seconds (default 900); applies to every runner |
| `--plugin <spec>` | Load a plugin (repeatable); also accepted by `validate` and `plan`. See [extending.md](extending.md) |
| `-v` | Print the cost of each span that has one; `-vv` also streams the agent's output live |
| `--tui` | Run in a process of its own and show it as a dashboard (needs a terminal and `@indaba/tui`). See [Starting a run and watching it at once](#starting-a-run-and-watching-it-at-once) |
| `--discussion-dir <dir>` | Where the messages of each debate are kept for the web view (default `.indaba/discussions`) |
| `--permissions [<step>=]<level>` | Lower what agents may do in this run: `read`, `edit` or `full` (repeatable). It never raises a level and never writes the file; a step with no level takes only `read`. See [Permission levels](#permission-levels) |
| `--allow-full-access` | Acknowledge the steps at the level `full` when there is no terminal to ask at |
| `--log-level <level>` | `error`, `warn`, `info` (default) or `debug`; every command accepts it. See [Logs](#logs) |
| `--log-dir <dir>` | Folder of the log files (default `.indaba/logs`); every command accepts it |
| `-h, --help`, `-V, --version` | Help and version |

Exit codes: 0 completed, 1 failed (also: any error), 2 escalated or a usage error, 130 cancelled. Press
Ctrl+C once to cancel a run: the running step is stopped and worktrees are removed. A second Ctrl+C
gives up on the run; it first writes the last log records (for at most 2 seconds), and a third leaves at once.

### Logs

Every command (`validate`, `plan`, `run`, `watch`, `report`, `settings`, `ui`, `schema`, `catalog`, `workflows`) appends JSON lines, one record per line, to
`.indaba/logs/indaba-<yyyy-mm-dd>.log.jsonl` in the project (for `run`, the `--workdir` one): a `process.start` record
(the command name, the Indaba and Node versions, the platform and architecture, never the arguments), every step state
change and span that ends with an error, every process and HTTP request a runner starts, and `process.end` with the
exit code. Records at `warn` and above are also printed on standard error; standard output does not change. Secrets
are redacted before anything is written; even so, read a log before you send it to someone.

The level, the files and other destinations (Graylog over GELF, any JSON collector) are set in `indaba.config` or with
`indaba settings`; `indaba report` gathers what belongs to one run into a folder to attach to an issue. All of it is in
[logging.md](logging.md).

```bash
npx indaba settings                # the Settings screen with @indaba/tui on a terminal; otherwise prints the settings
npx indaba settings --plain        # print the settings in use (-w <dir> for another project, --ascii without box characters)
npx indaba report latest           # one redacted folder under .indaba/reports/ with the run's log, trace and environment
```

`report` takes `--workflow <file>` to include a workflow other than `.indaba/workflow.ai.yml` and `--out <dir>` for
another folder; it sends nothing anywhere.

## Environment variables

Indaba reads only these from its environment, and passes only these to the runners it builds:

| Variable | Used by | Meaning |
| :--- | :--- | :--- |
| `OPENROUTER_API_KEY` | `openrouter` runner | Your OpenRouter key. Without it the runner cannot run (`OPENROUTER_API_KEY is not set.`), and a workflow that lists another runner after it moves on to that one |
| `INDABA_OPENAI_COMPAT_<NAME>_BASE_URL` | an OpenAI-compatible runner | Adds a runner named `<name>` in lower case with `_` as `-` (`LM_STUDIO` is `lm-studio`). The URL is `http` or `https`, up to the version segment, for example `http://localhost:11434/v1` |
| `INDABA_OPENAI_COMPAT_<NAME>_KEY_ENV` | the same | The **name** of the variable that holds that endpoint's key. Without it the endpoint is treated as keyless (a local server) |
| `INDABA_OPENAI_COMPAT_<NAME>_MODEL` | the same | The model used when a role names none |
| `INDABA_LOG_LEVEL` | every command | The log level when `--log-level` is not given: `error`, `warn`, `info` or `debug`. Anything else is a usage error |
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
| `claude-code` | `claude -p <prompt> --permission-mode acceptEdits` (plus `--model`, MCP config; with a `permissions.level`: `plan`, `acceptEdits` or `bypassPermissions`). A last resort | the `claude` CLI, logged in |
| `codex` | `codex exec --sandbox workspace-write <prompt>` | the `codex` CLI, logged in (`codex login`) |
| `antigravity` | `agy -p <prompt>` | the `agy` CLI |
| `cursor` | `cursor-agent -p <prompt>` | the `cursor-agent` CLI |
| `opencode` | `opencode run [--model <m>] <prompt>`. A last resort; Indaba adds `--auto` only for `permissions: { level: full }`, otherwise pass it in `extraArgs` if you want it | the `opencode` CLI, logged in (`opencode auth login`) or a provider key in the environment |

Each agent CLI authenticates itself; Indaba does not log you in.

### Permission levels

A step's `permissions.level` says how much its agent may do, and each runner turns it into its own arguments:

```yaml
permissions: { level: read }                              # look only
permissions: { level: edit, fs: { write: ["src/**"] } }   # change these files
permissions: { level: full }                              # no limit from Indaba
```

`indaba catalog` shows which levels each runner can hold; `validate`, `plan` and the start of a run refuse a level a
runner of the step's chain cannot hold. A step with no level keeps its runner's built-in behaviour, and `validate` and
`plan` say so for each such step. A block may also sit on a role or in `defaults`.

Steps at `full` are acknowledged once per run: at a terminal `indaba run` lists them and asks; without one it refuses to
start unless you pass `--allow-full-access`. `indaba run --permissions [<step>=]<level>` lowers levels for one run and
never raises them. Every rule is in [workflow-format.md](workflow-format.md#the-level-read-edit-full).

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
| `opencode` | `opencode acp`. Passes `OPENCODE_`, `ANTHROPIC_`, `OPENAI_`, `GOOGLE_`, `GEMINI_` and `OPENROUTER_` variables on. On Windows, `opencode` is an npm `.cmd` shim that Indaba does not start: point `command` at the native `opencode.exe`, or use WSL (see below) |
| `{ command: [program, arg, ...] }` | exactly that, for any other agent or a pinned, locally installed copy |

**OpenCode on Windows.** OpenCode runs natively on Windows but recommends WSL ([opencode.ai/docs/windows-wsl](https://opencode.ai/docs/windows-wsl)). Indaba does not bridge the two: it never starts `wsl.exe` or translates `C:` paths to `/mnt/c/`. If you want OpenCode in WSL, install and run Indaba inside WSL too, so `opencode` is a Linux executable on that PATH and every path is a Linux path. Otherwise use the native `opencode.exe` through `agent.command`.

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
| `.indaba/artifacts/<step>.transcript.md`, `<step>.ruling.md` | The messages of a debate step and, when an arbiter ruled, its ruling |
| `.indaba/discussions/<traceId>.<stepId>.json` | The same messages of a debate, per run, for the web view to show (redacted, control sequences dropped). `indaba run --discussion-dir <dir>` keeps them elsewhere |
| `.indaba/run-inputs/` | For a run started from `indaba ui`: the copy of the confirmed workflow file that the run reads |
| `.indaba/registry/` | The list of `indaba workflows` for this folder (with its own `.gitignore`, so it stays on this machine) |
| `.indaba/logs/`, `.indaba/reports/` | The log files of every command (see [Logs](#logs)) and the folders `indaba report` makes |
| `.indaba-decisions/<workflow>.jsonl` | **Committed, not ignored.** Every arbiter ruling, one JSON line each, and the memory that lets an identical re-run skip the debate. See [Consensus steps](workflow-format.md#consensus-steps) |
| the paths your workflow names under `artifacts` | Whatever the steps wrote there, and the diff of an isolated worktree if you named a `patch` artifact |

`.indaba/` is runtime state; add it to your `.gitignore`. `.indaba-decisions/` is not: commit it.

A cost is shown only when the model's price is known and the usage was reported; an unknown cost is
absent, not zero.

## Watching a run

```bash
npx indaba watch                  # list the runs, newest first, with the workflow of each
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
0 completed, 1 failed, 2 escalated, 130 cancelled, 3 when the files end without a final state or the run goes quiet.

When a run has a board (see [the board](workflow-format.md#the-board-notes-between-steps)), `--plain` ends with it: the
facts, then the newest 50 notes between steps as `#<number> <step> <kind>: <text>`, and a line saying how many older
ones are not shown. A run with no board file prints exactly what it did before. In the dashboard, `b` opens the board
beside the steps; the [playbook](playbook.md#reading-the-board) has the keys.

Other options: `-w <dir>` for another project, `--output` to also print each line a step streams, `--stale <secs>` to
give up on a run that writes nothing for that long (default 120), and `--color` to colour the states.

The same runs can be followed in a browser: see [The web view](#the-web-view-indaba-ui).

### Starting a run and watching it at once

```bash
npx indaba run my.workflow.ai.yml --tui
```

`--tui` starts the run as a process of its own and opens the dashboard on it. It needs a terminal and
`@indaba/tui`; without either it says so and starts nothing. Quitting the dashboard while the run is going asks
what to do: `d` detaches (the run carries on, and `indaba watch <run>` picks it up again), `c` cancels it (the
run stops as it does on Ctrl+C and removes its worktree), `n` stays. Ctrl+C on the command line cancels the run
too. If the dashboard itself fails, the run is left going and the message says how to follow it. The run's own
output goes to the files above, so `-v` has no effect with `--tui`.

## The web view: `indaba ui`

```bash
pnpm indaba ui                                   # the runs of the current folder; opens your browser
pnpm indaba ui --root /path/to/project --root .  # several projects
pnpm indaba ui --no-open --port 4173
pnpm try:ui -- --demo                            # a throwaway run with a retry, no agent or key needed
```

A page on your own machine that lists your runs and follows one live as a graph, with each step's details, tries,
output and cost. It can also start a workflow of a project (showing first what its file says it will use) and stop a
run it started, list your workflows on its **Workflows** screen (the same list as `indaba workflows`), edit a workflow
as a form, a graph or text, and change the logging settings. A run started in a terminal it only shows.

It prints an address that carries a token and works only on this machine; keep it to yourself. Ctrl+C stops it and
the runs started from the page. Options: `--root <dir>` (repeatable), `--discussion-dir <dir>` (repeatable),
`--port <n>`, `--no-open`, and `--log-level` and `--log-dir` as for every command.

`indaba ui` needs the optional `@indaba/server` next to `indaba`; the page comes inside it. Version `0.1.0-alpha.3` is on
npm but cannot be installed yet, so for now use `pnpm indaba ui` from a built checkout (below). Everything else is in
[web-view.md](web-view.md).

## Running from a checkout

For `indaba ui`, and for whatever has merged since the last release (the table at the top), run the CLI from the
repository:

```bash
git clone https://github.com/yaotzin1/indaba.git
cd indaba
pnpm install
pnpm build
node packages/cli/dist/bin.js validate examples/task-pipeline.workflow.ai.yml
```

`indaba` is not a command in a clone until it is installed from a package. Inside the checkout, `pnpm indaba <command>` is the same as `node packages/cli/dist/bin.js <command>` (build first), for
example `pnpm indaba run examples/task-pipeline.workflow.ai.yml --tui`.

`pnpm install` needs pnpm 9 (`corepack enable` provides it). Run the command from your own project
directory (use an absolute path to `bin.js`) so that traces and worktrees land in that project.

## Next

- [playbook.md](playbook.md): recipes for every way of working with Indaba, step by step
- [workflow-format.md](workflow-format.md): every field of a workflow file
- [web-view.md](web-view.md): the web view (`indaba ui`)
- [logging.md](logging.md): logs, `indaba settings` and `indaba report`
- [extending.md](extending.md): add a runner, a guard type or a listener with a plugin
