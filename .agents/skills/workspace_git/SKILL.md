---
name: workspace_git
description: Use when changing GitWorktreeManager or the Git wrapper, creating or removing worktrees, generating or applying diffs, or anything that runs git on behalf of a task. Covers isolation, teardown and argument safety.
---

# Git Workspace Specialist

Each task variant gets its own ephemeral `git worktree` so agents can edit in parallel without
touching each other or the main checkout.

## Layout and ownership

Worktrees live at `.indaba/worktrees/<taskId>` under the repository root, and only there. The
manager creates, tracks and removes them; it removes nothing it did not create. `.indaba/` is
gitignored runtime state, distinct from the development workflow in `workflow.ai.yml`.

## The Git wrapper

`Workspace\Git` is the only code that runs git. It wraps `Symfony\Component\Process\Process` with
an argument array, a working directory, a timeout and a clean, explicit environment.

- Refs, branch names and paths from outside go after `--` or are validated first: a branch called
  `--upload-pack=...` or `-D` must be inert. Prefer plumbing commands with fixed shapes.
- Disable prompts and pagers (`GIT_TERMINAL_PROMPT=0`, `GIT_PAGER=cat`), and do not read the user's
  global configuration for decisions that affect results.
- Capture stderr; a git failure is a `WorkspaceException` carrying the command's argv (without
  secrets) and its stderr.

## Lifecycle

1. `create(taskId)`: validate the id against a strict pattern, `git worktree add` on a new branch
   from a recorded base, return a handle.
2. Work happens in the handle's directory.
3. `diff(handle)`: `git diff` against the base, as a unified diff the engine stores as an artifact.
4. `apply(diff)`: `git apply --check` first, then apply; a patch that does not check is rejected
   with the reason. Never apply with options that skip validation.
5. `remove(handle)`: `git worktree remove --force`, then prune, in a `finally`, on completion,
   failure and cancellation. Teardown is idempotent.

## Safety

- Task ids are validated, never concatenated into a path unchecked; the resolved path must stay
  under `.indaba/worktrees/`.
- A diff is untrusted input to `git apply`: reject paths outside the worktree, `.git` internals and
  symlink escapes.
- Never run a hook or script from the worktree's content with Indaba's credentials.

## Testing

Real git, real temporary repositories (created in `sys_get_temp_dir()`, removed after). Cover: create
and remove, teardown after an exception, a conflicting apply, a hostile branch name, an id that tries
to escape. The container has git; the host's PHP does not, so run them in Docker.
