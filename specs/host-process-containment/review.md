# Self-review: host process and workspace containment

> **Status**: self-review done (stages 6 and 7 complete; the track is `feature`)

Answers to the seven questions of [`.agents/rules/review.md`](../../.agents/rules/review.md).

## 1. Boundary and layering

Nothing was added to `@indaba/core`; it has no new import. The environment allowlist, the confined temporary directory
and `--disallowedTools Task` are in `@indaba/runners` (`env.ts`, `process-runner.ts`, `acp-runner.ts`, `claude-runner.ts`,
`shell-runner.ts`); the reference snapshot, `verifyRefs` and the step failure are in `@indaba/engine`. `layers.test.ts` and
`architecture.test.ts` stay green. The engine reaches `verifyRefs` through the optional member of `RestorableWorkspace`, so a
third-party workspace is neither required to implement it nor given less than the built-in: the built-in has no extra access.

## 2. Determinism and failure isolation

`buildRunnerEnvironment` is a pure function of its inputs; the one read of `process.env` per runner is the default of
`options.env` in the constructor (the composition root, or a test, can pass it). The temporary directory is removed in a
`finally` on success, a non-zero exit, a timeout, a stall, an abort and a throwing spawner, and a removal that fails never masks
the call's outcome. Calls that overlap in one working directory share the directory and the last one removes it (a counter per
resolved path): without it, one call finishing deleted the directory of another, which a test of the real processes showed.
The rollback and the check run once per attempt, bounded by the number of attempts; no new loop.

## 3. Public surface and semver

As classified in `api-surface.md`: a major, delivered as the next `0.x` minor with the labelled entry in `CHANGELOG.md`.
Beyond the contract, and additive: `EnvironmentPolicy` is exported (it appears in a `protected` signature of an exported
class), `ProcessSpec.inheritEnv` (named in AC-07), and the ACP baseline keeps `ALL_PROXY` and the prefixes `XDG_`, `LC_` and
`NPM_CONFIG_` it had before, so the ACP environment does not shrink. The shell toolchain list is exact names plus
`NPM_CONFIG_*`, not the prefix `GO` of `plan.md`, which would also have passed `GOOGLE_API_KEY`.

## 4. Security

Environment: an allowlist replaces all of `process.env`; a test checks that `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`,
`DATABASE_URL` and another provider's key are absent for every CLI runner, and that the shell runner never gets a provider
key. Paths: the temporary directory is `resolve(workdir, '.indaba', 'tmp')`, checked against the working directory, and a
missing working directory is a `RunnerUnavailableError` before any process starts. Git: object ids are checked against
`OBJECT_ID` and names against the shape of a branch or tag (no control character, no leading dash, no `..`, no glob
character) before they reach `git update-ref`, which gets them as an argument array; a forged checkpoint line is dropped, and
a test shows `refs/heads/--delete` never runs. The failure message lists at most 10 names of at most 120 characters.

## 5. Observability and honest numbers

No span attribute or event was added (spec, artifacts not written). The failure is a sentence a person can act on, with the
step and the references named, and it goes through the step's `on_failure` like any failure. No number is shown.

## 6. Dependencies and packaging

No dependency. The audit and the packed-install files are unchanged: one new source file in `@indaba/runners`, which is
under `src`.

## 7. Verification

`pnpm qa`, `pnpm e2e` and the node gates, on Windows 11 with Node 22 only (Linux and macOS run in CI):

```
pnpm qa     exit 0   Test Files 177 passed (177)   Tests 3190 passed | 2 skipped (3192)
                     coverage: All files 96.77 statements | 92.07 branches | 96.56 functions | 97.01 lines
pnpm e2e    exit 0   Test Files 13 passed | 1 skipped (14)   Tests 37 passed | 1 skipped (38)
node scripts/validate-skills.mjs            All 23 skills validated successfully
node scripts/sync-claude-skills.mjs --check .claude/skills is in sync (23 skills)
node scripts/sync-agent-docs.mjs --check    AGENTS.md, GEMINI.md and the cycle file are in sync
node scripts/check-workflow.mjs             workflow.ai.yml matches the repository
node scripts/security-audit.mjs --source    security audit: no findings
node scripts/build-site.mjs --check         every page of docs/ is on the site (22 in the navigation)
node --test scripts/*.test.mjs              tests 94, pass 94, fail 0
```

New tests: `packages/runners/test/containment.test.ts` (22) and `packages/engine/test/worktree-refs.test.ts` (10, with real
temporary git repositories). Existing tests changed only where the new default changes a command line (`--disallowedTools
Task`), an environment (the confined directory) or needed a working directory of its own (`support.ts`: one per test file).

## Known gaps

- **A concurrent commit counts as tampering.** Indaba cannot tell the agent's `git branch -D` from the person committing in
  their own checkout while a worktree step runs; both move a reference, and the rollback would undo the second. Documented in
  `workflow-format.md`. A later version could limit the check to references the step could not legitimately move, or leave
  the branch that is checked out in the project directory alone, if people report losing a commit this way.
- **Parallel steps check the same references.** With `--parallel`, a step that tampers fails, and a sibling step that runs at
  the same time also sees the change and fails. The cost is one failed sibling, not a wrong result; the condition to fix it is a
  per-step account of which step moved which reference, which needs more than the checkpoint holds.
- **No way to pass a variable to a built-in CLI runner from the command line.** `passEnv` exists on `CliRunnerOptions` and
  `ShellRunnerOptions`, but only `acp` has `INDABA_ACP_PASS_ENV`. A person who runs `claude-code` against Bedrock or Vertex needs
  `AWS_*` or `CLOUD_ML_*` through, and today only an embedder can say so. The condition to add it: that need, with a decision on
  the name and scope of the variable (a new public surface, so a spec of its own).
- **The check is after the step.** The references are put back, but a process that deleted a branch has already run; a hard
  guarantee needs the sandbox (`specs/agent-sandbox`).
- **Only one operating system was run here.** The Windows path (confined directory, locked-file cleanup with retries) ran; the
  POSIX path is covered by CI.
