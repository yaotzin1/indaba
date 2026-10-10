# Specification: Workspaces without git (folder isolation)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommendations the maintainer confirms)
> **Semver impact**: one change is a major in practice and the rest is additive: `Isolation` gains the member `copy`,
> and a consumer that switches on it exhaustively stops compiling. Below 1.0 that takes the next minor and says so in
> the changelog (`api-surface.md`). Existing workflows behave exactly as before.
> **Builds on**: [`specs/git-workspace`](../git-workspace/spec.md) (worktrees and patches),
> [`specs/debate-arbiter`](../debate-arbiter/spec.md) (the decision ledger). **Changes two specs written at the same
> time**: [`specs/step-variants`](../step-variants/spec.md) and [`specs/step-budgets`](../step-budgets/spec.md)
> (section 9).

---

## 1. The problem

Indaba is meant for people who are not developers, running regular tasks (work, review, revise until done) on folders of
documents, spreadsheets, images or recordings. Those folders are not git repositories, and git is wired into the parts of
Indaba that protect a folder:

- `isolation: git_worktree` runs a step in a copy of the project, and it needs the project directory to be a git
  repository. In any other folder the step fails with a git error.
- The guards `git_diff_empty` and `diff_within_scope` read git state, and fail closed when they cannot. In a folder
  without git no step can be given a "may only change these files" boundary. `permissions` adds `diff_within_scope` to
  every step, so `permissions` is unenforceable there too.
- The decision ledger reuses a ruling only inside a git repository whose tree has no uncommitted changes.
- Nothing carries an isolated step's result back to the folder. The engine writes the step's diff to the artifact named
  `patch`, if the workflow defines one, and removes the worktree when the run ends. A developer applies the patch with
  git; a person with a folder of documents has no equivalent, so isolation protects the folder and then throws the work
  away.
- Two specs written alongside this one assumed git: `step-variants` (valid only with `isolation: git_worktree`) and
  `step-budgets` (a stopped step keeps its worktree so it can be resumed).

What a step needs is not git. It needs an isolated working copy, a list of what changed in it, a way to land the result in
the folder, and a way to keep or discard it. Git is one way to provide those four things. This spec makes the four things
a contract, keeps git as one implementation, and adds a second one that needs nothing but a folder.

## 2. User stories

- **US-01.** As a person who runs a task on a folder of documents, I want the agent to work on a copy, so that a failed
  or mistaken run leaves my folder exactly as it was.
- **US-02.** As the author of a workflow, I want `permissions` and the `diff_within_scope` and `git_diff_empty` guards to
  protect a folder that is not a git repository as much as one that is.
- **US-03.** As a person whose task finished, I want to be shown what changed (added, changed, removed) and to decide
  whether it goes into my folder, is kept for later, or is thrown away.
- **US-04.** As a person, I want Indaba to refuse to overwrite a file I changed while the task ran, and to leave my folder
  untouched when it refuses or fails halfway.
- **US-05.** As a person who is not a developer, I want every message about this to say what happened and what to do next
  in plain words, without "git", "worktree", "diff" or "patch".
- **US-06.** As a developer, I want everything I already do with `git_worktree` to behave as before.
- **US-07.** As the author of a workflow that uses variants or resumes after a budget stop, I want those to work in a
  folder without git.
- **US-08.** As a person who debates with agents about a folder, I want a ruling I already gave to be reused when the
  folder has not changed, as it is in a repository.
- **US-09.** As a developer embedding the engine, I want one contract that both kinds of workspace satisfy, so that
  guards, variants, budgets and a front end do not care which kind they have.

## 3. Acceptance criteria

**Isolation `copy`**

- [ ] AC-01. `isolation` accepts `copy` besides `none` and `git_worktree`. A step with `isolation: copy` runs in a copy of
  the project directory under `.indaba/worktrees/<taskId>[-<variant>]`. The project directory does not need to be a git
  repository. Steps that depend on an isolated step run in the same copy, as with `git_worktree`. The copy is made once
  per run, when the first step that needs it starts.
- [ ] AC-02. All isolated steps of a workflow, declared or inherited through `depends_on`, use the same kind. A workflow
  mixing `copy` and `git_worktree` fails validation naming the two steps and saying that one run keeps one working copy
  (message 4, section 8).
