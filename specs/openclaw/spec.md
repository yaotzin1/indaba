# Specification: OpenClaw runner

> **Status**: Accepted. The maintainer asked for OpenClaw support on 2026-11-21 and decided the two open questions
> (section 8, C-02 and C-03).
> **Stage entry**: 3
> **Semver impact**: minor (a new runner name, a new permission note id; below 1.0). Nothing existing changes.
> **Builds on**: [`specs/transport-priority`](../transport-priority/spec.md) (the `acp` runner),
> [`specs/agent-permissions`](../agent-permissions/spec.md) (what a level means for a runner) and
> [`specs/mcp-support`](../mcp-support/spec.md) (what MCP a runner offers).

---

## 1. The problem

OpenClaw is an open-source personal assistant that runs on the person's machine as a Gateway and can act through
many channels. Its documentation says it speaks the Agent Client Protocol: `openclaw acp` is an ACP server over
stdio that forwards each prompt to the Gateway over a WebSocket and maps each ACP session to a Gateway session
(source: docs.openclaw.ai/cli/acp, read 2026-11-21; the flags are the documented ones and are not yet exercised, as
OpenClaw is not installed on the development machine).

A workflow author can reach it today only by writing `agent: { command: [openclaw, acp] }` by hand on an `acp`
role, knowing which variables to let through for the Gateway token, and with no sign that two things Indaba
promises an ACP agent do not hold for this one:

- the bridge **does not use the client's file and terminal methods** (`fs/read_text_file`, `fs/write_text_file`,
  `terminal/*`), which are how Indaba holds an ACP agent to a step's `permissions`; OpenClaw runs its own tools;
- the bridge **rejects per-session MCP servers**: `mcpServers` in `session/new` is an error.

So an `acp` role on OpenClaw would claim `read` and `edit` are enforced and would pass MCP servers that fail at run
time. What is wanted: OpenClaw as a runner a role can name, honest about both.

## 2. User stories

- **US-01.** As a workflow author, I write `runner: openclaw` on a role (or step) and the step runs through the
  OpenClaw Gateway on this machine, with the same events, cancel and timeout as any ACP agent.
- **US-02.** As a workflow author, I can list it in a fallback chain (`runner: [openclaw, claude-code]`).
- **US-03.** As a person running `indaba validate` or `plan`, I am told before anything runs that a step on OpenClaw
  cannot be held to `read` or `edit`, and that OpenClaw takes no MCP servers from the workflow.
- **US-04.** As a person without OpenClaw installed, `plan` and `run` say the `openclaw` program is not on the
  `PATH`, in the readiness report, before the run.
- **US-05.** As a person on Windows, I am told what to do about the npm shim, and can point the role at a native
  executable.

## 3. Acceptance criteria

- [ ] AC-01. `RunnerRegistry.withDefaults` registers a runner named `openclaw` with a plain-words description. A role
  or step names it with `runner: openclaw`, alone or in a fallback list.
- [ ] AC-02. It starts `openclaw acp` as an argument array (never through a shell) and speaks ACP over its stdio
  exactly as the `acp` runner does: the same events, the same cancel and timeout, the same answers to the
  permission requests the agent relays, the same login handling.
- [ ] AC-03. Of the host environment only the baseline and the variables whose name starts with `OPENCLAW_` reach it
  (the Gateway token and password are `OPENCLAW_GATEWAY_TOKEN` and `OPENCLAW_GATEWAY_PASSWORD`), and what
  `INDABA_ACP_PASS_ENV` adds. No other credential does.
- [ ] AC-04. A role's or step's `agent: { command: [program, args...] }` replaces the command (for a native
  executable on Windows, or a pinned copy); `agent: { auth: <id> }` is passed on. Any `preset` is ignored.
- [ ] AC-05. Permission levels: `read` and `edit` are **unsupported** for this runner, with the note
  `no_client_methods`; `full` is accepted (Indaba's gate answers the approvals OpenClaw relays and allows all, and
  holds no limit). A step on it that writes `read` or `edit` is an error in `validate`, `plan` and at the start of a
  run, as for any runner that cannot honour a level; with no level written the existing "default" fact is printed.
  The catalog (`indaba catalog`, the page) shows the three levels.
- [ ] AC-06. MCP: the runner declares no MCP capability. A step whose role or step names MCP servers with the
  policy `required` is an error in `validate` and `plan` (the existing message), and with `optional` the servers are
  skipped with the existing warning. The workflow's servers are never sent to the bridge.
- [ ] AC-07. Readiness: the program `openclaw` is looked for on the `PATH` (and the Windows npm shim is reported as
  it is for the other agent CLIs), or, when the role or step writes `agent: { command }`, the first word of that
  command (a file, or a program on the `PATH`). `INDABA_ACP_PASS_ENV` names are listed as for `acp`. The Gateway is
  **not** checked: Indaba does not open the Gateway's socket.
