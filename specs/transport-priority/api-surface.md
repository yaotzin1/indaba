# API surface contract: Transport priority

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**minor** (the packages are below 1.0, `0.1.0-alpha.0`).

Reasoning: every addition is optional or additive. Existing workflows parse and run unchanged,
with **one behaviour change** that would be a major after 1.0: a step that sets both `role` and
`runner` now uses the step's `runner` (today the role's wins, silently). It is listed under
"Defaults introduced or changed" and goes in the CHANGELOG under a "Changed" heading.

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core` `errors` | class | `RunnerUnavailableError extends RunnerError`; "nothing was sent to the agent" |
| `@indaba/core` `errors` | class | `RunnerChainExhaustedError extends RunnerError { readonly skipped: readonly SkippedRunner[] }` |
| `@indaba/core` `runner` | interface | `SkippedRunner { readonly runner: string; readonly reason: string }` |
| `@indaba/core` `runner` | function | `runnerChain(owner: RunnerChainOwner): readonly string[]` |
| `@indaba/core` `runner` | interface | `RunnerChainOwner { readonly runner: string; readonly fallbackRunners?: readonly string[] }` |
| `@indaba/core` `workflow/model` | interface | `StepPermissions { readonly fsRead: readonly string[]; readonly fsWrite: readonly string[]; readonly terminal: PermissionMode }` |
| `@indaba/core` `workflow/model` | const + type | `PermissionMode = { Allow: 'allow', Deny: 'deny' }` |
| `@indaba/core` `workflow/model` | const | `GuardType.DiffWithinScope = 'diff_within_scope'` |
| `@indaba/core` `workflow/model` | interface | `AgentSpec { readonly preset?: string; readonly command?: readonly string[] }` |
| `@indaba/core` `support/glob` | function | `matchesGlob(pattern: string, path: string): boolean` |
| `@indaba/core` `support/glob` | function | `matchesAny(patterns: readonly string[], path: string): boolean` |
| `@indaba/core` `observability` | method | `Span.addEvent(name: string, attributes?: Readonly<Record<string, SpanAttributeValue>>): void` |
| `@indaba/core` `observability` | interface | `SpanEvent { readonly name: string; readonly attributes: Readonly<Record<string, SpanAttributeValue>> }`, and `Span.events: readonly SpanEvent[]` |
| `@indaba/engine` `guard` | class | `DiffWithinScopeGuard implements Guard` (`type` is `diff_within_scope`) |
| `@indaba/engine` `engine` | functions | `planForStep(step, workflow)`, `planForRole(workflow, roleName)`, `effectiveGuards(step)`; interface `RunnerPlan { names; model; agent }` |
| `@indaba/engine` `parser` | method | `WorkflowValidator.warnings(workflow): string[]` |
| `@indaba/engine` `engine` | method | `McpPlanner.chains(workflow, step)`; preflight now judges a speaker by the first runner of its chain that can provide the required servers |
| `@indaba/runners` | class | `OpenAiCompatibleRunner implements Runner`, constructor `{ name; baseUrl; apiKeyEnv; defaultModel?; extraHeaders?; fetch? }` |
| `@indaba/runners` | class | `AcpRunner implements Runner` (`name` is `acp`), constructor `{ spawner?: StreamingProcessSpawner; presets?: Readonly<Record<string, AcpAgentPreset>>; env?: Readonly<Record<string, string>> }` |
| `@indaba/runners` | interface | `AcpAgentPreset { readonly command: readonly string[] }` |
| `@indaba/runners` | const | `ACP_AGENT_PRESETS: Readonly<Record<'claude' \| 'codex' \| 'gemini', AcpAgentPreset>>` |
| `@indaba/runners` | interface | `StreamingProcessSpawner { start(spec: StreamingProcessSpec, signal?: AbortSignal): Promise<ProcessSession> }` |
| `@indaba/runners` | interface | `ProcessSession { write(line: string): Promise<void>; readonly lines: AsyncIterable<string>; readonly stderr: AsyncIterable<string>; readonly exited: Promise<number>; kill(): Promise<void> }` |
| `@indaba/runners` | class | `NodeStreamingProcessSpawner implements StreamingProcessSpawner` |

`AcpConnection` (JSON-RPC layer) is **internal**: not exported from the package index.

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `RoleDefinition` | `{ name; runner; model?; mcp }` | adds `fallbackRunners?: readonly string[]`, `agent?: AgentSpec` | additive |
| `StepDefinition` | `{ ...; runner?; ... }` | adds `fallbackRunners?: readonly string[]`, `agent?: AgentSpec`, `permissions?: StepPermissions` | additive |
| `RunRequest` | no permissions | adds `permissions?: StepPermissions` and `agent?: AgentSpec`; runners that cannot honour them ignore them | additive; runners are not required to enforce |
| `RunResult` / `RunResultInit` | no cost | adds optional `reportedCostUsd?: number` | additive |
| `GuardRegistry.withDefaults()` | registers `git_diff_empty` | also registers `diff_within_scope` | additive |
| `WorkflowParser` constructor | `(guards?, validator?)` | `(guards?, validator?, runners?: { has(name: string): boolean })` | additive; absent means run-time check as today |
| `RunnerRegistry.withDefaults` | registers `openrouter` as `OpenRouterRunner` | registers it as an `OpenAiCompatibleRunner` preset, plus `acp` | `OpenRouterRunner` stays exported and behaves identically |
| process, registry, MCP "cannot start" sites | throw `RunnerError` | throw `RunnerUnavailableError` (a subclass) | `instanceof RunnerError` still true |
| `StepExecutor` runner choice | role's runner beats step's | step's runner beats role's | see Defaults |

## Removed or deprecated

| Name | Replacement | Removed in |
| :--- | :--- | :--- |
| none | | |

`OpenRouterRunner` is kept (it is a thin subclass of `OpenAiCompatibleRunner`), not deprecated.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow | `roles.<role>.runner`, `steps.<step>.runner` | accepts a string or a non-empty list of strings; first is primary, the rest are fallbacks |
| workflow | `roles.<role>.agent`, `steps.<step>.agent` | new; a preset name (`claude`, `codex`, `gemini`) or `{ command: [..] }`; meaningful only to the `acp` runner |
| workflow | `steps.<step>.permissions.fs.read`, `.fs.write` | new; list of globs |
| workflow | `steps.<step>.permissions.terminal` | new; `allow` or `deny`, default `deny` when `permissions` is present |
| workflow | guard `type: diff_within_scope` | new; `paths` are the allowed globs (empty means nothing may change); implied by any `permissions` block, with `fs.write` as its globs |
| validate | errors | empty runner list; duplicate name within one list; unknown runner name when a lookup is given; `permissions` on a step with no ACP runner in its chain is a **warning** |
| validate | warnings | `permissions.fs.write` with `isolation: none`; step and role both set `runner` and differ |
| CLI | `indaba plan` | prints each step's runner chain and effective guards |
| span attribute | `indaba.runner` | unchanged; on the step's invoke span it is the runner that ran |
| span event | `indaba.runner.skipped` | new; attributes `indaba.runner`, `indaba.runner.skip_reason` (redacted, bounded) |
| span event | `indaba.acp.tool_call` | new; attributes `acp.tool.kind`, `acp.tool.status` (no titles, no paths, no content) |
| span event | `indaba.acp.permission` | new; attributes `acp.tool.kind`, `acp.permission.decision` (`allowed` or `rejected`) |
| span attribute | `indaba.acp.protocol_version`, `indaba.acp.context_used`, `indaba.acp.context_size` | new; integers |
| span attribute | `indaba.cost.usd` | now also set from `RunResult.reportedCostUsd` when the runner reports it; never computed from ACP context numbers |
| environment | `INDABA_OPENAI_COMPAT_<NAME>_BASE_URL`, `_KEY_ENV`, `_MODEL` | new; read only in the CLI composition root |

The JSONL span file gains an `events` array on a span when it has events; a span without events is
written exactly as before.

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| runner chosen when a step sets both `role` and `runner` | the role's runner | the step's runner (the role's `model` still applies) |
| a `permissions` block with no `terminal` key | n/a | `deny` |
| an ACP `edit`, `delete`, `move` or `execute` request with no `permissions` block | n/a | rejected |
| a runner list | n/a | no fallback unless a list is written |
| any default runner or transport | none | none; no CLI runner is ever selected implicitly |

## Checks

- [ ] Every type appearing in a new public signature is itself public (or deliberately marked `@internal` and not re-exported from the package index): `AgentSpec`, `StepPermissions`, `SkippedRunner`, `ProcessSession`, `StreamingProcessSpec` are exported; `AcpConnection` is not
- [ ] Implementations are not exported for subclassing; the extension point is an interface (`Runner`, `Guard`, `StreamingProcessSpawner`); `OpenRouterRunner` extending `OpenAiCompatibleRunner` is the one deliberate exception, kept for compatibility
- [ ] Collections are typed precisely and read-only where they are not mutated (`readonly T[]`, `Readonly<Record<string, V>>`)
- [ ] `pnpm qa` (Biome, `tsc` strict, Vitest) passes with no suppression comment
- [ ] `@indaba/core` still imports no `node:` module (`glob`, `runnerChain` and the error classes are pure)
- [ ] A plugin runner can throw `RunnerUnavailableError` and take part in a chain without an engine change
