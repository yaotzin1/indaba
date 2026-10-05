# Research: Transport priority

> Stage 2 artifact. Researched 2026-10-05. Everything under "Confirmed" was read from the protocol
> repository's schema files (`schema/v1/schema.json`, `schema/v1/meta.json`, `schema/v2/meta.json`)
> or an agent's own repository, not from summaries. Re-check before implementation: the protocol
> moves weekly (v1 was at 1.24.1 on 2026-09-30).

## Question 1: is the headless ACP subset small enough to hand-write?

**Yes, for v1.** Clarification 1 in spec.md (no SDK) holds.

### Confirmed

- **Transport.** JSON-RPC 2.0 over the agent subprocess's stdio. One message per line, terminated
  by `\n`, no embedded newlines. The agent must write nothing but ACP messages to stdout; stderr is
  free-form logging the client may capture. Shutdown is "close stdin, terminate the subprocess".
  HTTP streaming is a draft proposal only.
- **Version.** `protocolVersion` is an integer. Stable is **1** (schema 1.24.1). A **v2** schema
  exists as `2.0.0-alpha.7`.
- **Methods the runner needs (v1):**

  | Direction | Method | Use |
  | :--- | :--- | :--- |
  | client to agent | `initialize` | version and capability negotiation (`protocolVersion` required) |
  | client to agent | `session/new` | `cwd` (absolute) and `mcpServers` required |
  | client to agent | `session/prompt` | `sessionId`, `prompt` (content blocks); response carries `stopReason` |
  | client to agent | `session/cancel` | notification |
  | agent to client | `session/update` | notification, streamed output |
  | agent to client | `session/request_permission` | the permission gate |
  | agent to client | `fs/read_text_file`, `fs/write_text_file` | only if the client advertised them |
  | agent to client | `terminal/*` | only if advertised; Indaba advertises none |
  | client to agent | `authenticate` | only if the agent lists `authMethods` |

