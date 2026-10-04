# API surface contract: TypeScript port

> **Immutable during stage 6.** An implementation that finds this wrong stops and returns to stage 3.

## Semver classification

**major** (language change). The first published version is `0.1.0`; no prior consumer exists.

Reasoning: nothing was released, so there is no break to manage. The classification is recorded so the
changelog explains why the PHP API is gone.

## Packages and their public symbols

Every PHP symbol keeps its name unless listed under renames. All packages: ESM, `exports` map, types shipped.

### `@indaba/core` (pure domain, no dependencies, no `node:` imports)

| Name | Kind | Signature |
| :--- | :--- | :--- |
| `IndabaError`, `InvalidTransitionError`, `McpUnavailableError`, `RunnerError`, `WorkflowValidationError`, `WorkspaceError` | classes | `extends Error`, `name` set, `cause` supported; `WorkflowValidationError.problems: readonly string[]` |
| `WorkflowDefinition`, `StepDefinition`, `RoleDefinition`, `GuardDefinition`, `OnFailure`, `McpServerDefinition` | readonly types | same fields as PHP, camelCase |
| `DecisionType`, `FailureAction`, `GuardType`, `Isolation`, `McpPolicy`, `StepStatus`, `MessageType`, `ConsensusOutcome`, `SpanStatus` | const object + union | values identical to the PHP enum backing strings |
| `DagBuilder` | class | `build(def): readonly StepDefinition[]` (topological, ties by declaration order, cycle gives `WorkflowValidationError`) |
| `StepState`, `StepStatusChanged` | class, event | transitions validated; illegal gives `InvalidTransitionError` |
| `AgentMessage`, `Blackboard`, `ConsensusArbiter`, `ConsensusResult`, `PingPongDetector`, `Participant` | class/interface | `Participant.respond(topic, board, round): Promise<AgentMessage>` |
| `Runner` | interface | `readonly name: string; run(request: RunRequest, signal?: AbortSignal): Promise<RunResult>` |
| `RunRequest` | type | `{ prompt: string; workdir: string; model?: string; timeoutSeconds?: number /* 900 */; env?: Readonly<Record<string,string>>; onOutput?: (chunk: string) => void; mcpServers?: readonly McpServerDefinition[] }` |
| `RunResult` | class | `{ exitCode: number; output: string; errorOutput: string /* '' */; usage?: TokenUsage; durationMs: number /* 0 */; model?: string }`, `succeeded(): boolean`, `failureText(): string` |
| `TokenUsage`, `PricingTable`, `Span`, `Tracer`, `SpanStarted`, `SpanEnded` | classes | OpenTelemetry GenAI attribute names unchanged |
| `EventDispatcher`, `Clock`, `IdGenerator` | interfaces | `dispatch<E>(event: E): Promise<void>`; `Clock.now(): Date`; `IdGenerator.next(): string` |

### `@indaba/engine`

| Name | Kind | Signature |
| :--- | :--- | :--- |
| `parseWorkflow(source: string): WorkflowDefinition`, `WorkflowParser`, `WorkflowValidator`, `Interpolator`, `ErrorBag` | functions/classes | same messages as PHP |
| `Guard`, `GuardRegistry`, `GitDiffEmptyGuard`, `GuardResult` | interface/classes | `check(def: GuardDefinition, workdir: string): Promise<GuardResult>` |
| `WorkflowEngine`, `StepExecutor`, `PromptBuilder`, `McpPlanner`, `McpResolution`, `McpIssue`, `StepOutcome`, `WorkflowResult`, `WorkflowStatus` | classes | `WorkflowEngine.run(def, options?: { signal?: AbortSignal }): Promise<WorkflowResult>` |
| `Git`, `GitWorktree`, `GitWorktreeManager`, `PatchService`, `Workspace`, `WorkspaceManager` | classes/interface | `WorkspaceManager.create(taskId: string, variant?: string): Promise<Workspace>` |
| `JsonlSpanExporter`, `SystemClock`, `RandomIdGenerator`, `SimpleEventDispatcher` | classes | |

### `@indaba/runners`

| Name | Kind | Signature |
| :--- | :--- | :--- |
| `RunnerRegistry`, `ShellRunner`, `OpenRouterRunner`, `SseParser`, `CommandRunner` | classes | |
| `ClaudeRunner`, `CodexRunner`, `CursorRunner`, `AntigravityRunner`, `AbstractCliRunner`, `PreparedCommand` | classes | PTY through optional `node-pty`, piped fallback |
| `McpCapable`, `McpCapability`, `McpConfigWriter` | interface/types/class | |

### `indaba` (CLI package)

`bin: indaba`; also exports `main(argv: readonly string[], io?: Io): Promise<number>` and `createEngine(options)`.

## Public symbols changed / renamed

| PHP | TypeScript | Impact |
| :--- | :--- | :--- |
| `RunnerInterface`, `GuardInterface`, `ParticipantInterface` | `Runner`, `Guard`, `Participant` | none (new language) |
| `*Exception` | `*Error` | none |
| `RunRequest::$timeoutSeconds` (float) | `timeoutSeconds` (number) | none |
| PSR-14 dispatcher | `EventDispatcher` | none |

## Removed or deprecated

| Name | Replacement | Removed in |
| :--- | :--- | :--- |
| the whole PHP codebase, Composer, Docker toolchain | the packages above | this change |

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow schema | `version: "1.0"` and all fields | unchanged |
| CLI | `indaba run`, `plan`, `validate` and their options | unchanged |
| events | `StepStatusChanged`, `SpanStarted`, `SpanEnded` | unchanged names and payload fields |
| span attributes | `gen_ai.*` | unchanged |
| trace file | `.indaba/traces/*.jsonl` | unchanged shape |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| `RunRequest.timeoutSeconds` | 900.0 | 900 |
| all others | | unchanged |

## Checks

- [ ] Every type appearing in a public signature is exported
- [ ] Extension points are interfaces; implementations are not meant to be subclassed
- [ ] No `any`, no non-null assertion, no suppression comment
- [ ] `pnpm typecheck` passes