- [ ] AC-03. A workflow may have a top-level `copy` mapping with `include` and `exclude` (lists of globs relative to the
  project directory, in the glob language of `permissions`), and `max_files`, `max_bytes` and `max_file_bytes` (positive
  integers). It is valid only when some step has `isolation: copy`; otherwise validation fails naming the field.
  Absent fields take the defaults of AC-05.
- [ ] AC-04. `.indaba/`, `.indaba-decisions/` and `.git/` are never copied and cannot be included. Everything else is
  copied unless `include` and `exclude` say otherwise: when `include` is non-empty only matching paths are copied, and
  `exclude` removes paths from that set. Excluded paths are not part of any change, and landing never touches them.
- [ ] AC-05. The limits default to `max_files` 20000, `max_bytes` 1073741824 (1 GiB) and `max_file_bytes` 268435456
  (256 MiB). They are design choices, not measurements (C-04). They are checked in a scan before any file is copied. A
  tree over a limit fails the step with message 2, nothing is copied, and no directory is left behind.
- [ ] AC-06. A symbolic link, a Windows junction or any file that is not a regular file or a directory is never followed
  and never copied. The scan counts them, and the run reports the count once, in plain words (message 3).
- [ ] AC-07. The copy's directory name is built from the task id and the variant, passes the same strict name check as a
  worktree's (`^[A-Za-z0-9][A-Za-z0-9._-]*$`, no `..`), must resolve inside `.indaba/worktrees`, and must not exist.
- [ ] AC-08. Each file is read once while it is copied and hashed with SHA-256 in the same pass. No file is held whole in
  memory. The executable bit is preserved on systems that have one. Modification times are not preserved and are never
  used to decide whether a file changed.
- [ ] AC-09. Removing the copy is idempotent, runs when the run completes, fails or is cancelled (unless the copy is kept,
  AC-21), and is not cancelled by the run's abort signal.

**What changed**

- [ ] AC-10. `changes()` on a copy scans the copy again, hashes every regular file, and compares the result with the
  baseline: the copy as it was created, or the snapshot named by `since`. It returns the files added, modified and
  deleted, sorted by path (byte order, `/` as the separator on every system). A file is modified when its SHA-256 or its
  executable bit differs. A file rewritten with identical content is not a change. There is no modification-time
  shortcut, because an agent can set a time.
- [ ] AC-11. A link or special file found in the copy that was not in the baseline is reported as a change with entry
  `link`. It is never followed.
- [ ] AC-12. The scan in `changes()` obeys the limits of AC-05. A copy that has grown past them (an agent that wrote a
  million files) makes `changes()` fail with message 2 adapted to the copy, so a guard fails closed.
- [ ] AC-13. Paths are compared exactly. On a case-insensitive filesystem a rename that only changes case is reported as a
  deletion and an addition.
- [ ] AC-14. The change list has one shape for both kinds. A git worktree fills `path`, `kind` and `entry` (from
  `git status --porcelain=v1 -z --untracked-files=all`, `.indaba` excluded, a rename reported as a deletion and an
  addition); a copy also fills `before` and `after` (size, SHA-256, executable bit).
- [ ] AC-15. `snapshot()` returns a handle for the workspace's current contents; `changes(since)` and `diff(since)` measure
  from it. The handle of a copy is the SHA-256 of its manifest. A handle this workspace did not produce, or one from before
  a restart, fails with a message that says to take a new snapshot.
- [ ] AC-16. `diff()` of a copy returns a plain-text change report (one line per change with its kind, path and size), not
  a unified diff, because the contract says what changed and the copy has no text-diff dependency (C-13). The artifact named
  `patch` then holds that report for a copy and the unified diff for git, as the documentation says.

**Landing the result in the folder**

- [ ] AC-17. `landInProject()` first compares every path in the change list with the project directory. A modified or
  deleted file must still have the content the copy started from. An added file must not exist in the folder, or must
  already have the new content. Any other state is a conflict: nothing is written, the result lists the first 10 files
  and the number of the rest (message 5), and the copy is kept.
- [ ] AC-18. A change list that contains a `link` entry, a path that is not portable (AC-27), or an entry outside the
  project directory is refused whole, before any write, with message 6.
