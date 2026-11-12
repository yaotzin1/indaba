# Specification: Host process and workspace containment (temp confinement, environment allowlist, subagent cap and git ref integrity)

> **Status**: Draft (specified; stages 1 to 5 complete, ready for stage 6 implementation)
> **Stage entry**: 5 (alpha pre-1.0: breaking default changes take the next minor with a labelled changelog note, no legacy compatibility shims)
> **Semver impact**: major in 1.x, delivered as the next **minor** in `0.x` alpha with a labelled breaking-change note in `CHANGELOG.md` (changes the default environment passed to CLI and shell runners, redirects `TEMP`/`TMP`/`TMPDIR` to the step workspace, adds `--disallowedTools Task` to `claude-code` by default, and fails a worktree step that mutates main repository refs). Confirmed in [`api-surface.md`](api-surface.md).
> **Builds on**: [`specs/runner-adapters`](../runner-adapters/spec.md) (`AbstractCliRunner`, `NodeProcessSpawner`, `ClaudeRunner`), [`specs/transport-priority`](../transport-priority/spec.md) (`AcpRunner` environment allowlist), [`specs/git-workspace`](../git-workspace/spec.md) (`GitWorktree`, `WorkspaceCheckpoint`), [`specs/step-stalls`](../step-stalls/spec.md) (`RestorableWorkspace`), [`specs/agent-permissions`](../agent-permissions/spec.md) (CLI flag enforcement).
> **Meets**: [`specs/agent-sandbox`](../agent-sandbox/spec.md) (containers and VMs isolate the OS kernel and filesystem mounts; this spec hardens host-side runs when `sandbox` is `none` or not yet implemented) and [`specs/parallel-steps`](../parallel-steps/spec.md) (Indaba's step pool is the single concurrency controller).

---

## 1. The problem

Until `specs/agent-sandbox` ships and is turned on for a run, agent CLIs (`claude-code`, `codex`, `cursor`, `antigravity`, `opencode`) and shell commands started by Indaba run as host processes under the user's account. Four gaps in how Indaba starts and supervises those host processes allow a misbehaving agent to damage the host or the repository even when `isolation: git_worktree` and `permissions` are set (illustrated in the wild by [`anthropics/claude-code#109176`](https://github.com/anthropics/claude-code/issues/109176)):

1. **System drive exhaustion through inherited `TEMP`/`TMP`/`TMPDIR`.** `GitWorktreeManager` puts the step's working directory on the project's drive (`<project>/.indaba/worktrees/<taskId>`), but `NodeProcessSpawner` and `AcpRunner` pass the host's `TEMP`, `TMP` and `TMPDIR` through unchanged. On Windows, those point to `C:\Users\<user>\AppData\Local\Temp` even when the project lives on `E:`. Build artifacts, test fixtures and sub-processes that honour `$TEMP` write to the system drive and are never cleaned up by `GitWorktree.destroy()`.
2. **Unfiltered `process.env` in CLI runners leaks unrelated secrets.** `AcpRunner` filters the environment to `BASELINE_NAMES` plus the agent's credential prefixes (`ANTHROPIC_`, `OPENAI_`, ...). `NodeProcessSpawner` (`packages/runners/src/process.ts`), used by every CLI runner and `ShellRunner`, merges the entire `process.env` (`{ ...process.env, ...additions }`). Any secret present in the operator's shell (`AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, `DATABASE_URL`, other provider keys) is readable by the agent and can be echoed into its output or transcript.
3. **Unbounded internal subagent spawning inside a single CLI step.** Indaba bounds concurrency at the engine level (`PARALLEL_STEP_CAP = 1` by default, configurable via `--parallel` and `max_parallel`). However, `ClaudeRunner` starts `claude -p` with its built-in `Task` tool enabled. A single Indaba step can therefore spawn 10–19 concurrent Claude subagents on the host, bypassing Indaba's concurrency limit, board coordination and per-step worktrees, and saturating all CPU cores and disk I/O.
4. **Shared `.git` reference tampering from an isolated worktree.** A git worktree has a detached `HEAD` and a private index, but its `.git` file points back to the main repository's `.git/worktrees/<name>`, which shares `refs/heads/*` and `refs/tags/*` with the user's checkout. An agent with terminal access inside a worktree that runs `git branch -D <branch>`, `git tag -d <tag>` or `git update-ref` deletes or moves branches in the user's repository, and `DiffWithinScopeGuard` (which only inspects `git status` of the working tree) does not see it.

Because Indaba is in **alpha (`0.x`)**, these four gaps are closed directly by changing the defaults now, rather than keeping unsafe legacy defaults behind opt-in flags.

## 2. User stories

- **US-01.** As a person running Indaba on a project on drive `E:`, I want every temporary file a step creates through `TEMP`, `TMP` or `TMPDIR` to stay inside that step's workspace on `E:` and be deleted when the step ends, so a runaway build or test never fills my system drive `C:`.
- **US-02.** As a person running Indaba with cloud, database or GitHub tokens in my shell environment, I want CLI runners to receive only the baseline OS variables, the credentials for that runner's provider, and variables I explicitly pass, so an agent cannot read or print unrelated secrets from `process.env`.
- **US-03.** As a person who sets `--parallel` (or keeps the default of 1), I want `claude-code` steps not to spawn their own internal subagent trees by default, so Indaba's concurrency limit is the real limit on concurrent agents.
- **US-04.** As a workflow author using `isolation: git_worktree`, I want any deletion or mutation of branches or tags (`refs/heads/*`, `refs/tags/*`) by a step to be rolled back automatically and fail the step, so an isolated step cannot delete a branch in my repository.

## 3. Acceptance criteria

**Confined per-step temporary directory**

- [ ] AC-01. Before starting a child process for a `RunRequest`, `executeProcess` (for CLI and shell runners) and `AcpRunner` create `<workdir>/.indaba/tmp` (`mkdir` with `recursive: true`) and set `TEMP`, `TMP` and `TMPDIR` in the child's environment to that resolved path, unless the caller explicitly passed `TEMP`, `TMP` or `TMPDIR` in `request.env`.
- [ ] AC-02. When the process call settles (in `finally`, on success, non-zero exit, timeout, stall or abort), `<workdir>/.indaba/tmp` is removed (`rm` with `recursive: true, force: true`) and recreated empty for the next call if needed, so temporary files do not accumulate across retries or commands.
- [ ] AC-03. Because `<workdir>/.indaba/tmp` lies under `.indaba`, it is ignored by `GitWorktree.diff()`, `GitWorktree.stageAll()`, `DiffWithinScopeGuard` and `AcpFileServer` without new special cases.

**Environment allowlist across all runners**

- [ ] AC-04. `buildRunnerEnvironment` (shared by `AcpRunner` and `AbstractCliRunner`) constructs the child process environment from:
  1. `BASELINE_ENV_NAMES` (`PATH`, `HOME`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`, `PROGRAMDATA`, `PROGRAMFILES`, `SYSTEMROOT`, `SYSTEMDRIVE`, `COMSPEC`, `PATHEXT`, `LANG`, `LANGUAGE`, `LC_ALL`, `TERM`, `COLORTERM`, `SHELL`, `USER`, `USERNAME`, `LOGNAME`, `TZ`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, `NODE_EXTRA_CA_CERTS`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`);
  2. the runner's declared `envPrefixes` (for `ClaudeRunner`: `['ANTHROPIC_', 'CLAUDE_']`; for `CodexRunner`: `['OPENAI_', 'CODEX_']`; for `AntigravityRunner`: `['GEMINI_', 'GOOGLE_', 'ANTIGRAVITY_']`; for `CursorRunner`: `['CURSOR_', 'OPENAI_', 'ANTHROPIC_']`; for `OpenCodeRunner`: `['OPENCODE_', 'ANTHROPIC_', 'OPENAI_', 'GOOGLE_', 'GEMINI_', 'OPENROUTER_']`);
  3. any pattern in `CliRunnerOptions.passEnv` (exact variable name or prefix ending in `*`, matching `AcpRunnerOptions.passEnv`);
  4. explicit `request.env` additions;
  5. `TEMP`, `TMP` and `TMPDIR` set to the confined `<workdir>/.indaba/tmp` path (unless overridden by `request.env`).
- [ ] AC-05. Variables in `process.env` that match none of AC-04 (such as `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, `DATABASE_URL`, or another provider's key) are absent from the child process environment of every agent CLI runner and `AcpRunner`.
- [ ] AC-06. `ShellRunner` applies the same `BASELINE_ENV_NAMES` + `ShellRunnerOptions.passEnv` + `request.env` + confined `TEMP`/`TMP`/`TMPDIR`, plus common build/toolchain variables (`CI`, `NODE_ENV`, ` NODE_OPTIONS`, `PNPM_HOME`, `NPM_CONFIG_*`, `CARGO_HOME`, `RUSTUP_HOME`, `GOPATH`, `GOROOT`, `VIRTUAL_ENV`), and never passes `ANTHROPIC_*`, `OPENAI_*`, `OPENROUTER_*`, `GEMINI_*` or `CLAUDE_*` API keys to verification commands unless named in `passEnv` or `request.env`.
- [ ] AC-07. `NodeProcessSpawner` no longer merges `process.env` implicitly when `spec.inheritEnv === false` (the new default for runners that pass a complete filtered environment); for direct callers of `ProcessSpawner` that omit `inheritEnv`, `process.ts` uses the filtered baseline environment rather than raw `process.env`.

**Disabling recursive subagent spawning in `ClaudeRunner`**

- [ ] AC-08. `ClaudeRunner` passes `--disallowedTools Task` by default so a single workflow step cannot spawn an unbounded tree of internal Claude subagents behind Indaba's back.
- [ ] AC-09. `ClaudeRunnerOptions` gains `allowSubagents?: boolean` (default `false`). When `allowSubagents: true`, or when `extraArgs` already specifies `--disallowedTools` or `--allowedTools`, `ClaudeRunner` does not add `--disallowedTools Task`.

**Git reference integrity for isolated worktrees**

- [ ] AC-10. `GitWorktree.checkpoint()` records, in addition to `head` and `tree`, the repository's branch and tag references (`refs/heads/*` and `refs/tags/*`, via `git for-each-ref --format=%(refname)%00%(objectname) refs/heads refs/tags`).
- [ ] AC-11. `GitWorktree.restore(checkpoint)` restores any deleted or modified ref under `refs/heads/*` and `refs/tags/*` to the object id recorded in the checkpoint (and deletes any new branch or tag the failed attempt created under `refs/heads/*` or `refs/tags/*`), using `git update-ref` with argument arrays (`shell: false`) and validated object ids (`OBJECT_ID`).
- [ ] AC-12. After an isolated step runs (before guards and landing), `StepExecutor` / `WorkflowEngine` checks whether any ref under `refs/heads/*` or `refs/tags/*` changed relative to the checkpoint taken before the step. If any ref was added, moved or deleted, the engine restores the refs from the checkpoint and fails the step with: `Step "<id>" modified git references outside its isolated worktree (<ref names>); changes to branches and tags were rolled back.`

## 4. Non-goals

- **OS-level filesystem confinement against hardcoded `C:\` paths.** Setting `TEMP`/`TMP`/`TMPDIR` stops tools, compilers and subagents that use standard temp APIs (`os.tmpdir()`, `%TEMP%`, `$TMPDIR`). Stopping a hostile process on the host that ignores environment variables and opens `C:\Users\...` directly requires a mount namespace or hypervisor, which belongs to [`specs/agent-sandbox`](../agent-sandbox/spec.md).
- **OS-level CPU or RAM quotas on the host.** Killing the process tree on timeout/stall and disabling internal `Task` fan-out prevents accidental 19-agent CPU storms, but hard CPU/memory cgroup limits belong to `specs/agent-sandbox` (`cpus`, `memory_mb`, `pids`).
- **Per-workflow YAML syntax for `passEnv` on host steps.** `env` in `specs/agent-sandbox` already covers per-step variable names for sandboxed runs; on the host, `passEnv` is a runner/CLI configuration option.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| `<workdir>/.indaba/tmp` cannot be created (e.g. read-only filesystem or missing `workdir`) | throws `RunnerUnavailableError` before spawning the child |
| a child process leaves locked files in `<workdir>/.indaba/tmp` on Windows | `killTree` runs first on timeout/stall/abort; cleanup uses `rm(..., { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })` and never masks the step's exit outcome |
| an agent tries to read `process.env.AWS_SECRET_ACCESS_KEY` or another unallowed variable | the variable is undefined in the child environment |
| an agent in an isolated worktree runs `git branch -D other-branch` or `git tag -f v1.0.0` | the engine restores the deleted/moved ref from the checkpoint, fails the step with the fixed message naming the ref, and applies the step's `on_failure` policy |
| a retry or stall retry runs after a failed attempt | `<workdir>/.indaba/tmp` is clean and all git refs and worktree files match the pre-attempt checkpoint |

## 6. Security and data handling

- **Paths.** The temporary directory path is built with `resolve(workdir, '.indaba', 'tmp')` and checked with `isInside(resolve(workdir), tempDir)` before creation or removal. It never follows symlinks outside `workdir`.
- **Secrets.** Shrinking the environment passed to child processes from all of `process.env` to an explicit allowlist directly enforces the architectural rule *"Secrets are never logged"* and the `runner_adapter` rule *"Environment is explicit: pass what the agent needs and the secret it is meant to hold, nothing inherited by accident from the parent."*
- **Git arguments.** Ref names and object ids read from `git for-each-ref` and restored via `git update-ref` are validated against `OBJECT_ID` (`/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/`) and ref-name safety (`refs/heads/...`, `refs/tags/...`, no leading `-`, no `..`, no control characters) and passed as argument arrays with `shell: false`.
- **Untrusted ref names in failure messages.** Any ref name created by an agent that fails validation or is reported in the failure message is sanitized and truncated (`sanitize`, max 120 chars, at most 10 refs listed) before entering feedback, spans or events.

## 7. Where it lives

| Part | Package | Pure or infrastructure |
| :--- | :--- | :--- |
| `BASELINE_ENV_NAMES`, `buildRunnerEnvironment`, per-call `.indaba/tmp` creation and cleanup in `executeProcess` and `AcpRunner`, `ClaudeRunner` `--disallowedTools Task` | `@indaba/runners` | infrastructure |
| `GitWorktree.checkpoint()` / `restore()` ref snapshot, `GitWorktree.verifyRefs()` (or `RestorableWorkspace` ref check), engine step failure on ref tampering | `@indaba/engine` | infrastructure |
| CLI/composition root wiring (`passEnv` if configured) and docs | `indaba`, `docs/` | infrastructure / docs |

Nothing is added to `@indaba/core`: the domain contracts (`Runner`, `RunRequest`, `Workspace`) need no new method, and `@indaba/core` remains free of `node:` imports.

## 8. Clarifications

Confirmed by the alpha-state (`0.x`) directive:

- **C-01. Alpha state: change defaults immediately, no legacy shims.** Because Indaba is pre-1.0 (`0.x`) and unpublished, we do not keep unsafe defaults (`inherit all of process.env`, `TEMP` on `C:`, `Task` enabled in `claude-code`) for a deprecation cycle. The new safe defaults take effect immediately and are recorded as breaking changes in the next `0.x` minor in `CHANGELOG.md`.
- **C-02. Why `<workdir>/.indaba/tmp` instead of `<projectDir>/.indaba/tmp/<stepId>`.** For an isolated step, `<workdir>` is already `<projectDir>/.indaba/worktrees/<taskId>[-<stepId>]`. Placing `.indaba/tmp` inside `<workdir>` works identically for isolated steps, non-isolated steps, and `AcpRunner`, requires no extra path plumbing in `RunRequest`, stays on the project drive, and is automatically excluded by every existing `.indaba` filter in git and guards.
- **C-03. `ShellRunner` does not receive LLM API keys by default.** A verification command (`pnpm test`, `cargo test`) has no business holding `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`. Stripping provider keys from `ShellRunner` while keeping toolchain variables (`PATH`, `CI`, `NODE_OPTIONS`, `PNPM_HOME`, `CARGO_HOME`, `RUSTUP_HOME`, etc.) prevents a malicious test or dependency from exfiltrating the user's LLM keys.
- **C-04. Git ref snapshot format in `WorkspaceCheckpoint`.** `WorkspaceCheckpoint` is already `Readonly<Record<string, string>>` (`specs/step-stalls`). Storing `refs` as a newline-separated `<oid> <refname>` string (each line validated before use) keeps `WorkspaceCheckpoint` backwards-compatible in type while making ref tampering detectable and restorable.

## Artifacts not written

- `data-model.md`: no new workflow YAML schema fields or persistent file formats are introduced; `WorkspaceCheckpoint` keeps its existing `Readonly<Record<string, string>>` type.
- `research.md`: the failure modes come directly from the documented incident (`anthropics/claude-code#109176`) and direct inspection of `packages/runners/src/process.ts`, `packages/runners/src/acp-runner.ts` and `packages/engine/src/workspace/git-worktree.ts`.
- `events.md`: no new event class or span attribute is added; ref tampering and permission/process failures surface through the existing step failure outcome and status reason.
