# The workflow file

A workflow file is the YAML document Indaba executes: roles, steps, guards and retries. By convention it
is called `workflow.ai.yml`, and `indaba` looks for `.indaba/workflow.ai.yml` when you give no file.

This is not the `workflow.ai.yml` at the root of the Indaba repository. That one is the development
workflow of Indaba itself, with a different schema, and no `indaba` command reads it.

The format version is `"1.0"`. Run `indaba validate <file>` to check a file; it lists every problem it
finds at once, each prefixed with its path in the document, for example
`$.steps[1].role uses ...` or `step "verify" depends on unknown step "code2"`.

The file must be one YAML document, parsed with the YAML core schema (no custom tags) and with unique
keys: a duplicate key is an error.

## A complete example

```yaml
version: "1.0"
name: "task-pipeline"

artifacts:
  spec: ".indaba/artifacts/spec.md"
  patch: ".indaba/artifacts/change.patch"

roles:
  architect:
    runner: "openrouter"
    model: "anthropic/claude-3.7-sonnet:thinking"
  implementer:
    runner: "claude-code"
  reviewer:
    runner: "antigravity"

steps:
  - id: "rfc"
    role: "architect"
    goal: "Prepare a technical specification in ${{ artifacts.spec }}"
    outputs: ["${{ artifacts.spec }}"]
    guards:
      - type: "git_diff_empty"
        paths: ["packages/"]

  - id: "code"
    depends_on: ["rfc"]
    role: "implementer"
    input_artifacts: ["${{ artifacts.spec }}"]
    goal: "Implement the change described in the specification."
    isolation: "git_worktree"

  - id: "verify"
    depends_on: ["code"]
    runner: "shell"
    commands:
      - "pnpm test"
      - "pnpm typecheck"
    on_failure:
      action: "retry_step"
      target: "code"
      max_retries: 3

  - id: "debate_review"
    depends_on: ["verify"]
    role: "reviewer"
    consensus_with: ["architect"]
    decision_type: "consensus"
```

This is `examples/task-pipeline.workflow.ai.yml`; `examples/mcp.workflow.ai.yml` shows MCP servers.

## Top-level fields

| Field | Required | Meaning |
| :--- | :--- | :--- |
| `version` | yes | Must be `"1.0"`. Anything else is `unsupported version "<x>" (expected "1.0")` |
| `name` | yes | Non-empty string; names the trace (`indaba.task <name>`) |
| `artifacts` | no | Map of name to a path string. Names a path once so steps can refer to it |
| `roles` | no | Map of role name to a role (see below). Needed by any step that uses `role` |
| `steps` | yes | A list with at least one step |
| `mcp_servers` | no | Map of server name to a Model Context Protocol server |
| `defaults` | no | Only `defaults.mcp_policy` is read: `required` (the default) or `optional` |

### `artifacts` and interpolation

`${{ artifacts.<name> }}` (name matching `[A-Za-z0-9_-]+`) is replaced by the artifact's path. It is
resolved in a step's `goal`, `input_artifacts`, `outputs` and `commands`, and nowhere else. An unknown
name is an error: `$.steps[0].goal: unknown artifact "x"`. There is no other interpolation syntax.

Artifact paths are relative to the step's working directory and may not leave it. One name has meaning:
if an artifact called `patch` exists, the diff of an isolated worktree is written to its path after every
isolated step that succeeds.

### `roles`

