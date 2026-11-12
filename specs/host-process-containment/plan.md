# Implementation plan: host process and workspace containment

## 1. Shared environment allowlist and confined temp directory (`@indaba/runners`)

- Extract the environment allowlist logic from `packages/runners/src/acp-runner.ts` into a dedicated module `packages/runners/src/env.ts` exporting `BASELINE_ENV_NAMES`, `RunnerEnvOptions` and `buildRunnerEnvironment`.
- `BASELINE_ENV_NAMES` holds the OS, path, locale, terminal, certificate and proxy variables needed for CLI binaries and toolchains to run, **excluding** `TEMP`, `TMP` and `TMPDIR` (which are set explicitly to the step's confined temp directory unless overridden by `request.env`).
- Each CLI runner (`ClaudeRunner`, `CodexRunner`, `AntigravityRunner`, `CursorRunner`, `OpenCodeRunner`) declares its `protected envPrefixes(): readonly string[]` on `AbstractCliRunner`:
  - `ClaudeRunner`: `['ANTHROPIC_', 'CLAUDE_']`
  - `CodexRunner`: `['OPENAI_', 'CODEX_']`
  - `AntigravityRunner`: `['GEMINI_', 'GOOGLE_', 'ANTIGRAVITY_']`
  - `CursorRunner`: `['CURSOR_', 'OPENAI_', 'ANTHROPIC_']`
  - `OpenCodeRunner`: `['OPENCODE_', 'ANTHROPIC_', 'OPENAI_', 'GOOGLE_', 'GEMINI_', 'OPENROUTER_']`
- `ShellRunner` uses `SHELL_ENV_PREFIXES` (`['NPM_CONFIG_', 'PNPM_', 'NODE_', 'CARGO_', 'RUSTUP_', 'GO', 'VIRTUAL_ENV', 'CI']`) plus `BASELINE_ENV_NAMES`, so verification commands (`pnpm test`, `node ...`) work without receiving `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`.
- In `executeProcess` (`packages/runners/src/process-runner.ts`) and `AcpRunner.run` (`packages/runners/src/acp-runner.ts`):
  - Resolve `tempDir = resolve(request.workdir, '.indaba', 'tmp')`, verify `isInside(resolve(request.workdir), tempDir)`, and `await mkdir(tempDir, { recursive: true })` before spawning.
  - Set `TEMP: tempDir`, `TMP: tempDir`, `TMPDIR: tempDir` in the process environment (unless overridden in `request.env`).
  - In `finally`, after the child process tree has settled, remove `tempDir` with `await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined)`.
- In `packages/runners/src/process.ts`, `hostEnvironment(env)` no longer merges `process.env` when the caller supplies the filtered environment (and falls back to `buildRunnerEnvironment({ additions: env })` when called directly in tests).

## 2. Disabling internal subagent fan-out in `ClaudeRunner` (`@indaba/runners`)

- In `packages/runners/src/claude-runner.ts`:
  - Add `readonly allowSubagents?: boolean` to `ClaudeRunnerOptions` (default `false`).
  - Add helper `choosesToolFilter(args: readonly string[]): boolean` checking for `--disallowedTools`, `--disallowed-tools`, `--allowedTools` or `--allowed-tools`.
  - When `!this.allowSubagents && !choosesToolFilter(this.extraArgs ?? [])`, append `'--disallowedTools', 'Task'` to the built command vector.

## 3. Git reference snapshot and rollback in `GitWorktree` (`@indaba/engine`)

- In `packages/engine/src/workspace/git-worktree.ts`:
  - Add private helper `readRefs(): Promise<Map<string, string>>` that runs `git for-each-ref --format=%(objectname) %(refname) refs/heads refs/tags` in `this.projectDir` and validates each object id with `OBJECT_ID` and each ref name (`refs/heads/...` or `refs/tags/...`).
  - In `checkpoint()`, serialize the ref map as newline-separated `<oid> <refname>` lines under `checkpoint.refs`.
  - Implement `verifyRefs(checkpoint: WorkspaceCheckpoint): Promise<readonly string[]>`: compares current `readRefs()` against `checkpoint.refs` and returns the sorted list of any ref names that were added, deleted or changed to a different object id.
  - In `restore(checkpoint: WorkspaceCheckpoint)`: if `checkpoint.refs` is present, compare current `readRefs()` with the recorded refs; restore any modified or deleted ref with `git update-ref -- <refname> <oid>` and delete any newly created ref with `git update-ref -d -- <refname>`.
- In `packages/engine/src/engine/workflow-engine.ts` (and `step-executor.ts` for stall retries):
  - Take a checkpoint before running an isolated step (already taken when `isRestorable(stepWorkspace)`).
  - Immediately after `executor.run(...)` finishes and before `executor.validate(...)` or landing, call `stepWorkspace.verifyRefs(preStepCheckpoint)` if defined.
  - If the returned list is non-empty, call `await stepWorkspace.restore(preStepCheckpoint)` and turn the step outcome into `StepOutcome.failed(...)` naming the tampered refs (sanitized and bounded).
