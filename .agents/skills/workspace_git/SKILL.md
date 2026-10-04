---
name: workspace_git
description: Use when changing GitWorktreeManager or the Git wrapper, creating or removing worktrees, generating or applying diffs, or anything that runs git on behalf of a task. Covers isolation, teardown and argument safety.
---

# Git Workspace Specialist

Each task variant gets its own ephemeral `git worktree` so agents can edit without touching each
other or the main checkout. The code is in `packages/engine/src/workspace`.

## Layout and ownership

Worktrees live at `.indaba/worktrees/<taskId>[-<variant>]` under the project directory, and only
there. `GitWorktreeManager.create(taskId, variant?)` creates them (detached, from `HEAD`) and returns
a `Workspace` with `path()`, `diff()` and an idempotent `destroy()`; it removes nothing it did not
create. `.indaba/` is gitignored runtime state, distinct from the development workflow in
`workflow.ai.yml`.

## The Git wrapper

`Git` is the only code that runs git. It uses `spawn('git', args, { shell: false })` with an argument
vector, a working directory, a deadline and an `AbortSignal`, and a sanitised environment.

- Refs, branch names and paths from outside go after `--` or are validated first: a branch called
  `--upload-pack=...` or `-D` must be inert. Prefer plumbing commands with fixed shapes.
- Prompts and optional locks are off (`GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`), and
  variables that would redirect git to another repository (`GIT_DIR`, `GIT_INDEX_FILE`, ...) are
  stripped, because git sets them when Indaba itself runs from a hook.
- A git failure is a `WorkspaceError` carrying the command's arguments and its stderr, never a secret.

## Lifecycle

1. `create(taskId, variant?)`: validate both names against a strict pattern
   (`^[A-Za-z0-9][A-Za-z0-9._-]*$`, no `..`), resolve the path and confirm it is inside
   `.indaba/worktrees`, refuse an existing path, then `git worktree add --detach`.
2. Work happens in the workspace's directory.
3. `diff()`: a unified diff against the base commit, untracked files included, which the engine
   stores as an artifact.
4. `PatchService`: `git apply --check` first, then apply; a patch that does not check is rejected with
   the reason. Never apply with options that skip validation.
5. `destroy()`: remove the worktree and prune, in a `finally`, on completion, failure and
   cancellation. Teardown is idempotent.

## Safety

- Task ids are validated, never concatenated into a path unchecked; the resolved path must stay under
  `.indaba/worktrees/` (a `path.relative` check).
- A diff is untrusted input to `git apply`: reject paths outside the worktree, `.git` internals and
  symlink escapes.
- Never run a hook or script from the worktree's content with Indaba's credentials.

## Testing

Real git, real temporary repositories (created with `mkdtemp` under `os.tmpdir()`, removed in
`afterEach`; CI sets a git identity). Cover: create and destroy, teardown after an exception, a
conflicting apply, a hostile branch name, an id that tries to escape. Tests run on Windows, macOS and
Linux, so compare paths with `path` helpers, not string literals with `/`.
