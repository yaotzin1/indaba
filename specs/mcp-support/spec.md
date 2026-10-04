# Specification: MCP support through agents

> **Superseded implementation language.** This spec was written for the PHP prototype, which was never
> published. Behaviour is unchanged by the TypeScript port; class, method and field names follow
> [`specs/typescript-port/api-surface.md`](../typescript-port/api-surface.md) (for example
> `RunnerInterface` is `Runner`, `*Exception` is `*Error`, fields are camelCase). Where this text names a
> PHP, Composer, Symfony or Docker detail, read the Node and TypeScript equivalent.

> **Status**: Draft
> **Stage entry**: 1
> **Semver impact**: minor (new optional workflow keys and public classes; below 1.0)

---

## 1. The problem

Agents are far more useful with tools: a browser, a database, a ticket tracker, a docs index, all
reachable through the Model Context Protocol (MCP). Today a workflow author has no way to say "this
step needs the `docs` MCP server", and has to configure each agent CLI by hand, with no guarantee
that the server is present when a step runs. Worse, engines differ: Claude Code and Codex accept MCP
server configuration on the command line, Antigravity reads its own settings, and a raw API runner such
as OpenRouter has no MCP at all. A step that silently runs without the tools it was written for
produces confident, wrong work.

## 2. User stories

- **US-01.** As a workflow author, I declare MCP servers once, and a role or a step lists the ones it
  needs.
- **US-02.** As a workflow author, I choose what happens when an engine cannot provide a server:
  refuse to run (the default) or run without it.
- **US-03.** As a person running `bin/indaba plan`, I see before any agent starts which steps cannot
  get which servers.
- **US-04.** As a developer adding a runner, I declare what MCP support it has with one small
  interface and nothing else changes.

## 3. Acceptance criteria

- [ ] AC-01 `mcp_servers` declares servers by `command` (+ `args`, `env`) or by `url`; exactly one of the
      two; names match `[A-Za-z0-9_-]+`; a URL is `http` or `https`.
- [ ] AC-02 `roles.<r>.mcp` and `steps[].mcp` reference declared servers; an unknown name is a
      validation error naming the step or role.
- [ ] AC-03 The policy is `required` or `optional`. It is resolved as step `mcp_policy`, else workflow
      `defaults.mcp_policy`, else `required`.
- [ ] AC-04 Each runner reports one capability: `injected` (Indaba passes the configuration),
      `agent_managed` (the agent keeps its own MCP configuration; Indaba cannot inject or verify it),
      or `none`. A runner that does not say is `none`.
- [ ] AC-05 Preflight runs before the first step. Under `required`, a server the runner cannot provide
      (`none`) is an error and nothing runs. Under `optional` it is a warning and the step runs without
      it. `agent_managed` is accepted with a warning, because it cannot be verified.
- [ ] AC-06 `ClaudeRunner` passes injected servers as a temporary `--mcp-config` file plus
      `--strict-mcp-config`, so only the declared servers are visible; the file is mode 0600 and removed
      afterwards, including on failure and timeout.
- [ ] AC-07 `CodexRunner` passes injected servers as `-c mcp_servers.<name>.*` overrides.
- [ ] AC-08 `AntigravityRunner` and `CursorRunner` are `agent_managed`; `OpenRouterRunner`,
      `ShellRunner` and `CommandRunner` are `none` unless a `CommandRunner` is built with a capability.
- [ ] AC-09 Role-level servers also apply to that role's turns in a consensus.
- [ ] AC-10 The step span records `indaba.mcp.servers`, `indaba.mcp.assumed` and `indaba.mcp.skipped`
      (names only). Commands, arguments, URLs and environment values never appear in spans, events,
      errors or logs.
- [ ] AC-11 `bin/indaba plan` prints the MCP issues and exits non-zero when any is an error.

## 4. Non-goals

- Indaba does not run an MCP client or a tool-calling loop for API-only models. That is a larger,
  separate feature.
- Indaba does not install, start, health-check or authenticate MCP servers; the agent does.
- No server discovery, no registry, no per-tool allow-listing in this version.
- No secret management: `env` values are literals the workflow author wrote. Secrets belong in the
  agent's own environment; the config file Indaba writes is private and short-lived.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| `required` and the runner cannot provide a server | the run is refused before the first step, naming step, runner and server |
| `optional` and the runner cannot provide a server | the step runs without it; `indaba.mcp.skipped` records the names |
| the runner is `agent_managed` | the step runs; `indaba.mcp.assumed` records the names |
| the temporary config file cannot be written | the step fails with a runner error; nothing runs unconfigured |
| the agent fails or times out | the temporary file is removed anyway |

## 6. Security and data handling

The workflow file is operator-authored, so `command` and `args` are trusted in the same way a shell
step's `commands` are. They reach the agent as an argument vector or a JSON/TOML value, never through
a shell. Values that can carry secrets (`env`, URLs with credentials) are kept out of every span,
event, exception message and log line. Server names are validated so they cannot inject TOML keys or
JSON structure. The temporary file is created with mode 0600 in the system temp directory and deleted
in a `finally`.

## 7. Where it lives

`Workflow\Model` holds the declarations (pure). `Runners` holds the capability interface, the request
field and the per-agent translation (infrastructure). `Workflow\Engine` holds the preflight and the
per-step resolution that join them.

## 8. Clarifications

- **Default policy is `required`**, configurable per step and per workflow (`defaults.mcp_policy`).
- `--strict-mcp-config` is on for Claude so the servers a step sees are exactly the declared ones,
  which keeps runs reproducible across machines. Not declaring `mcp` at all leaves Claude untouched.
- Cursor is `agent_managed` on the understanding that it reads its own MCP configuration; confirm in
  review against its documentation.
- Antigravity's MCP configuration lives in its own settings, so it is `agent_managed`.

## Artifacts not written

- `plan.md`: the design is small enough to be fully stated in this file and in `api-surface.md`.
- `tasks.md`: the work is one change, delivered in one pull request.
- `research.md`: the agent CLIs' MCP flags are cited in `api-surface.md` and confirmed in review.
- `data-model.md`: the value objects are listed in `api-surface.md`.
- `events.md`: no new event; three attributes on an existing span, listed in `api-surface.md`.
