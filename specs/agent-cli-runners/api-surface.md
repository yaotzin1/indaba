# API surface contract: More agent CLI runners

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

> **Status**: provisional, written at stage 1. Stage 3 confirms or corrects it after C-01.

## Semver classification

**minor** (below 1.0).

Reasoning: new runner names and, where a CLI speaks ACP, new preset keys. No contract in `@indaba/core` changes. The type of
`ACP_AGENT_PRESETS` is a record over a string-literal union of preset names; adding members is a minor below 1.0 and the
changelog says so (dependency map, "what breaks what").

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/runners` `CopilotRunner` | class | `implements Runner, McpCapable`; name `copilot` (or an ACP preset, per C-01) |
| `@indaba/runners` `JunieRunner` | class | name `junie` (or an ACP preset) |
| `@indaba/runners` `KimiRunner` | class | name `kimi` (or an ACP preset) |
| `@indaba/runners` `OmpRunner` | class | name `omp` (or an ACP preset) |
| `@indaba/runners` `ACP_AGENT_PRESETS` | constant | gains one key per CLI that documents ACP |

Each of the four is a class or a preset, not both; the final choice is recorded in `research.md`.

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `ACP_AGENT_PRESETS` key union | `claude \| codex \| gemini \| opencode` | adds the new keys | exhaustive switches need a case |

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| agent names | `copilot`, `junie`, `kimi`, `omp` | accepted by the parser and `diagnose` |
| `indaba catalog` | the runner list | four more entries with their capabilities |
| span attributes and events | none | unchanged |

## Defaults introduced or changed

None.
