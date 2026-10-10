# Tasks: Workspaces without git

Ordered by dependency. Domain first, infrastructure second, console and documentation last. Each task is independently
checkable, and its tests are written with it, not after.

## `@indaba/core`

- [ ] T1. `Isolation.Copy`, `WorkspaceKind`, `ApplyPolicy`, `CopySettings`, `DEFAULT_COPY_SETTINGS`, the two `WorkflowDefinition` members; `defineStep` and the workflow defaults unchanged for existing input.
- [ ] T2. `FileFingerprint`, `ChangeKind`, `EntryType`, `FileChange`, `ChangeSet` and `LandingError`, exported.
- [ ] T3. `isPortableRelativePath`: every rule of AC-27 (empty, `.`, `..`, NUL, colon, backslash, trailing space or dot, each reserved device name with and without extension and in either case, a leading `/`, a Unicode name, a deep path), identical answers on every OS.
- [ ] T4. `changesOutsideScope` and `changesUnderPaths`: empty lists, globs, a bare path as prefix, a path that only shares a prefix as text (`src` against `src2`), links, an ordering check.
- [ ] T5. `GuardContext` and the optional third parameter of `Guard.check`; a two-parameter guard compiles and runs.
- [ ] T6. `architecture.test.ts` still green: no `node:` module in core.

## `@indaba/engine`: the copy

- [ ] T7. `tree-scan.ts`: sizes, regular files and directories, links, junctions and special files skipped and counted, the three limits with the exact message, include and exclude, the never-copied directories, a hostile tree (very deep, very many entries, a name that is a device name), bounded memory.
- [ ] T8. `manifest.ts`: streaming SHA-256 (a file larger than the stream buffer, an empty file, a file that grows while read), a stable sorted manifest, its digest, comparison into added, modified (content and executable bit) and deleted, a rewrite with identical content is no change, a case-only rename on a case-insensitive filesystem.
- [ ] T9. `CopyWorkspaceManager.create`: name check and confinement (traversal, an option-like name, an existing path), the scan before any copying, nothing left behind on a limit, an unreadable file, a full disk (injected) and a cancel; the resulting copy equals the folder minus the exclusions; the executable bit survives.
- [ ] T10. `CopyWorkspace.changes`, `snapshot`, `diff`, `destroy`: every change kind, a link created by the "agent", the limits applied again, an unknown snapshot handle, `diff()` as the change report, idempotent destroy, destroy not cancelled by the abort signal, destroy after a cancel.
- [ ] T11. `fork`: starts equal to the parent's current contents, its baseline is that state, changes in the fork do not touch the parent, two forks are independent, teardown of every fork.

## `@indaba/engine`: landing

- [ ] T12. The conflict check: unchanged, modified in the folder, deleted in the folder, an added file that now exists with other content, with identical content (accepted), nothing written on a refusal, the message lists 10 and counts the rest.
- [ ] T13. Refusal before any write for a link, a non-portable name and a path outside the root, including a folder component that is a link.
- [ ] T14. The staged procedure with a failure injected after every single file operation (temporary write, move aside, rename in, deletion): the folder is restored byte for byte each time; a failed restore is reported with the earlier copies' location and keeps the journal.
- [ ] T15. The journal: written before the first move, removed after the last; a crash simulated between operations is rolled back by `recoverInterruptedLandings` and by `indaba apply`, with message 7; a corrupt journal fails with the file named and changes nothing.
- [ ] T16. `land(from, since)`: a fork's changes enter the parent; refuses when the parent changed since `since`; a deletion, an addition, a modification; used by `step-variants`.
- [ ] T17. `landInProject` with `dryRun`: reports the same list and writes nothing; the 200-line bound and the "and N more" count.
- [ ] T18. The kept record: written by `keep`, validated on read (unknown fields, a wrong version, a path outside `.indaba/worktrees`, a name that fails the name check are refused), `listKeptWorkspaces`, `landKeptWorkspace`, `discardKeptWorkspace`; a record whose folder is gone is reported, not trusted.

## `@indaba/engine`: git, guards, ledger, engine