- [ ] AC-19. Landing is staged. Each new or changed file is written to a temporary file next to its target; when all are
  written, each replaced or deleted file is first moved to `.indaba/landing/<name>/before/`, then the new files are renamed
  into place, then deletions are completed. Any failure restores the moved files and removes the added ones. A failed
  restoration is reported with the files it could not restore and where their earlier copies are. On success the staging
  directory and `before/` are removed: there is no undo (C-08).
- [ ] AC-20. A journal `.indaba/landing/<name>.json` is written before the first file is moved and removed after the last
  step. A leftover journal found by `indaba apply` or the start of a run is rolled back first, with message 7.
- [ ] AC-21. The workflow field `defaults.apply` is `ask`, `auto` or `never`. When it is absent the default is `ask` for a
  `copy` run and `never` for a `git_worktree` run, which keeps today's behaviour. `indaba run --apply ask|auto|never`
  overrides it. It takes effect only when the run completes. `never` removes the copy as today. `auto` lands without
  asking and still refuses a conflict. `ask` shows message 8 and accepts `apply`, `keep` or `discard`.
- [ ] AC-22. When nobody can answer (no terminal, no front end that answers questions, a cancel) `ask` keeps the copy,
  prints where it is and how to land it (message 9), and the run still ends `completed` with exit code 0.
- [ ] AC-23. A kept copy is described by `.indaba/worktrees/<name>.workspace.json` (`data-model.md`). `indaba apply <name>`
  lands it, `indaba apply <name> --dry-run` shows the changes without landing, `indaba apply <name> --discard` removes it,
  and `indaba apply` with no name lists the kept copies. Landing a kept copy repeats the check of AC-17 against the folder
  as it is now.
- [ ] AC-24. Landing a git worktree uses the existing `PatchService` against the project directory (`git apply --check`,
  then apply), is reached only through the same `defaults.apply` and `indaba apply`, and reports a conflict with message
  5. Nothing is half-applied.
- [ ] AC-25. The summary shown for a decision (message 8, `--dry-run`) lists at most 200 lines, then the number of the
  rest, with the sizes of files. It never shows file contents.

**Guards, permissions, names**

- [ ] AC-26. `Guard.check` takes an optional third parameter, a `GuardContext` with the workspace kind and `changes()`. The
  engine passes it for every step that runs in a tracked workspace. A guard written before this change ignores it.