- [ ] AC-08. The `acp` runner does not gain an `openclaw` preset: `agent: openclaw` on an `acp` role stays an
  unknown preset, because it would bypass AC-05 and AC-06. The message lists the presets as before.
- [ ] AC-09. The workflow schema, `docs/getting-started.md`, `docs/workflow-format.md`, `docs/using-the-alpha.md`,
  the README runner list and the CHANGELOG name the runner and its two limits.
- [ ] AC-10. No dependency is added; `architecture.test.ts` and the layers tests stay green; coverage holds.

## 4. Non-goals

- Starting, stopping or installing the OpenClaw Gateway, or checking that it is running or reachable.
- Choosing the OpenClaw agent or session: the bridge routes by Gateway session key, and the default is a fresh
  disposable one per run. Indaba passes none of `--session`, `--session-label`, `--reset-session`, `--url` or
  `--token`; a person who needs them writes `agent: { command: [openclaw, acp, --session, <key>] }` (AC-04), and puts
  the token in the environment, not on the command line.
- Holding an OpenClaw agent to `read` or `edit` by other means (AC-05: refused, not approximated).
- MCP servers from the workflow (AC-06): the person configures them in OpenClaw itself.
- Reading OpenClaw's own session, usage or cost records. The span carries no cost for it.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| `openclaw` is not on the `PATH` | the readiness item says so, with how to install it; the run starts and the step ends as any unavailable runner does, and a fallback list moves on |
| the Gateway is not running or the token is wrong | the bridge exits or answers with an error; it is the step's failure, with the agent's own words (redacted), never a hang beyond the step's timeout |
| `read` or `edit` written on a step | an error before anything runs (AC-05) |
| MCP servers named, policy `required` | an error before anything runs (AC-06) |
| the bridge answers `session/new` with an error | the step fails with that error text, as for any ACP agent |
| `agent: { preset: ... }` on a role with `runner: openclaw` | ignored |

## 6. Security and data handling

- The command is an argument array; a `command` the author writes is the author's, as for the `acp` runner.
- The environment is the baseline plus `OPENCLAW_*` and `INDABA_ACP_PASS_ENV`: the Gateway token never has to be on a
  command line (it would be visible in the process list), and no unrelated key reaches the agent.
- OpenClaw acts with its own tools and its own approvals, outside the step's working directory limits (AC-05 says
  Indaba cannot hold it). The scope guard of a step in a worktree (`diff_within_scope`) still checks the diff after the
  step, as for every runner. A step on OpenClaw should be isolated (`isolation: git_worktree`) when the work is to be
  checked.
- Output and errors are redacted like any ACP agent's; nothing here logs a prompt or a token.

## 7. Where it lives

| Part | Package |
| :--- | :--- |
| `OpenClawRunner`: an `AcpRunner` with its own name, a fixed command and the capabilities of AC-05 and AC-06 | `@indaba/runners` |
| registration in `withDefaults` | `@indaba/runners` |
| the program name for readiness | `@indaba/engine` |
| the words of the note `no_client_methods` | `indaba` (CLI), `@indaba/web` |

## 8. Clarifications

- **C-01. A runner, not a preset.** Permission and MCP capabilities belong to a runner in this codebase
  (`permissionCapabilities`, `mcpCapability`), and a preset is configuration of the one `acp` runner. A preset could
  not say "`read` is unsupported" without teaching the engine about presets. A subclass of `AcpRunner` registered as
  `openclaw` gets validation, planning, the catalog and readiness with no special case. Rejected: a preset plus
  per-preset capability plumbing through `checkPermissions` and `McpPlanner`.
- **C-02. `read` and `edit` are refused** (decided by the maintainer, 2026-11-21). Rejected: a warning only (a `read`
  step could write), and treating it like any ACP agent (claims an enforcement that does not exist).
- **C-03. MCP is refused at `validate` and `plan`** (decided by the maintainer, 2026-11-21), through the existing
  planner by declaring no capability. Rejected: a failure at run time with OpenClaw's own error.
- **C-04. `full` is accepted** because it asks for no limit; the gate allows every approval the bridge relays, and
  the note says so. With **no level written** the gate behaves as it does for every ACP agent: approvals the bridge
  relays for edits, deletions, moves and commands are rejected (nothing allows them), and reads and searches are
  allowed. An OpenClaw step that is to change files or run commands is therefore written at `full`.
- **C-05. No `openclaw` key in `ACP_AGENT_PRESETS`** (AC-08), so there is one way to start it and that way is honest.
- **C-06. The Gateway is not probed.** A WebSocket handshake is a network call to a service Indaba does not own and
  a thing the readiness spec (C-04 of `run-readiness`) keeps out; the failure is reported when it happens.

## Artifacts not written

- `data-model.md`: nothing is stored and no file format changes; the runner holds no state of its own.
- `research.md`: the choices and the rejected alternatives are in section 8; the one external source (OpenClaw's ACP
  documentation) is named in section 1.
- `events.md`: no event, span attribute or record is added; the runner emits the events of the `acp` runner it is built on.
