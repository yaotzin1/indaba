# API surface contract: host process and workspace containment

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**major in 1.x; next `0.x` minor in alpha (with a labelled breaking-change note in `CHANGELOG.md`)**

Reasoning (per `api_surface` skill):

- Changing a default behaviour (filtering `process.env` in CLI and shell runners instead of inheriting all of `process.env`, redirecting `TEMP`/`TMP`/`TMPDIR` to `<workdir>/.indaba/tmp`, adding `--disallowedTools Task` by default to `ClaudeRunner`, and failing isolated worktree steps that mutate `refs/heads/*` or `refs/tags/*`) is classified as a **major**.
- Below `1.0` (alpha state), a major takes the next `0.x` minor and states the before/after in `CHANGELOG.md`.
- All TypeScript signature changes are additive and optional (`CliRunnerOptions.passEnv`, `CliRunnerOptions.env`, `ClaudeRunnerOptions.allowSubagents`, `ShellRunnerOptions.passEnv`, `ShellRunnerOptions.env`, `RestorableWorkspace.verifyRefs`), so existing TypeScript consumers keep compiling without code changes.

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/runners`, `env` (re-exported from index) | const | `BASELINE_ENV_NAMES: ReadonlySet<string>` |
| `@indaba/runners`, `env` (re-exported from index) | interface | `interface RunnerEnvOptions { readonly source?: Readonly<Record<string, string | undefined>>; readonly prefixes?: readonly string[]; readonly passEnv?: readonly string[]; readonly additions?: Readonly<Record<string, string>>; readonly tempDir?: string }` |
| `@indaba/runners`, `env` (re-exported from index) | function | `function buildRunnerEnvironment(options: RunnerEnvOptions): Record<string, string>` |
| `@indaba/engine`, `workspace` | interface member | `RestorableWorkspace.verifyRefs?(checkpoint: WorkspaceCheckpoint): Promise<readonly string[]>` — returns the list of modified/added/deleted ref names under `refs/heads/` and `refs/tags/` since `checkpoint` (empty when untouched). Optional on `RestorableWorkspace` so third-party implementations keep compiling. |

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `CliRunnerOptions` (`@indaba/runners`) | `{ readonly usePty?: boolean; readonly spawner?: ProcessSpawner }` | adds `readonly env?: Readonly<Record<string, string | undefined>>; readonly passEnv?: readonly string[]` | additive, optional |
| `ClaudeRunnerOptions` (`@indaba/runners`) | `{ readonly binary?: string; readonly extraArgs?: readonly string[]; readonly reportUsage?: boolean }` | adds `readonly allowSubagents?: boolean` (default `false`) | additive, optional; default command line gains `--disallowedTools Task` unless `allowSubagents: true` or `extraArgs` already sets `--disallowedTools` / `--allowedTools` |
| `ShellRunnerOptions` (`@indaba/runners`) | `{ readonly spawner?: ProcessSpawner }` | adds `readonly env?: Readonly<Record<string, string | undefined>>; readonly passEnv?: readonly string[]` | additive, optional |
| `GitWorktree.checkpoint` / `restore` (`@indaba/engine`) | records and restores `{ head, tree }` | records `{ head, tree, refs }` and restores `refs/heads/*` and `refs/tags/*` alongside `head` and `tree`; implements `verifyRefs(checkpoint)` | behavioural hardening on shared repository refs; `WorkspaceCheckpoint` type (`Readonly<Record<string, string>>`) is unchanged |

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| Child process `TEMP`, `TMP`, `TMPDIR` | all process runners (`AbstractCliRunner`, `ShellRunner`, `AcpRunner`) | Default changed from host's `TEMP`/`TMP`/`TMPDIR` to `<workdir>/.indaba/tmp`, created before the process runs and deleted in `finally` when the call ends. |
| Child process environment | `AbstractCliRunner`, `ShellRunner` | Default changed from all of `process.env` to `buildRunnerEnvironment` (`BASELINE_ENV_NAMES` + runner `envPrefixes` + `passEnv` + `request.env`). |
| `claude-code` command line | `ClaudeRunner` | Adds `--disallowedTools Task` by default so concurrency is controlled solely by Indaba's `maxParallelSteps`. |
| Isolated step validation | `WorkflowEngine` / `StepExecutor` | When an isolated step's workspace implements `verifyRefs`, any mutation of `refs/heads/*` or `refs/tags/*` rolls back the refs to the pre-step checkpoint and fails the step. |

## Defaults introduced or changed

| Option / Behaviour | Old default | New default |
| :--- | :--- | :--- |
| `TEMP` / `TMP` / `TMPDIR` in child processes | inherited from host `process.env` (e.g. `C:\Users\...\AppData\Local\Temp`) | `<workdir>/.indaba/tmp` on the workspace drive, wiped after each process call |
| Environment inherited by CLI & shell runners | full `process.env` | allowlist only (`BASELINE_ENV_NAMES` + provider `envPrefixes` + `passEnv` + `request.env`) |
| `ClaudeRunnerOptions.allowSubagents` | implicitly `true` (no `--disallowedTools` flag passed) | `false` (passes `--disallowedTools Task` unless `allowSubagents: true` or tool flags are in `extraArgs`) |
| `refs/heads/*` and `refs/tags/*` during an isolated worktree step | unchecked | snapshotted in `checkpoint()`, verified after the step, and restored on tampering or retry |

## Checks

- [x] Every type appearing in a new public signature is itself public (or deliberately marked `@internal` and not re-exported from the package index)
- [x] Implementations are not exported for subclassing; the extension point is an interface
- [x] Collections are typed precisely and read-only where they are not mutated (`readonly T[]`, `Readonly<Record<string, V>>`)
- [ ] `pnpm qa` (Biome, `tsc` strict, Vitest) passes with no suppression comment