- [ ] T19. `GitWorktree` as `TrackedWorkspace`: `changes` from the porcelain output (rename as delete plus add, untracked included, `.indaba` excluded, a folder prefix), `fork` equivalent to the text `step-variants` had, `land` and `landInProject` through `PatchService` with the same refusal behaviour as the copy, against a temporary git repository.
- [ ] T20. One table of cases run against both kinds for `diff_within_scope` and `git_diff_empty`: the same verdict, with the AC-29 cases listed as the known differences; failing closed when `changes()` rejects; the copy path never runs git.
- [ ] T21. Guards without a context: unchanged in a git repository; in a folder without git the failure message 11; the existing guard tests pass unchanged.
- [ ] T22. Parser and validator: `isolation: copy`, `copy` (each field, wrong types, unknown keys, present with no copy step), `defaults.apply`, the one-kind rule through `depends_on`, messages 1, 4 and 12; every existing workflow in the repository still parses to the same definition.
- [ ] T23. Engine: the manager chosen by kind, a copy step with no `copyWorkspaces` fails clearly, a plain `Workspace` given to a step that needs tracking fails clearly, `GuardContext` passed, the `patch` artifact is the report for a copy and the unified diff for git, destroy or keep on every ending.
- [ ] T24. `defaults.apply` and `--apply`: `never` removes the copy; `auto` lands and refuses a conflict by keeping the copy; `ask` with a decider that answers each of apply, keep, discard; `ask` with a decider that resolves `undefined` and with no decider keeps the copy and completes the run with exit 0 (AC-22); landing only after a completed run; a failed or cancelled run lands nothing.
- [ ] T25. The ledger in a folder: the same folder gives the same key, any changed byte gives a new key, `.indaba/` and `.indaba-decisions/` do not change it, a folder over the limits is skipped with message 13, `basis` round-trips, an old line without `basis` is read as git, a git repository's behaviour is byte-identical to before.
- [ ] T26. Telemetry: the attributes and events of `events.md`, with counts only; a test searches the emitted records for a file's contents and finds none; at most 20 paths, each cut at 200 characters and redacted.

## `indaba` (CLI)

- [ ] T27. `indaba apply`: list, show, `--dry-run`, `--discard`, `--yes`, the terminal prompt and its refusal without a terminal, exit codes, an unknown name, a name that fails the name check.
- [ ] T28. `validate`, `plan` and `run` messages: 1 (with `--workdir` on a folder without git), 2, 4, 12; `plan` prints each step's workspace kind; a hostile folder name in a message is cleaned.
- [ ] T29. The composition root registers `CopyWorkspaceManager` and the terminal `LandingDecider`; the layers tests stay green (`@indaba/runners` and `@indaba/core` import nothing new).

## Tests across the feature

- [ ] T30. Hostile input, with hostile strings built from fragments so the security gate stays quiet: file names (traversal, device names, colon, trailing dot, very long), a link to a parent and to an absolute path, a junction (on Windows CI), a result that tries to write through a link, a mode change, a file replaced by a directory and the reverse.
- [ ] T31. Windows-only tests on CI: extended-length paths, a locked file, reserved names, a case-only rename.
- [ ] T32. End to end through the built CLI with fake runners in a folder that is not a git repository: a copy run with `permissions` where the fake agent writes inside and outside its scope; the guard fails the out-of-scope write; an in-scope run is asked, applied and the folder holds the result; a conflict created by changing the folder mid-run is refused and the copy is kept; `indaba apply` lands it after the conflict is resolved by hand.
- [ ] T33. `pnpm smoke`: the packed install boots with the new exports and the `apply` command.
- [ ] T34. Determinism: the same folder, ids and runner results give the same manifest digest, the same change list order and the same report.

## Other specs

- [ ] T35. `step-variants` implementation tasks (T8, T9, T12) are satisfied on both kinds through `fork`, `land` and `changes`; the variants tests run once per kind.
- [ ] T36. `step-budgets` resume (AC-17 and the resume file): a stopped copy step keeps its copy and resumes in it; the kept record and the resume file agree.

## Documentation

- [ ] T37. `docs/workflow-format.md`: `isolation: copy`, `copy`, `defaults.apply`, the one-kind rule, `indaba apply`, what each guard does on each kind and the difference, and that a copy is not a sandbox.
- [ ] T38. `docs/extending.md`: `TrackedWorkspace`, `TrackedWorkspaceManager` and `GuardContext` for embedders and guard authors; `docs/getting-started.md`: a first run on a folder that is not a repository.
- [ ] T39. `README.md`, `CHANGELOG.md` (Added, and Changed with the `Isolation` note and the "major in practice" classification), `specs/DEPENDENCY_MAP.md` (the workspace seam), `AGENTS.md` repository map only if a path changed.

## Stage 7: Verification

- [ ] `pnpm qa` and the node gates (`node scripts/check-workflow.mjs`) green end to end, output recorded in `review.md`
- [ ] `pnpm e2e` and `pnpm smoke` green, on Windows, macOS and Linux
