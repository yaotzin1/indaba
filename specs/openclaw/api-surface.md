# API surface contract: OpenClaw runner

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An implementation that
> finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**minor** (the packages are below 1.0): one new exported class, one new runner name, one new permission note id.
No default changes: no existing workflow names a runner called `openclaw`, and the `acp` runner's presets are not
touched.

## Public symbols added

### `@indaba/runners`

```ts
export interface OpenClawRunnerOptions extends AcpRunnerOptions {}

/**
 * OpenClaw over its ACP bridge (`openclaw acp`). An `AcpRunner` with its own name, a fixed command, and the
 * capabilities the bridge really has: `read` and `edit` unsupported (it does not use the client's file and terminal
 * methods), `full` accepted, no MCP.
 */
export class OpenClawRunner extends AcpRunner {
  readonly name: 'openclaw';
  constructor(options?: OpenClawRunnerOptions);
  permissionCapabilities(): readonly PermissionCapability[];   // read, edit: unsupported ('no_client_methods'); full
  mcpCapability(): McpCapability;                              // McpCapability.None
  run(request: RunRequest, signal?: AbortSignal): Promise<RunResult>;
}
```

Changed (additive, no behaviour change for the `acp` runner): `AcpRunner.name` and `AcpRunner.description` are
declared `string` instead of the literals `'acp'`, so a subclass may name itself. `new AcpRunner().name` is still
`'acp'`.

### `@indaba/core`

`ReadinessProbe.isRunnerRegistered(type, preset?, command?)` gains an optional third argument: the command the author wrote for the first runner's agent (`agent: { command }`). A probe that ignores it keeps working. `runnerChainOf` returns it as the third member of each entry.

### `@indaba/engine`

Nothing exported. The program table of the readiness probe gains `openclaw: 'openclaw'`; for `openclaw` the probe looks for the first word of the written command when there is one, and lists `INDABA_ACP_PASS_ENV` names as for `acp`.

## Runner

| Name | Starts | Environment | Levels | MCP |
| :--- | :--- | :--- | :--- | :--- |
| `openclaw` | `openclaw acp` (or `agent.command`) | baseline, `OPENCLAW_*`, `INDABA_ACP_PASS_ENV` | `read`, `edit`: unsupported; `full`: accepted | none |

## Workflow fields

No new field. `agent: { command, auth }` on a role or step whose runner is `openclaw` is read (AC-04); `preset` is
ignored there.

## Permission notes

| Note id | Meaning (in the CLI and the page) |
| :--- | :--- |
| `no_client_methods` | its bridge does not use the file and terminal requests Indaba answers, so nothing would hold the step to this level |

## Defaults introduced or changed

- **None changed.** A workflow without `runner: openclaw` is untouched.
- **The catalog lists one more runner**, with `read` and `edit` unsupported and `full` accepted.
- **Not in the public surface:** the exact command (`openclaw acp`) and the `OPENCLAW_` prefix are constants of the
  runner; a person overrides the command with `agent.command`.

## Failure contract

| Call | Failure |
| :--- | :--- |
| `OpenClawRunner.run` | as `AcpRunner.run`: `RunnerUnavailableError` only before the prompt is written (the program is missing, another protocol version, a login is needed); afterwards every outcome is a result |
