# API surface contract: Git workspace isolation

> Written retroactively. Names are the intended public classes; signatures are to be confirmed
> against `src/Workspace/` in review.

## Semver classification

**minor**: first public surface (below 1.0).

## Public symbols added

| Name (FQCN) | Kind | Notes |
| :--- | :--- | :--- |
| `Indaba\Workspace\Git` | final class | argument-array git wrapper |
| `Indaba\Workspace\GitWorktreeManager` | final class | creates and removes worktrees, implements `WorkspaceManager` |
| `Indaba\Workspace\WorkspaceManager` | interface | what the engine depends on |
| `Indaba\Workspace\Workspace` | interface or value type | a handle to an isolated directory |
| `Indaba\Workspace\GitWorktree` | final class | the worktree handle |
| `Indaba\Workspace\PatchService` | final class | diff, check and apply |
| `Indaba\Core\Exception\WorkspaceException` | exception | git or workspace failure |

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow file | step field `isolation` with value `git_worktree` | added |
| filesystem | `.indaba/worktrees/{taskId}` | the location is part of the contract |
| artifact key | `patch` (the diff of an isolated step) | added |

## Defaults introduced

To be filled from the code in review: base ref, branch naming, git timeout.

## Checks

- [ ] Every type in a public signature is public or deliberately `@internal`
- [ ] Only `Git` starts git processes
- [ ] Tests use real temporary repositories and remove them
- [ ] `composer stan` passes without an ignore