| Field | Required | Meaning |
| :--- | :--- | :--- |
| `runner` | yes | The runner that executes the role, or a list of runners in priority order (see [Transports and fallback](#transports-and-fallback)): `openrouter` or another API runner, `acp`, `claude-code`, `codex`, `antigravity`, `cursor`, or the name of a runner a plugin registers |
| `agent` | no | For the `acp` runner: the agent to start, a preset name (`claude`, `codex`, `gemini`) or `{ command: [program, arg, ...] }`. Other runners ignore it |
| `model` | no | Passed to the runner as its model. API runners require one |
| `mcp` | no | List of `mcp_servers` names that every step of the role may use |

A role named in a step must exist (`step "x" uses unknown role "y"`). Role names may be any string; keep
to letters, digits, `_` and `-`.

### `steps`

Steps run one at a time in dependency order. Ties between steps that could run next are broken by the
order they are written in. A cycle or a dependency on an unknown step is a validation error.

| Field | Required | Meaning |
| :--- | :--- | :--- |
| `id` | yes | Unique, matching `[A-Za-z0-9_-]+` |
| `role` | one of `role` or `runner` | A key of `roles`. The step is an agent step run by the role's runner and model |
| `runner` | one of `role` or `runner` | A runner, or a list of runners in priority order, named directly. `shell` makes a shell step. When a step has both a `role` and a `runner`, the step's `runner` is used and the role still supplies the model |
| `agent` | no | For the `acp` runner: overrides the role's `agent` |
| `permissions` | no | What the step's agent may touch (see [Permissions](#permissions)) |
| `goal` | no | The instruction given to the agent (interpolated). Empty for a shell step |
| `depends_on` | no | List of step ids that must complete first. A step may not depend on itself |
| `input_artifacts` | no | Paths the agent is told to read first (interpolated). Copied into a worktree if they exist only in the project directory |
| `outputs` | no | Paths the step must create (interpolated). Missing after the step is a failure: `Expected output "x" was not produced.` |
| `commands` | shell steps | List of command lines (interpolated), run in order; the first non-zero exit fails the step. Only a `runner: "shell"` step may have them, and it must have at least one |
| `guards` | no | Checks run after the step succeeds (see Guards) |
| `isolation` | no | `none` (default) or `git_worktree` |
| `on_failure` | no | What to do when the step fails (see Retries) |
| `consensus_with` | no | Roles that debate with this step's `role` |
| `decision_type` | no | `consensus` (every participant agrees) or `majority` (more than half) |
| `mcp` | no | `mcp_servers` names this step may use, in addition to its role's |
| `mcp_policy` | no | `required` or `optional`; overrides `defaults.mcp_policy` for this step |

A step needs a `role` or a `runner`. Using `commands` on a step whose runner is not `shell` is an error.

The agent receives a prompt built from the role name, the `goal`, the input artifacts and required
outputs, and, on a retry, the failure of the previous attempt.

### Transports and fallback

An agent is reached in one of three ways. Choose the first that fits and list the others after it.

| Transport | Runners | Choose it for | Trade-off |
| :--- | :--- | :--- | :--- |
| API | `openrouter`, and any OpenAI-compatible endpoint you configure | text work: specs, reviews, debate, consensus. Needs only a key | the model returns text; it cannot edit files or run tools itself |
| ACP | `acp` with an `agent` | an agent that changes code. Structured events in the trace, and a permission gate you control | needs a local agent program; the presets start it with `npx`, which on Windows is a shim Indaba does not start (use a native executable) |
| CLI | `claude-code`, `codex`, `antigravity`, `cursor` | a last resort, or an agent with no API or ACP route | scrapes terminal output, so it breaks when the CLI's output changes; no per-action permissions |

```yaml
roles:
  implementer:
    runner: ["acp", "claude-code"]   # ACP first, the CLI only as a fallback
    agent: "claude"
```

The first runner in the list that **can run** is used. A runner cannot run when nothing has yet been
sent to the agent: there is no API key, the program was not found, the endpoint did not answer, an API
key was rejected, or the ACP handshake failed. A runner that started and then failed is a failed task:
the next runner is **not** tried, because the agent may already have changed files; `on_failure`
decides what happens. If no runner of the list could run, the step fails and names each one and why.

Each attempt gets the original prompt, never the output of an earlier runner. `indaba plan` prints the
list (`runners acp -> claude-code`), and the trace records which runner ran and an `indaba.runner.skipped`
event for each one that could not.

API endpoints beyond `openrouter` are configured in the environment, never in the workflow file (a
base URL in a file you did not write could send your key elsewhere); see
[getting-started.md](getting-started.md#environment-variables). Examples:
[`examples/transport-fallback.workflow.ai.yml`](../examples/transport-fallback.workflow.ai.yml) and
[`examples/api-only.workflow.ai.yml`](../examples/api-only.workflow.ai.yml).

### Permissions

```yaml
permissions:
  fs:
    read: ["src/**", "tests/**"]   # empty or absent: reads are not restricted
    write: ["src/**"]               # empty or absent: the step may change nothing
  terminal: "deny"                  # allow | deny (default deny)
```

Globs use `*` and `?` inside one path segment and `**` for any number of segments, relative to the step's
working directory. `permissions` does two things:

- Over ACP, the runner answers the agent's permission requests and serves its file requests only inside
  these globs and the working directory; anything else is refused as it is asked, and recorded in the
  trace. Without a `permissions` block the `acp` runner refuses edits, deletes, moves and commands.
  It never grants an "always allow" option, since that would outlive the step. Files under `.git` and
  `.indaba` are never served.
- For every runner, a `diff_within_scope` guard is added to the step: after the step, anything changed
  outside `fs.write` fails it. An agent can write to disk without asking the client, so this guard,
  together with `isolation: git_worktree`, is the boundary that holds; the ACP gate is an early layer on top.

`indaba validate` warns when a step declares `permissions` without `isolation: git_worktree`, and when
no `acp` runner is in its chain (then only the guard enforces it, after the step has run).

#### Shell steps

`runner: "shell"` runs each command line through the platform shell (`/bin/sh -c` on macOS and Linux,
`cmd.exe /d /s /c` on Windows), in the step's working directory. This is the one place a string is given
to a shell. The command lines are yours, written in the file; never put text produced by a model into a
command. Each command is limited by the step timeout (900 seconds unless `indaba run --timeout` says
otherwise). Write commands that work on every OS you target, or call one executable with simple
arguments.

#### Consensus steps

A step with `decision_type` or `consensus_with` is a debate. The participants are its `role` plus every
role in `consensus_with`, each run by its own runner; they exchange messages on a shared blackboard for
up to four rounds. A step that takes part in a debate needs a `role`. If the participants do not reach the
decision type's quorum, the step is escalated, not retried, and the run ends with status `escalated`.

#### Isolation

`git_worktree` runs the step in a detached git worktree under `.indaba/worktrees/<taskId>`. Steps that
depend on an isolated step run in the same worktree, so a verify step sees what the code step wrote. The
worktree is removed when the run ends, whether it completed, failed or was cancelled. The project
directory must be a git repository.

### Guards

```yaml
guards:
  - type: "git_diff_empty"
    paths: ["packages/"]
```

A guard runs after a step succeeds and its outputs exist. Each entry needs a `type`; `paths` is a list
(interpolated). A guard that fails fails the step with `Guard <type> failed: ...`.

| Type | Passes when |
| :--- | :--- |
| `git_diff_empty` | nothing under the listed `paths` (default: the whole directory) was modified, added or deleted, tracked or not. It fails if git state cannot be read |
| `diff_within_scope` | every path changed in the working directory, tracked or not, matches one of the listed `paths` (globs; an empty list means nothing may change). `.indaba/` is ignored. It fails if git state cannot be read. It is added automatically to a step with `permissions` |

An unknown type is `$.steps[0].guards[0].type "x" is not a known guard`. A plugin can register more
types; see [extending.md](extending.md).

### Retries: `on_failure`

```yaml
on_failure:
  action: "retry_step"
  target: "code"
  max_retries: 3
```

| Field | Meaning |
| :--- | :--- |
| `action` | `retry_step`, `escalate` or `fail` |
| `target` | For `retry_step`: the step to run again. It must be the failing step itself or one of its ancestors |
| `max_retries` | For `retry_step`: an integer of at least 1 (default 0, which is invalid for `retry_step`) |

When a step fails with `retry_step`, the target and every step after it are reset and run again. The
target's next prompt carries only the failure of the last attempt (trimmed to its last 4000 characters),
never the history. After `max_retries` attempts the run ends `escalated`. `escalate` ends the run as
`escalated` at once, and `fail` (or no `on_failure`) ends it as `failed`.

### MCP servers

```yaml
mcp_servers:
  docs:
    command: "npx"
    args: ["-y", "my-docs-mcp"]
    env:
      DOCS_TOKEN: "set-me"
  tracker:
    url: "https://mcp.example.com/sse"
```

Each server needs exactly one of `command` (a local process; `args` and `env` are optional) or `url` (an
`http` or `https` endpoint; `args` and `env` do not apply). Names match `[A-Za-z0-9_-]+`. Server
definitions can hold secrets and never appear in logs, traces or messages; only names do.

How a server reaches a step depends on the runner:

| Runner | MCP |
| :--- | :--- |
| `claude-code`, `codex`, `acp` | Indaba injects the servers into the agent's configuration (over ACP, an `http` server needs an agent that supports it; otherwise the runner cannot run and the next one is tried) |
| `cursor`, `antigravity` | The agent manages its own servers; Indaba assumes the named ones are configured and says so in `plan` |
| `openrouter` and other API runners, `shell`, others | No MCP support |

If a step wants a server its runner cannot provide, `mcp_policy: required` (the default) refuses the run
before it starts, and `optional` runs the step without it. `indaba plan` prints these findings as
`MCP error:` and `MCP warning:` lines.

## Beyond code: a media pipeline

Nothing in the format is specific to programming. A step can drive any tool through a `shell` command or
an MCP server, so a workflow can prepare and assemble media as easily as it edits code. This example
sketches a pipeline; the tools it calls (`ffmpeg`, a `media-mcp` server) are stand-ins for whatever you
have installed, and Indaba ships no integration with any editing application.

```yaml
version: "1.0"
name: "episode-assembly"

artifacts:
  shotlist: "work/shotlist.md"
  proxy: "work/proxy.mp4"
  report: "work/report.md"

mcp_servers:
  media:
    command: "media-mcp"
    args: ["--project", "episode-12"]

roles:
  editor:
    runner: "claude-code"
    mcp: ["media"]
  critic:
    runner: "openrouter"
    model: "anthropic/claude-3.7-sonnet"

steps:
  - id: "proxies"
    runner: "shell"
    commands:
      - "ffmpeg -y -i raw/interview.mov -vf scale=1280:-2 ${{ artifacts.proxy }}"
    outputs: ["${{ artifacts.proxy }}"]

  - id: "plan_cut"
    depends_on: ["proxies"]
    role: "editor"
    input_artifacts: ["${{ artifacts.proxy }}"]
    goal: "Write a shot list for a three minute cut to ${{ artifacts.shotlist }}."
    outputs: ["${{ artifacts.shotlist }}"]

  - id: "assemble"
    depends_on: ["plan_cut"]
    role: "editor"
    mcp: ["media"]
    input_artifacts: ["${{ artifacts.shotlist }}"]
    goal: "Assemble the timeline described in the shot list using the media tools."
    on_failure:
      action: "retry_step"
      target: "assemble"
      max_retries: 2

  - id: "check"
    depends_on: ["assemble"]
    runner: "shell"
    commands:
      - "ffprobe -v error -show_format work/episode.mp4"
    on_failure:
      action: "retry_step"
      target: "assemble"
      max_retries: 2

  - id: "review"
    depends_on: ["check"]
    role: "critic"
    consensus_with: ["editor"]
    decision_type: "majority"
    input_artifacts: ["${{ artifacts.shotlist }}"]
    goal: "Decide whether the assembled cut matches the shot list."
```

## What a run reports

`indaba run` ends with `completed`, `failed`, `escalated` or `cancelled`; the exit codes are 0, 1, 2 and
130. Every step's state changes are printed, and the run is written as a trace under `.indaba/traces`
(see [getting-started.md](getting-started.md)).