- [ ] AC-27. A path in a change list that is not portable is refused by landing and reported by guards: it has a segment
  that is empty, `.` or `..`, contains a NUL, a colon or a backslash, ends with a space or a dot, or is a Windows reserved
  device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1` to `COM9`, `LPT1` to `LPT9`, with or without an extension). The rule is
  the same on every system, so a result is portable.
- [ ] AC-28. In a `copy` workspace, `diff_within_scope` and `git_diff_empty` compute their verdict from `changes()`. With a
  git worktree they run the git commands they run today. A change outside the allowed `paths`, or under the guarded
  `paths`, fails the step with the list of files, in words that do not mention git (message 10).
- [ ] AC-29. For a copy, a `paths` entry is a glob in the language of `permissions`; an entry without glob characters
  matches that path and everything under it. Git pathspec magic is not supported, and the documentation says this is the
  one difference from the git implementation of `git_diff_empty`.
- [ ] AC-30. In a step that is not isolated and runs in a folder that is not a git repository, these two guards fail closed
  with message 11, which says why and suggests `isolation: copy`.
- [ ] AC-31. `permissions` on a step adds `diff_within_scope` as today, and it works in a `copy` workspace. `indaba validate`
  warns when a step declares `permissions` without `isolation: git_worktree` or `isolation: copy` (message 12). The ACP
  permission gate is unchanged and is confined to the step's working directory, which for a copy is the copy.

**The decision ledger**

- [ ] AC-32. In a folder without a git repository with a commit, the key of a ruling is the digest of the workflow name, the
  step, the question and a fingerprint: the SHA-256 of the sorted list of (path, size, SHA-256 of content) of every file
  outside `.indaba/`, `.indaba-decisions/` and `.git/`. A folder over the default limits of AC-05 has no key, and the span
  says so (message 13). In a git repository the key is computed as today.
- [ ] AC-33. A ledger line may carry `basis: "folder"`; a line without `basis` is a git line. Readers of old lines are
  unaffected and a git repository never reads or writes a folder key.

**Plain language and compatibility**

- [ ] AC-34. The messages of section 8 are the wording used, and none of those about a `copy` workspace contains "git",
  "worktree", "diff" or "patch" (the directory name in a path is literal and is not wording).
- [ ] AC-35. A workflow that uses only `none` and `git_worktree` runs as before. The only differences are the new span
  attributes of `events.md`.
- [ ] AC-36. `step-variants` works on either kind of workspace, and `step-budgets` keeps and resumes the workspace of
  either kind (section 9).

## 4. Non-goals

Load-bearing: a working-copy feature grows into a version-control system one convenience at a time.

- No history, branches or undo of a folder. A successful landing keeps nothing; this is not a small git (C-08).
- No merging of two sets of edits to one file. A file changed on both sides is a conflict the person resolves.
- No syncing, no watching a folder for changes, no two runs coordinating through locks. Two runs on one folder are caught
  by the check before landing, and a change between that check and the rename of one file is a race this spec narrows
  (AC-19) and does not close.
- No cloud or remote storage, no network drives promised to behave: the behaviour on them is whatever the filesystem does.
- No copy-on-write or overlay filesystem. A copy reads and writes every file. It is a possible later optimization, kept out
  because it differs on every operating system.
- No partial-file diffs or patches, and no text diff of a changed file. A changed file is a whole new file.
- No renaming detection. A rename is a deletion and an addition.
- No change to what `git_worktree` does today, and no automatic choice between the two kinds.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| `git_worktree` in a folder that is not a git repository | the run does not start; message 1 names the step and suggests `isolation: copy` |
| the folder is over a limit | creation fails before copying; message 2 names the limit, what was found and how to change it |
| a file cannot be read (open in another program, no permission) | creation fails naming the file and telling the person to close it; the partial copy is removed |
| the disk fills while copying | creation fails; the partial copy is removed |
| a path is too long for the system | creation fails naming the path; on Windows the extended-length form is tried first (C-17) |
| the process dies while the copy is being made | a directory without a record remains under `.indaba/worktrees/`; it holds only copies, and removing it is safe (`docs`) |
| a guard cannot compute the change list | the guard fails closed with the reason, never a pass |
| a result contains a link or an unsafe name | landing is refused whole before any write (AC-18) |
| the folder changed while the task ran | landing is refused, nothing is written, the copy is kept (AC-17) |
| a write fails during landing | everything done is restored (AC-19); the copy is kept |
| restoring fails too | reported with the files and the location of their earlier copies; the copy is kept; the journal stays |
| the process dies during landing | the next `indaba apply` or run start rolls back from the journal (AC-20) |
| the run is cancelled | the copy is removed unless it was kept; a landing already begun is completed or rolled back, never left half-done |
| nobody can answer the question | the copy is kept and the person is told how to land it (AC-22) |
| the run fails or escalates | the copy is removed as a worktree is today, unless `step-budgets` keeps it for a resume |

## 6. Security and data handling

**Everything inside a copy is untrusted output of an agent.** File names, contents, links and sizes are written by a model.
Names are validated by one portable rule (AC-27), compared as text and never interpolated into a command, which is never
run: this feature starts no process of its own (the git implementation keeps its argument-array wrapper).

**Paths are confined to their roots.** The copy lives under `.indaba/worktrees/`; landing writes only under the project
directory. Every path from a change list is resolved against its root and rejected if the result leaves it, if any existing
component of the target is a link, or if the name is not portable. Links are never followed in either direction: not when
scanning the folder, not when scanning the copy, not when landing. A link an agent creates is reported as a change and
blocks landing. Windows junctions are treated as links.

**Hostile trees are bounded.** The scan and the hashing are limited by `max_files`, `max_bytes` and `max_file_bytes`;
`changes()` re-checks them after the step. Hashing streams. A scan that is cancelled stops and leaves nothing.

**No secrets in telemetry.** Events carry counts, kinds and sizes. A path appears in at most the first 20 entries of an
event, cut at 200 characters and passed through the redaction already used for the event stream. File contents are never
read into an event, a span or a message. The change report artifact lists paths and sizes; it is under `.indaba/`.

**Isolation is of files, not a boundary.** A copy protects the folder from a mistake, not from a hostile agent, which runs as
the same user and can read the folder directly. The documentation says so and does not call a copy a sandbox. The guards
check the copy after the step, as they check a worktree.

**The landing journal and `before/` contain the folder's own files**, never more than the run changed. They are under
`.indaba/`, removed on success, and not committed.

## 7. Where it lives

- `@indaba/core` (pure; no `node:` module, no I/O): the `Isolation.Copy` member; `WorkspaceKind`; the change-list types
  (`FileFingerprint`, `FileChange`, `ChangeSet`); the pure functions `changesOutsideScope`, `changesUnderPaths` and
  `isPortableRelativePath`; `GuardContext` and the optional third parameter of `Guard.check`; `ApplyPolicy`; the workflow
  fields `copy` and `defaults.apply`. Hashing needs `node:crypto`, so it is not here.
- `@indaba/engine`: `TrackedWorkspace` and `TrackedWorkspaceManager` (the new optional interfaces; `Workspace` and
  `WorkspaceManager` are unchanged); `CopyWorkspaceManager` and `CopyWorkspace` (scan, copy, manifest, `changes`,
  `snapshot`, `fork`, `land`, `landInProject`, `keep`); the lander with its journal; the `GitWorktree` additions
  (`changes`, `fork`, `land`, `landInProject` through `PatchService`); the guards using the context; the ledger's folder
  fingerprint; the parser and validator; the kept-workspace record.
- `indaba` (CLI): `indaba apply`, `--apply`, the question and its terminal prompt, the `validate` and `plan` messages, the
  composition root registering the copy manager. A front end other than the terminal answers the question through the
  channel of `specs/ruling-channel`; this spec does not depend on it being built (AC-22).
- Contract between them: the `TrackedWorkspace` interface of `api-surface.md`; nothing in `@indaba/core` knows a folder.

## 8. Clarifications

All recommendations; the maintainer confirms.

- **C-01. The contract is a new optional interface, not a wider `Workspace`.** `Workspace` and `WorkspaceManager` are
  exported from `@indaba/engine`, and adding a required method to an interface that others implement is a major. So
  `TrackedWorkspace extends Workspace` carries `kind`, `changes`, `fork`, `land`, `landInProject` and `keep`, and
  `TrackedWorkspaceManager` carries `kind` and a `create` that returns it. Both built-in kinds implement them, nothing
  else changes, and a custom `Workspace` keeps working for steps that need none of the new things (an isolated step with a
  guard, variants, a landing, or `copy` all need a tracked workspace and fail with a clear message if given a plain one).
  `snapshot` and `diff(since)`, which `step-variants` first put on `Workspace`, are members of `TrackedWorkspace` for the same
  reason. Alternative rejected: widening `Workspace`.
  The engine option `workspaces` keeps meaning "the manager for `git_worktree`"; a new optional `copyWorkspaces` is the
  manager for `copy`.
- **C-02. The name is `copy`; there is no automatic fallback.** `isolation: copy` says what happens. `auto` was rejected: a
  run that silently uses a different protection depending on the folder is a run whose behaviour cannot be predicted from
  its file, and the guards differ in small ways (AC-29). A `git_worktree` step in a folder without git fails at validation
  with message 1, which tells the person the one-word change. `snapshot` or `sandbox` were rejected as names that suggest
  more than a copy.
- **C-03. What is copied.** Everything except `.indaba/`, `.indaba-decisions/` and `.git/`, which are never copied. Excluding
  folders by name (`node_modules`, `.venv`, `dist`) was rejected: it hides data, differs by ecosystem, and surprises a
  person whose folder happens to use such a name. A heavy folder is handled by the limits, whose message lists the folders
  that hold the most files and suggests `copy.exclude`. `include` and `exclude` are globs in the language `permissions`
  already uses, so a person learns one.
- **C-04. The limits are unmeasured.** 20000 files, 1 GiB and 256 MiB are chosen to keep a copy to seconds on an ordinary
  disk and to stop a mistake (pointing a task at a home directory) early. They are design choices written down as such, per
  the rule on invented numbers, and the message that reports a limit says how to raise it. The scan is a separate pass so a
  refusal costs a directory walk and no copying.
- **C-05. SHA-256 from `node:crypto`, always re-hashed.** No dependency is added. A modification-time and size shortcut for
  unchanged files was rejected: an agent can set a time, and a guard that can be fooled is not a guard. The price is one more
  read of the whole copy per `changes()` call; the limits bound it, and the engine asks once per guard per step, not per file.
- **C-06. Placement.** `.indaba/worktrees/<name>`, the root `GitWorktreeManager` uses, with the same name check. A sibling
  folder next to the project was rejected: it puts files outside the project, outside the confinement check, and in the
  person's way. The copy is inside the project directory it copies, which is safe because `.indaba/` is never copied.
- **C-07. Links are skipped going in and refused coming out.** Following links would let a copy reach outside its root;
  copying them as links would let a result create one that points anywhere. So a link in the folder is not copied (and is
  counted), and a link in the result is a reported change that blocks landing. Junctions are links. Special files are
  skipped.
- **C-08. Landing refuses conflicts, is staged and keeps no history.** Overwriting a file the person changed would be the
  worst thing this feature could do, so any difference from the starting content is a conflict that stops everything
  before a write. The staged order (write temporary files, move originals aside, rename into place, finish deletions) means
  a failure at any point can be reversed from `before/`. The `before/` copies are removed on success: keeping them would be a
  second copy of the folder and an undo feature that is not asked for. The race between the check of a file and its rename
  is narrowed by re-checking each file immediately before it is moved, and is not closed, because closing it needs locks the
  platforms do not give a plain folder. The journal makes a crash recoverable.
- **C-09. When results land.** Only a run that completes can land. `defaults.apply` defaults to `ask` for `copy`, which is
  new, and to `never` for `git_worktree`, because changing what an existing kind does after a run would be a changed
  default and a major. A developer who wants landing for git sets `ask` or `auto`. `ask` is a question to a person and so
  has the same two properties as the human arbiter: it uses the terminal when there is one and a front end's channel when
  there is one, and when nobody can answer the safe outcome (keep and say how) is taken.
- **C-10. Guard names and routing.** `git_diff_empty` and `diff_within_scope` keep their names; renaming them is a major, and
  an alias adds a name to learn for no new behaviour. The documentation says they are guards on a step's working copy. A
  git worktree keeps its git code path untouched, which makes AC-35 easy to test; a copy uses the pure functions over its
  change list. Sending both through the change list was rejected for the risk to behaviour that works. The known
  difference is AC-29, and a later change can align the git side. Guards today see everything changed in the shared
  workspace since it was created, not only what the current step changed; that stays true for both kinds, because
  measuring from the step's start would be a changed behaviour.
- **C-11. `permissions` in a folder.** The implicit `diff_within_scope` guard works unchanged through the context. The
  validate warning says `isolation: git_worktree` or `isolation: copy`. A step that is not isolated still has no boundary,
  and says so (message 11).
- **C-12. The ledger in a folder.** The key is a content fingerprint, so the "uncommitted changes" refusal does not apply:
  the files being judged are pinned by their hashes, which is stronger than a clean tree. The cost is hashing the folder once
  per debate step, bounded by the default limits; over them the ruling is recorded and never reused.
- **C-13. `diff()` of a copy is a report.** The contract says what changed, not how a text file's lines changed. A unified
  diff needs an algorithm or a dependency, and it is useless for a document or an image. The report lists kind, path and
  size. Text diffs for text files are a candidate for a later change.
- **C-14. One workspace per run, so settings are per run.** The engine already creates a single workspace for all isolated
  steps. So `copy` is a top-level mapping, and mixing kinds is an error (AC-02), instead of per-step settings that could
  disagree.
- **C-15. Snapshots and forks serve variants.** `snapshot()` returns an opaque string (a manifest digest for a copy, a tree id
  for git), the workspace remembers the manifests it produced in memory, and `fork(label)` makes a workspace of the same
  kind that starts from the current contents. `land(from, since)` puts a fork's changes since `since` into this workspace by
  the same staged procedure as `landInProject`, and refuses if this workspace is no longer as it was at `since`.
- **C-16. Landing for git is included.** `PatchService` exists and is unused. Without it the two kinds would not satisfy one
  contract. It is reached only through `defaults.apply` and `indaba apply`, never by default, so no existing run changes.
- **C-17. Windows.** Operations on a copy use the extended-length path form so long paths work without a system setting; if
  a path still fails, the message names it. Names that Windows reserves, end with a dot or a space, or contain a colon are
  refused everywhere (AC-27), so a result made on one system lands safely on another. Locked files fail creation with the
  file named. Case-insensitivity is handled by exact comparison (AC-13).
- **C-18. Telemetry is small.** Counts and kinds, never contents; at most 20 paths (`events.md`).

**The messages** (message 1 to 13). Each is one or two sentences, names the thing, and says what to do. `<...>` is filled in.

1. `Step "<step>" cannot use isolation: git_worktree because <folder> is not a git repository. Change it to isolation: copy, which works in any folder.`
2. `The folder has more than <limit> <files|bytes> (found <n>). Indaba copies the folder so your files stay safe while the task runs. Narrow it with copy.include or copy.exclude in the workflow, or raise copy.<field>. Folders with the most files: <a> (<n>), <b> (<n>).`
3. `<n> shortcuts (symbolic links) were not copied. Indaba never follows shortcuts.`
4. `Steps "<a>" and "<b>" use different kinds of working copy (<kindA> and <kindB>). A run keeps one working copy: use the same isolation for both.`
5. `Nothing was changed. These files in your folder changed while the task ran, so Indaba will not overwrite them: <f1>, <f2> (and <n> more). Run the task again, or compare the task's version, saved in <path>, and decide which to keep.`
6. `Indaba did not copy the result back because it contains <a shortcut (symbolic link) at <path> | a name that is not safe to copy: <path>>. Nothing was changed. The result is saved in <path>.`
7. `A copy-back that was interrupted last time was undone, so your folder is as it was before it started.`
8. `The task changed <n> files in <folder>: <a> added, <m> changed, <d> removed. Copy them into your folder? [a]pply, [k]eep for later, [d]iscard`
9. `The task finished. Its result is waiting in <path>. To copy it into <folder> run: indaba apply <name>. To see what changed first run: indaba apply <name> --dry-run.`
10. `The step changed files it was not allowed to change (<allowed>): <f1>, <f2> (and <n> more).` The allowed list reads `nothing` when it is empty.
11. `Indaba cannot see what step "<step>" changes, because the step works directly in your folder and the folder is not a git repository. Use isolation: copy so the step works on a copy.`
12. `Step "<step>" has permissions but no isolation, so they are checked only after the step has run. Add isolation: git_worktree or isolation: copy.`
13. `Indaba cannot tell whether the folder changed since the last ruling: it has more than <limit> files. The ruling is saved and will not be reused.`

