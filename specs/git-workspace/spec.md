# Specification: Git workspace isolation

> **Status**: Implemented in the initial commit; specified retroactively from `docs/vision.md`
> section 3D. Treat as a description to be corrected by review.
> **Stage entry**: 1 (retroactive)
> **Semver impact**: minor (first public surface; below 1.0)

---

## 1. The problem

Agents that edit files in the same checkout trample each other and the developer's working tree, and
a failed attempt leaves half-applied edits behind. Each task variant needs its own sandbox, a way to
extract what the agent changed as a patch, and a guarantee that the sandbox is gone afterwards.

## 2. User stories

- **US-01.** As a workflow author, I mark a step `isolation: git_worktree` and the agent works in its
  own worktree, leaving my checkout untouched.
- **US-02.** As a workflow author, the changes an agent made are available as a unified diff
  artifact, which can be validated and applied.
- **US-03.** As a developer embedding Indaba, a cancelled or failed run leaves no worktree behind.

## 3. Acceptance criteria

- [ ] Worktrees are created under `.indaba/worktrees/{taskId}` and nowhere else.
- [ ] A task id that would escape that directory, or look like a git option, is rejected.
- [ ] A diff of the worktree against its base is produced with `git diff`.
- [ ] A patch is validated with `git apply --check` before it is applied, and rejected with a reason
      if it does not apply or touches paths outside the worktree.
- [ ] Teardown (`git worktree remove --force`, then prune) runs on completion, failure and
      cancellation, and is idempotent.
- [ ] Only `Git` runs git, with an argument array, a timeout and prompts disabled.

## 4. Non-goals

- Merging or pushing branches to a remote.
- Supporting version control systems other than git.
- Sharing a worktree between tasks.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| git is not installed or not a repository | `WorkspaceException` that says so |
| the patch does not apply | rejected with git's stderr; nothing is half-applied |
| teardown fails | reported; the next teardown retries; nothing else is removed |

## 6. Security and data handling

Task ids, branch names and patch paths are untrusted. Names are validated and passed after `--`;
resolved paths must stay under the worktree root; patches are checked before applying. See
`.agents/skills/workspace_git/SKILL.md`.

## 7. Where it lives

`src/Workspace/`, infrastructure. `WorkspaceManager` is the interface the engine uses;
`GitWorktreeManager` implements it.

## 8. Clarifications

The base ref a worktree starts from, and the branch naming scheme, are to be confirmed against the
code in review.

## Artifacts not written

- `plan.md`: retroactive spec.
- `research.md`: no options were recorded at the time.
- `data-model.md`: `Workspace` and `GitWorktree` are plain handles listed in api-surface.md.
- `events.md`: the workspace emits no event; the engine's spans cover create and teardown.
- `tasks.md`: the work is done.
