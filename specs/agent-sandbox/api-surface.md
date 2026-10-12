# API surface contract: Running agents in a container or a virtual machine

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.
>
> Builds on `Runner`, `RunRequest` and `PluginHost` of `@indaba/core`, and on `ProcessSpawner` of `@indaba/runners`.

## Semver classification

**Minor (below 1.0). Everything is additive.**

| Change | Class |
| :--- | :--- |
| `SandboxKind`, `SandboxSpec`, `SandboxPolicy`, `SandboxBackend`, `PreparedLaunch`, `SandboxStatus`, `SandboxUnavailableError` as new exports | minor |
| `RunRequest` gains the optional `sandbox` | minor: a runner that ignores it is still valid, and C-06 of `spec.md` makes the engine refuse it for a sandboxed step rather than run it unprotected |
| `Runner` gains the optional `execution` and `supportsSandbox` | minor |
| `PluginHost` gains `registerSandbox` | minor for a caller; a class that **implements** `PluginHost` needs the new method, so it is a major for such implementers. Only the engine implements it, and the changelog says so |
| `WorkflowDefinition` and `StepDefinition` gain the optional `sandbox` | minor |
| the engine options gain `sandboxPolicy` | minor |
| new CLI group `indaba sandbox doctor`, `setup`, `clean`; new span attributes; new events | minor |
| the default of `sandbox` (absent means `none`) | no change in behaviour |

## Public symbols added

### `@indaba/core` (pure; no `node:` import, no I/O)

```ts
export const SandboxKind = { None: 'none', Container: 'container', Vm: 'vm' } as const;
export type SandboxKind = (typeof SandboxKind)[keyof typeof SandboxKind] | (string & {}); // plugins add kinds

export type SandboxNetwork = 'none' | 'agent_api' | 'full';

export interface SandboxSpec {
  readonly kind: SandboxKind;
  readonly network: SandboxNetwork;      // default 'none'
  readonly cpus?: number;
  readonly memoryMb?: number;
  readonly pids?: number;
  readonly timeoutSeconds?: number;
  readonly image?: string;               // an escape hatch; Indaba installs nothing into it
  readonly env: readonly string[];       // NAMES only; a value never appears in a SandboxSpec
  readonly mounts: readonly string[];    // absolute host folders, mounted read-only
}

export interface SandboxPolicy {
  readonly allowedKinds?: readonly SandboxKind[];
  readonly minimum?: SandboxKind;        // order: none < container < vm
  readonly forbidNetwork?: readonly SandboxNetwork[];
  readonly forbidHostMounts?: boolean;
}

/** What a runner would have started on the host. */
export interface SandboxLaunch {
  readonly command: readonly string[];   // program and arguments; never a shell string
  readonly workspace: string;            // absolute host path of the step's working copy
  readonly cwd: string;                  // inside workspace
  readonly env: Readonly<Record<string, string>>; // only the names the spec allows; values stay in memory
  readonly agents: readonly string[];    // ids of the agent programs the image must contain
  readonly name: string;                 // the run/step/attempt name, already checked
  readonly usePty: boolean;
}

/** The same launch, expressed as something the host can start. */
export interface PreparedLaunch {
  readonly command: readonly string[];   // for example ['docker', 'run', '--rm', '--name', ...]
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>; // for the CLIENT; values for the sandbox are passed by name
  readonly imageDigest?: string;
  readonly terminate: () => Promise<void>; // stops the thing by name; idempotent
  readonly cleanup: () => Promise<void>;   // removes everything this launch created; idempotent; ignores abort
}

export interface SandboxStatus {
  readonly available: boolean;
  readonly backend: string;
  readonly detail: string;               // plain words
  readonly nextAction?: string;          // the one thing to do, plain words
}

export interface SandboxBackend {
  readonly kind: SandboxKind;
  readonly name: string;                 // 'docker', 'podman', ...
  check(spec: SandboxSpec): Promise<SandboxStatus>;
  prepare(spec: SandboxSpec, launch: SandboxLaunch, signal?: AbortSignal): Promise<PreparedLaunch>;
  /** Removes leftovers whose run is gone; returns how many. */
  sweep(isLive: (runId: string) => boolean): Promise<number>;
}

export class SandboxUnavailableError extends Error {
  readonly status: SandboxStatus;
}

export interface Runner {
  // ... existing members unchanged
  /** 'host': starts local processes. 'remote': makes HTTP calls only. Absent is read as 'host'. */
  readonly execution?: 'host' | 'remote';
  /** True when the runner passes `RunRequest.sandbox` to a backend. Absent is read as false. */
  readonly supportsSandbox?: boolean;
}

export interface RunRequest {
  // ... existing members unchanged
  readonly sandbox?: SandboxSpec;        // the resolved spec; absent means the host
}

export interface PluginHost {
  // ... existing members unchanged
  registerSandbox(backend: SandboxBackend): void;
}
```

### `@indaba/engine`

- `WorkflowEngineOptions.sandboxPolicy?: SandboxPolicy`.
- `resolveSandbox(workflow, step, policy): SandboxSpec` (pure; validation errors name the field).
- `sweepSandboxes(backends, liveRuns)`, run at the start of every run.

### `indaba` (CLI)

- `ContainerSandboxBackend` (Docker and Podman), `SandboxImageBuilder` (definition, digest, cache), `EgressProxy`.
- Commands: `indaba sandbox doctor [--json]`, `indaba sandbox setup [--yes]`, `indaba sandbox clean [--credentials]`.
- Configuration keys: `sandbox.engine` (`auto`, `docker`, `podman`), `sandbox.auto_setup` (bool, default false),
  `sandbox.policy` (as `SandboxPolicy`).

## Workflow format

```yaml
sandbox:                       # default for every step; absent means none
  kind: container
  network: agent_api
  memory_mb: 4096
  env: [OPENROUTER_API_KEY]    # names only
steps:
  - id: build
    runner: claude
    sandbox: { network: none }   # per-step override of the default
  - id: lint
    runner: shell
    sandbox: { kind: none }      # runs on the host (refused if the policy forbids it)
```

## Events and span attributes

| Name | Where | Carries |
| :--- | :--- | :--- |
| `indaba.sandbox.kind`, `.backend`, `.image_digest`, `.network` | step span attributes | strings; never a value from `env` |
| `indaba.sandbox.cpus`, `.memory_mb`, `.pids` | step span attributes | numbers when set |
| `sandbox.image.build` | event | definition hash, size when known, duration; no secret |
| `sandbox.start`, `sandbox.stop` | event | container name, backend, exit class (`ok`, `timeout`, `oom`, `pids`, `aborted`) |
| `sandbox.cleanup` | event | count removed |

## State on disk

- `.indaba/sandbox/images.json`: the image cache index (definition hash to digest and size). A cache, not a record.
- A per-agent credentials volume owned by the engine, named `indaba-cred-<agent>`.

Neither is read by guards, and neither holds a secret value other than what a runner's own login flow stores in the volume.
