# Tasks: host process and workspace containment

Ordered by dependency. Infrastructure packages first (`@indaba/core` needs no change), tests alongside each, documentation last. Each task independently checkable.

## Infrastructure: `@indaba/runners`

- [ ] **T-01** Create `packages/runners/src/env.ts` with `BASELINE_ENV_NAMES`, `RunnerEnvOptions` and `buildRunnerEnvironment`, and use it in `AcpRunner`, `AbstractCliRunner`, `ShellRunner` and `process.ts`.
- [ ] **T-02** Add per-call `<workdir>/.indaba/tmp` creation, `TEMP`/`TMP`/`TMPDIR` injection and `finally` cleanup in `executeProcess` (`packages/runners/src/process-runner.ts`) and `AcpRunner` (`packages/runners/src/acp-runner.ts`).
- [ ] **T-03** Update `ClaudeRunner` (`packages/runners/src/claude-runner.ts`) to pass `--disallowedTools Task` by default and add `ClaudeRunnerOptions.allowSubagents`.

## Infrastructure: `@indaba/engine`

- [ ] **T-04** Extend `RestorableWorkspace` (`packages/engine/src/workspace/workspace.ts`) with optional `verifyRefs(checkpoint: WorkspaceCheckpoint): Promise<readonly string[]>`.
- [ ] **T-05** Update `GitWorktree.checkpoint()` and `GitWorktree.restore()` (`packages/engine/src/workspace/git-worktree.ts`) to snapshot, verify (`verifyRefs`) and restore `refs/heads/*` and `refs/tags/*`.
- [ ] **T-06** Check `verifyRefs` after isolated step execution in `WorkflowEngine` (`packages/engine/src/engine/workflow-engine.ts`), rolling back tampered refs and failing the step.

## Tests

- [ ] **T-07** Unit tests in `packages/runners/test/` verifying:
  - `TEMP`, `TMP` and `TMPDIR` point to `<workdir>/.indaba/tmp` and the directory is removed after the process exits, times out or aborts;
  - unrelated secrets in `process.env` (`AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, other provider keys) are stripped from CLI and shell runners while `BASELINE_ENV_NAMES`, `envPrefixes` and `passEnv` are preserved;
  - `ClaudeRunner` includes `--disallowedTools Task` by default and omits it when `allowSubagents: true` or when tool flags are in `extraArgs`.
- [ ] **T-08** Integration tests in `packages/engine/test/workspace/` and `packages/engine/test/engine/` with real temporary git repositories verifying that `git branch -D`, `git branch -f` and `git tag -d` inside an isolated worktree are detected by `verifyRefs`, rolled back by `restore`, and fail the step.
- [ ] **T-09** Architecture and layers tests (`packages/core/test/architecture.test.ts`, `packages/*/test/layers.test.ts`) remain green.

## Documentation

- [ ] **T-10** Update `docs/runners.md` and `docs/security.md` (or `docs/workflow-format.md`) to document the confined temporary directory, environment allowlist, `--disallowedTools Task` default and git ref protection.
- [ ] **T-11** Add `CHANGELOG.md` entry under `Unreleased` with the `0.x` minor (breaking default change) classification.
- [ ] **T-12** Update `specs/DEPENDENCY_MAP.md`.

## Stage 7: Verification

- [ ] `pnpm qa` and the node gates (`node scripts/check-workflow.mjs`) green end to end, output recorded in `review.md`.
