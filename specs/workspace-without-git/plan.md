# Plan: Workspaces without git

## Modules touched

| File | Change |
| :--- | :--- |
| `packages/core/src/workflow/model.ts` | `Isolation.Copy`; `WorkspaceKind`, `ApplyPolicy`, `CopySettings`, `DEFAULT_COPY_SETTINGS`; `WorkflowDefinition.copy` and `defaultApply` |
| `packages/core/src/workspace/changes.ts` (new) | `FileFingerprint`, `ChangeKind`, `EntryType`, `FileChange`, `ChangeSet`, `isPortableRelativePath`, `changesOutsideScope`, `changesUnderPaths`; pure |
| `packages/core/src/extension/index.ts` | `GuardContext`; the optional third parameter of `Guard.check` |
| `packages/core/src/errors/index.ts` | `LandingError extends WorkspaceError` |
| `packages/core/src/index.ts` | exports |
| `packages/engine/src/workspace/workspace.ts` | `WorkspaceSnapshot`, `TrackedWorkspace`, `TrackedWorkspaceManager`, `LandOptions`, `LandResult`, `KeptWorkspace`, `WorkspaceCreateOptions`, `isTrackedWorkspace`; `Workspace` and `WorkspaceManager` unchanged |
| `packages/engine/src/workspace/tree-scan.ts` (new) | the bounded walk: names, types, sizes, links skipped, limits, safe-name check; used by the copy, by `changes()` and by the ledger fingerprint |
| `packages/engine/src/workspace/manifest.ts` (new) | streaming SHA-256 of a file; the manifest (sorted entries) and its digest; comparing two manifests into a `ChangeSet` |
| `packages/engine/src/workspace/copy-workspace-manager.ts`, `copy-workspace.ts` (new) | name check and confinement, the scan, the copy-and-hash pass, `changes`, `snapshot`, `fork`, `land`, `landInProject`, `keep`, `destroy`, the change report for `diff()` |
| `packages/engine/src/workspace/lander.ts` (new) | the staged landing: verify, stage, move aside, rename in, finish deletions, roll back; the journal; used by `land`, `landInProject` and `landKeptWorkspace` |
| `packages/engine/src/workspace/kept.ts` (new) | the `.workspace.json` record: write, read and validate, list, land, discard; `recoverInterruptedLandings` |
| `packages/engine/src/workspace/git-worktree.ts`, `git-worktree-manager.ts` | implement `TrackedWorkspace` and `TrackedWorkspaceManager`: `changes` from `git status --porcelain=v1 -z --untracked-files=all` (the parsing the scope guard already has, moved to one place), `fork` (a worktree from `HEAD`, then the diff applied through `PatchService`: the text `step-variants` had), `land` and `landInProject` through `PatchService`, `keep` |
| `packages/engine/src/guard/diff-within-scope-guard.ts`, `git-diff-empty-guard.ts` | the optional context; the copy path through the pure functions; the plain failure messages |
| `packages/engine/src/arbiter/ledger.ts` | the folder fingerprint and `basis`; git path untouched |
| `packages/engine/src/parser/parser.ts`, `validator.ts` | `isolation: copy`, `copy`, `defaults.apply`, the one-kind rule, the field messages |
| `packages/engine/src/engine/workflow-engine.ts` | pick the manager by kind, pass `GuardContext`, the apply policy after a completed run, recovery at start, the `patch` artifact from `diff()` of either kind |
| `packages/engine/src/index.ts` | exports |
| `packages/cli/src/*` | `apply` command, `--apply`, the terminal `LandingDecider`, the `validate` and `plan` messages, composition root |
| `docs/workflow-format.md`, `docs/extending.md`, `docs/getting-started.md`, `README.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`, `AGENTS.md` | the documents `api-surface.md` lists; the dependency map gains the workspace seam |

## Where the behaviour lives

- **Pure decisions in core.** Which paths are allowed, what counts as under a guarded path, and which names are safe are
  functions of strings and a `ChangeSet`. They are tested without a filesystem and are the same for both kinds.
- **Everything that touches disk in the engine.** One scan routine (`tree-scan.ts`) is the only code that lists a
  directory and decides what is a link; the copy, `changes()` and the ledger fingerprint all use it, so the limits and the
  link rule cannot differ between them.
- **One lander.** Landing into the project, landing a fork into a workspace and landing a kept copy later are the same
  procedure with a different target directory and baseline. The git kind does not use it: it uses `PatchService`, and the
  tests hold both to the same observable contract (conflict refuses, nothing half-applied).
- **Time and ids.** The only clock use is stamping the kept record and the journal, injected through
  `CopyWorkspaceOptions.clock`. Names come from the run's task id and the existing id generator. Sorting is by byte order.

## Order of work

1. Core types and pure functions with their tests.
2. `tree-scan.ts` and `manifest.ts` against temporary folders: links, long names, unreadable files, limits.
3. `CopyWorkspace`: create, `changes`, `snapshot`, `diff`, `destroy`.
4. The lander and its journal, with failure injection at each step.
5. `fork` and `land`, then the git implementation of the same members.
6. Guards and the context; the parser and validator.
7. The engine: kind selection, apply policy, kept records, recovery.
8. The ledger fingerprint.
9. CLI and messages, then documentation, then the two other specs' edits (already made in this change).

## Risks

1. **Landing is the dangerous part.** It is the only code that writes into a person's own files. The conflict check, the
   staging and the restore are written first and tested by injecting a failure after every file operation (T14). If the
   restore path cannot be made reliable on Windows (renaming over a file another program holds open), the fallback is to
   refuse landing in that case and keep the copy, never to overwrite.
2. **The guard difference.** Copies and git worktrees interpret `paths` slightly differently (AC-29). The tests run one
   table of cases against both and list the cases that differ.
3. **Cost of re-hashing.** `changes()` reads the whole copy. If measurement shows this is slow for big folders, the
   remedy is a smaller default limit or a lower number of calls, not a time-based shortcut (C-05).
4. **Disk use.** A copy of a 1 GiB folder is 1 GiB. The limit is the guard; a copy-on-write option is a non-goal here.
5. **Path rules on Windows.** Extended-length paths, reserved names and locked files each need a Windows test on CI; the
   portable-name rule is tested on every system.