- **Wire values** (these are the strings on the wire, not type names):
  - `stopReason`: `end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`.
  - `session/update` discriminator `sessionUpdate`: `user_message_chunk`, `agent_message_chunk`,
    `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `available_commands_update`,
    `current_mode_update`, `config_option_update`, `session_info_update`, `usage_update`.
  - Tool call `kind`: `read`, `edit`, `delete`, `move`, `search`, `execute`, `think`, `fetch`,
    `switch_mode`, `other`. Tool call `status`: `pending`, `in_progress`, `completed`, `failed`.
  - Permission option `kind`: `allow_once`, `allow_always`, `reject_once`, `reject_always`.
  - Permission response: `{ outcome: { outcome: "cancelled" } }` or
    `{ outcome: { outcome: "selected", optionId } }`. There is no "deny" outcome: a denial is
    selecting a `reject_*` option the agent offered. If the agent offers none, answer `cancelled`.
  - Cancellation error code `-32800`.
- **Client capabilities.** `clientCapabilities.fs.readTextFile` and `writeTextFile` (booleans,
  default false) and `terminal` (boolean, default false). Omitted means the agent must not call them.

### Findings that change the spec

1. **Token usage is not reported the way Indaba accounts for it.** The only usage surface is the
   `usage_update` update: `used` and `size` (context window occupancy, in tokens) and an optional
   `cost` of `{ amount, currency }`. There is no input/output token split in v1. Mapping `used` to
   `gen_ai.usage.input_tokens` would be an invented number and breaks the "no invented numbers"
   rule. Decision: the ACP runner reports `cost` when present and leaves `TokenUsage` unset;
   `used`/`size` go on the span as ACP-specific attributes, not GenAI ones. This refines AC-06
   ("usage only when the agent reports it") and needs a line in api-surface.md.
2. **v2 removes the client file and terminal methods.** `schema/v2/meta.json` lists no
   `fs/*` or `terminal/*` client methods; v1 has them. If v2 ships as drafted, the "serve
   fs requests only inside scope" half of AC-12 cannot exist on v2: an agent edits files itself and
   the client sees only `tool_call` updates and permission requests. This makes AC-14
   (post-run `diff_within_scope` guard) the portable enforcement and the fs gate a v1-only
   optimisation. Decision: target v1; negotiate `protocolVersion: 1` and treat any other agreed
   version as a `RunnerError` (so the list falls back) until v2 is stable and specified.
3. **Permission gating works on `tool_call` kind, not only on paths.** A permission request carries
   the tool call (kind, locations). `permissions.fs.write` can be checked against `locations` for
   `edit`/`delete`/`move`, and `terminal: deny` maps to rejecting `execute`. Locations are
   optional and agent-supplied, so they are advisory; again AC-14 is the real check.
4. **`session/new` needs `mcpServers`.** Indaba already resolves MCP servers per speaker
   (`packages/engine/src/engine/mcp.ts`); the ACP runner passes the existing `RunRequest.mcpServers`
   through. No new engine work, but the entries need mapping to ACP's MCP server shape
   (stdio supported by every agent; http/sse only if `mcpCapabilities` says so).

## Question 2: which agents have a documented ACP command

### Confirmed from the agents' own repositories

| Agent | How it is launched | Source |
| :--- | :--- | :--- |
| Claude | `npx @agentclientprotocol/claude-agent-acp` (ACP adapter over the Claude Agent SDK, not the `claude` binary) | `agentclientprotocol/claude-agent-acp` README |
| Codex | `npx @agentclientprotocol/codex-acp` (adapter around the Codex CLI; the `zed-industries/codex-acp` repo points here for new installs) | `zed-industries/codex-acp` README |
| Gemini CLI | `gemini --acp` | `google-gemini/gemini-cli` `docs/cli/acp-mode.md` |

### Not confirmed (do not preset)

Cursor, GitHub Copilot, goose and Cline appear in the ACP agent registry, but the registry text
did not give a verifiable ACP launch command for them and I did not read their own docs. They get
no preset in this change; users can still run them through `command` + `args`.

### Consequences

- Presets: `claude`, `codex`, `gemini`, each expanding to a `command` + `args` array. The preset
  table is data in `packages/runners`, easy to extend. Clarification 2 closes this way.
- `npx` presets download code at run time. That is a supply-chain surface and an offline failure.
  The preset must be overridable with a pinned or locally installed command, the docs must say so,
  and a failed `npx` start (not found, no network) is a `RunnerError`, so fallback applies.
- The Claude preset uses the Agent SDK adapter, not the `claude-code` CLI runner. They are
  different code paths with different auth and behaviour; documentation must not call them the same
  thing.
- An agent that needs `authenticate` and has no stored credentials cannot run headless: that is
  a `RunnerError` ("agent requires interactive authentication"), not a failed task.

## Question 3: where do guards live today

`docs/workflow-format.md` documents one guard type, `git_diff_empty`. AC-14 (`diff_within_scope`)
is therefore a new guard type through the existing guard contract (see the `create-guard` skill).
Whether any other guard type exists in `packages/engine/src/guards` was not checked here; stage 3
must read that directory before naming it.

## Open after research

- Which `RunnerError` conditions can be distinguished reliably before the prompt is accepted
  (spec section 5): spawn failure, `initialize` failure and `authenticate` requirement are all
  before `session/prompt`; stage 3 should define the boundary as "the `session/prompt` request has
  been written to the agent's stdin".
- Whether `node-pty` is needed at all for ACP. It is not: the agent speaks over plain pipes, which
  is part of the point. The ACP runner uses `ProcessSpawner` with piped stdio and no PTY.
- The v1 `session/request_permission` flow for `allow_always` options: Indaba must never select
  them (a persisted grant outlives the step). Stage 3 records this as a rule.

## Sources

- Protocol schema and method tables: `agentclientprotocol/agent-client-protocol`, `schema/v1` and
  `schema/v2` (`schema.json`, `meta.json`, `CHANGELOG.md`).
- Protocol documentation: agentclientprotocol.com (overview, transports).
- Agent launch commands: the READMEs and docs named in the table above.
