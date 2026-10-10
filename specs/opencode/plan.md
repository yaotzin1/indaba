# Plan: OpenCode integration

## Modules touched

| File | Change |
| :--- | :--- |
| `packages/runners/src/acp-runner.ts` | add the `opencode` preset (`opencode acp`, six env prefixes); widen the preset key type |
| `packages/runners/src/opencode-runner.ts` | new: `OpenCodeRunner extends AbstractCliRunner`, `opencode run --model <m> <prompt>` |
| `packages/runners/src/registry.ts` | register `opencode` in `withDefaults`; update the doc comment |
| `packages/runners/src/index.ts` | export `OpenCodeRunner` and its options |
| `packages/runners/test/` | preset, runner command and registry tests, all with fakes |
| `docs/getting-started.md`, `docs/workflow-format.md` | runner tables and one snippet per transport |
| `CHANGELOG.md`, `README.md`, `specs/DEPENDENCY_MAP.md` | Added entry; runner lists |

## Where the behaviour lives

Runner layer only (`@indaba/runners`). No domain, engine, parser or CLI change: the parser already
accepts any preset name and any runner name, and the registry is the single registration point.

## Trade-offs taken

- **Preset as data, not a class.** The ACP runner already does handshake, permissions and teardown, so
  OpenCode costs a few lines. Cost: it inherits whatever ACP behaviour OpenCode has.
- **CLI runner without MCP injection.** OpenCode reads MCP servers from its own configuration, so the
  runner reports `McpCapability.AgentManaged` like `AntigravityRunner`. Cost: workflow `mcp_servers`
  are not injected into it.
- **No `INDABA_OPENCODE_CMD` override.** `extraArgs` and `binary` options cover tests and embedders;
  an environment template can be added when someone asks.
- **Role `model` not forwarded over ACP** until a real run shows where OpenCode takes it.

## Risks

| Risk | Mitigation |
| :--- | :--- |
| the documented flags differ from the installed OpenCode | tests use a fake spawner; a manual run is listed in review.md as not yet done |
| `opencode` is an npm `.cmd` shim on Windows | the docs point `agent.command` / `binary` at the native executable |
| six env prefixes widen what an agent sees | they are the provider keys the other presets already allow, plus two |

## Out of scope for this change

`opencode serve`, `--attach`, installing OpenCode, usage and cost from `opencode stats`.