Messages 1 and 11 name git on purpose: they are about a git repository that is missing, and the person is told what to do
instead. AC-34 covers the messages about a working copy.

## 9. Changes to other specs

Both edits are made in this change, are minimal, and keep every other decision of the spec they touch.

- **`specs/step-variants`.** AC-02 no longer requires `isolation: git_worktree`: it requires an agent step with `examine_with`
  and an isolation of `git_worktree` or `copy` declared on the step itself, in a workflow whose isolated steps all use one
  kind. A variant is seeded by `fork(label)` instead of "apply the step workspace's diff with `PatchService`", and the chosen
  candidate is carried into the step's workspace by `land(from, since)` instead of `PatchService.canApply` and `apply`. The
  git implementation of `fork` and `land` does what the old text did, so git behaviour is unchanged. `snapshot` and `diff(since)`
  move from `Workspace` to `TrackedWorkspace`, so `Workspace` stays unchanged. The validation row, the examiner snapshot check, the plan and the tasks are
  adjusted to say "workspace" and to name `fork` and `land`.
- **`specs/step-budgets`.** The kept working directory is "the workspace of whichever kind", and the resume file's description
  of the directory is not specific to git. AC-17 and its confinement paragraph name `.indaba/worktrees/` as the location for
  both kinds, and the kept-workspace record of this spec is the record the resume file points to. The `keep` and `adopt`
  that spec added to `WorkspaceManager` become `TrackedWorkspace.keep()` and `TrackedWorkspaceManager.adopt(name)`, so
  `WorkspaceManager` stays unchanged; its plan, tasks, data model and the "discarding" item now say so, and
  `indaba apply <name> --discard` answers the discard command that spec left open.

## Artifacts not written

- `research.md`: the design rests on the existing code and on `specs/git-workspace`; there is no external research to
  record.
