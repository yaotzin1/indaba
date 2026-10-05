# Using the alpha

Indaba is a preview (`0.1.0-alpha`). This page is for trying it: which way of reaching an agent to
choose, a first run, and what is still rough. The field-by-field reference is
[workflow-format.md](workflow-format.md); the environment and runner details are in
[getting-started.md](getting-started.md).

## What is and is not verified

The API runners, the runner lists with fallback, the scope guard and the ACP runner are covered by
tests, including a test that starts a real child process and speaks ACP to it. The ACP runner has
**not yet been run against the real Claude, Codex or Gemini ACP agents**: it follows the protocol's
published schema, and the first run against a real agent may find differences. If you try one, a report
is valuable (see the end).

The features described here are in the repository first. Until a prerelease that contains them is
published, run them from a checkout (below). The `0.1.0-alpha.0` on npm predates them.

## Which transport, when

An agent can be reached three ways. Use the first that fits, and list the others after it.

| | API | ACP | CLI |
| :--- | :--- | :--- | :--- |
| Runners | `openrouter`, or an endpoint you configure | `acp` + `agent:` | `claude-code`, `codex`, `antigravity`, `cursor` |
| Use it for | text work: specs, reviews, debate, consensus | an agent that **edits code** | a last resort |
| Needs | a key (or a local server) | the agent program, logged in | the CLI, logged in |
| Edits files itself | no, it returns text | yes, inside a worktree you scope | yes, unscoped |
| Permissions | not applicable | per-request gate plus the scope guard | the scope guard only |
| In the trace | tokens and cost | tool calls, permission decisions, context use | output |
| Fragile when | the service is down | the agent's ACP command changes | the CLI's terminal output changes |

A rule of thumb: **API for thinking, ACP for doing, CLI last.**

```yaml
roles:
  architect:                       # writes a spec: text only, so the API
    runner: "openrouter"
    model: "anthropic/claude-3.7-sonnet:thinking"
  implementer:                     # edits code: ACP, and the CLI only if ACP cannot start
    runner: ["acp", "claude-code"]
    agent: "claude"
```

### How the list behaves

The first runner that **can run** is used. It cannot run when nothing has yet been sent to the agent:
no key, program not found, endpoint unreachable, key rejected, ACP handshake failed. A runner that
started and then failed is a failed task: the next runner is not tried, because the agent may already
have changed files. Your `on_failure` rules decide what happens. If none could run, the step fails and
lists each runner and why.

## Try it

### From a checkout

You need Node 22 and git.

```bash
pnpm install
pnpm build
node packages/cli/dist/bin.js --version
```

Below, `indaba` stands for `node packages/cli/dist/bin.js`.

### 1. Look at a workflow without running anything

```bash
indaba validate examples/transport-fallback.workflow.ai.yml
indaba plan     examples/transport-fallback.workflow.ai.yml
```

`plan` prints the order and, for the implementer step, the runner list and its scope:

```
2. code [implementer] (after rfc; runners acp -> claude-code; may only change src/**, tests/**)
```

### 2. See the fallback work, with no key and no agent installed

The repository contains a tiny scripted ACP agent used by its tests. This workflow lists
`openrouter` first, which cannot run without a key, then `acp`, started from that script. Put it in an
empty folder as `w.yml`, with the two paths filled in (use `/` in paths, also on Windows; the first is the
output of `node -p "process.execPath"`, the second is the script in your checkout):

```yaml
version: "1.0"
name: try-fallback
roles:
  worker:
    runner: [openrouter, acp]
    model: any
    agent:
      command: ["<path to node>", "<checkout>/packages/runners/test/fixtures/fake-acp-agent.mjs"]
steps:
  - id: work
    role: worker
    goal: say hello
```

Run it with the key unset, from that folder:

```bash
indaba run w.yml -w .
```

The step completes, and the trace shows what happened. Print it with:

```bash
node -e "for (const l of require('fs').readFileSync(process.argv[1], 'utf8').trim().split('\n')) { const s = JSON.parse(l); console.log(s.name, s.status, JSON.stringify(s.events ?? [])) }" .indaba/traces/<the trace id printed by run>.jsonl
```

You will see `invoke_agent openrouter` ending in `error`, an `indaba.runner.skipped` event on the step with
the reason (`OPENROUTER_API_KEY is not set.`), and an `invoke_agent acp` span with `indaba.acp.session`
and `indaba.acp.completion` events.

### 3. An API run

```bash
# set OPENROUTER_API_KEY in your environment first
indaba run examples/api-only.workflow.ai.yml -w /path/to/a/git/project -v
```

To use another OpenAI-compatible service, add environment variables (never a line in the workflow file):

```
INDABA_OPENAI_COMPAT_LOCAL_BASE_URL=http://localhost:11434/v1
INDABA_OPENAI_COMPAT_LOCAL_MODEL=llama3
```

and write `runner: local`. A key goes in a variable of your choice, named by
`INDABA_OPENAI_COMPAT_LOCAL_KEY_ENV`. Without that name the server is treated as keyless.

### 4. A real ACP agent

1. Install and log in to the agent with its own tool; Indaba does not log you in and an agent that asks
   for a login cannot run headless.
2. Name it: `agent: claude`, `codex` or `gemini` (presets), or `agent: { command: [program, args...] }`.
3. Scope it, and run it in a worktree:

```yaml
steps:
  - id: code
    role: implementer
    goal: "Implement the change."
    isolation: "git_worktree"
    permissions:
      fs:
        read: ["src/**", "tests/**"]
        write: ["src/**"]
      terminal: "deny"
```

What this gives you: the `acp` runner refuses requests outside the scope and records each decision;
a `diff_within_scope` guard fails the step if anything outside `src/**` changed, whichever way the
agent changed it; the worktree keeps your project untouched until you apply the patch.

Things to know:

- `claude`, `codex` start with `npx`, which downloads code each time and, on Windows, is a `.cmd` shim
  Indaba does not start. Install the agent and use `agent: { command: [...] }` with the native
  executable there, or when you want a pinned version.
- Your environment is not handed to the agent: only `PATH`, home and temp folders, proxy and
  certificate settings, and variables with the agent's own prefix (`ANTHROPIC_`, `OPENAI_`,
  `GEMINI_`...). Add more with `INDABA_ACP_PASS_ENV`.
- With no `permissions` block, the `acp` runner refuses every edit, delete, move and command: a step
  that must change files needs one.

### 5. A CLI as the last resort

Put it last in a list (`runner: ["acp", "claude-code"]`) or alone if it is all you have. See
[getting-started.md](getting-started.md#runners) for what each needs, and the Windows note on `.cmd`
shims.

## Rough edges to expect

- ACP protocol version 1 only. An agent that agrees on another version is treated as unable to run.
- ACP does not report input and output tokens, so ACP steps have no token counts. A cost is recorded
  only if the agent reports one in USD.
- Without `isolation: git_worktree` the scope guard sees every change in your working tree, not only
  the step's. `indaba validate` warns about it.
- A step that sets both `role` and `runner` now uses its own `runner` (it used to be the role's).
- An unknown runner name in a workflow is now an error from `validate`, `plan` and `run`.
- Names, wire details and defaults may still change before 1.0.

## Reporting a problem

Open an issue on the repository. Include the workflow (without secrets), the output of `indaba plan`,
which runner you expected and which ran, and the trace file from `.indaba/traces`. A trace holds names,
counts, statuses and error messages (including why a runner was skipped), never an API key, but read it
before you share it.
