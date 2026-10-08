# API surface contract: OpenCode integration

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**minor**

Reasoning: a new runner name, a new preset name and a new exported class. Nothing existing changes
behaviour; no default changes.

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/runners`, `OpenCodeRunner` | class | `implements Runner, McpCapable`; `name = 'opencode'`; `constructor(options?: OpenCodeRunnerOptions)` |
| `@indaba/runners`, `OpenCodeRunnerOptions` | interface | `extends CliRunnerOptions { binary?: string; extraArgs?: readonly string[] }` |

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `ACP_AGENT_PRESETS` | `Record<'claude' \| 'codex' \| 'gemini', AcpAgentPreset>` | adds the key `'opencode'` | minor: a wider key union; code that exhaustively switches on the three keys would need a case |

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow `agent` (acp) | `opencode` | new preset name, starts `opencode acp` |
| workflow `runner` | `opencode` | new runner name, `opencode run` |
| CLI, events, span attributes | none | unchanged |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| none | | |

## Checks

- [ ] Every type appearing in a new public signature is itself public
- [ ] Implementations are not exported for subclassing; the extension point is an interface
- [ ] Collections are typed precisely and read-only where they are not mutated
- [ ] `pnpm qa` passes with no suppression comment
