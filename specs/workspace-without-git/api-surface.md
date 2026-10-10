# API surface contract: Workspaces without git

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.
>
> Builds on the existing `Workspace`, `WorkspaceManager`, `GitWorktree`, `GitWorktreeManager` and `PatchService` of
> `@indaba/engine`, on `Guard` of `@indaba/core`, and on `specs/step-variants/api-surface.md`, which needs
> `snapshot()` and `diff(since)`. They are members of `TrackedWorkspace` below, not of `Workspace`.

## Semver classification

**A major in practice, shipped as the next minor below 1.0, with the changelog saying so; everything else is additive.**

| Change | Class |
| :--- | :--- |
| `Isolation` gains the member `copy` | **major in practice**: a consumer that switches on `Isolation` exhaustively stops compiling |
| `Guard.check` gains an optional third parameter | minor: an implementer written for two parameters is still valid and is called with three |
| `TrackedWorkspace` and `TrackedWorkspaceManager` as new interfaces that extend the old ones | minor: the old interfaces are unchanged (the `McpCapable` pattern of the `api_surface` skill) |
| `GitWorktree` and `GitWorktreeManager` implement the new interfaces | minor: classes gain members |
| `WorkflowDefinition` gains the optional `copy` and `defaultApply` | minor |
| `LedgerEntry` gains the optional `basis` | minor; an old line reads as git |
| new workflow fields, CLI command and option, span attributes, events | minor |
| `defaults.apply` absent means `never` for `git_worktree` | no change in behaviour, so no changed default |

The decision that keeps the rest from being a major: `Workspace` and `WorkspaceManager` are not widened (C-01 in
`spec.md`). If the maintainer prefers one interface, every method below moves onto `Workspace` and the classification is a
major with the changelog entry that says so.

## Public symbols added

### `@indaba/core` (pure; no `node:` import, no I/O)

```ts
export const Isolation = { None: 'none', GitWorktree: 'git_worktree', Copy: 'copy' } as const;   // Copy added
export type Isolation = (typeof Isolation)[keyof typeof Isolation];

/** The kinds of working copy a run can have. */
export const WorkspaceKind = { GitWorktree: 'git_worktree', Copy: 'copy' } as const;
export type WorkspaceKind = (typeof WorkspaceKind)[keyof typeof WorkspaceKind];

/** What to do with a finished run's changes. Absent in a workflow means `ask` for a copy and `never` for git. */
export const ApplyPolicy = { Ask: 'ask', Auto: 'auto', Never: 'never' } as const;
export type ApplyPolicy = (typeof ApplyPolicy)[keyof typeof ApplyPolicy];

/** What a copy takes and how much. */
export interface CopySettings {
  readonly include: readonly string[];       // globs relative to the project; empty means everything
  readonly exclude: readonly string[];       // globs relative to the project
  readonly maxFiles: number;                 // positive integer
  readonly maxBytes: number;                 // positive integer
  readonly maxFileBytes: number;             // positive integer
}
export const DEFAULT_COPY_SETTINGS: CopySettings;  // include [], exclude [], 20000, 1073741824, 268435456

export interface WorkflowDefinition {
  // ... existing members unchanged ...
  readonly copy?: CopySettings;              // absent when the file has no `copy` mapping; DEFAULT_COPY_SETTINGS applies
  readonly defaultApply?: ApplyPolicy;       // absent: per kind, see ApplyPolicy
}

/** A file's identity: content, not time. */
export interface FileFingerprint {
  readonly size: number;
  readonly sha256: string;                   // lowercase hex
  readonly executable: boolean;              // false where the system has no such bit
}

export const ChangeKind = { Added: 'added', Modified: 'modified', Deleted: 'deleted' } as const;
export type ChangeKind = (typeof ChangeKind)[keyof typeof ChangeKind];

export type EntryType = 'file' | 'link';     // a link is a symbolic link, a junction or a special file

/**
 * One change. `path` is relative to the working directory, uses `/`, and has been checked by
 * isPortableRelativePath. A git workspace sets `path`, `kind` and `entry` only; a copy also sets the fingerprints
 * (`before` for modified and deleted, `after` for added and modified). Absent means absent, not `undefined`.
 */
export interface FileChange {
  readonly path: string;
  readonly kind: ChangeKind;
  readonly entry: EntryType;
  readonly before?: FileFingerprint;
  readonly after?: FileFingerprint;
}

/** Sorted by `path` in byte order. `.indaba/` never appears. */
export interface ChangeSet {
  readonly changes: readonly FileChange[];
}

/**
 * Whether a path is safe to write on every system: each segment is non-empty and not `.` or `..`, has no NUL, colon or
 * backslash, does not end with a space or a dot, and is not a Windows device name (CON, PRN, AUX, NUL, COM1-COM9,
 * LPT1-LPT9) with or without an extension. A leading `/` is refused. The same answer on every platform.
 */
export function isPortableRelativePath(path: string): boolean;

/** The changes whose path matches none of `allowed` (globs of `permissions`). An empty list returns every change. */
export function changesOutsideScope(set: ChangeSet, allowed: readonly string[]): readonly FileChange[];

/**
 * The changes at or under one of `paths`. An entry with no glob character matches that path and everything below it;
 * otherwise it is a glob. An empty list means the whole working directory.
 */
export function changesUnderPaths(set: ChangeSet, paths: readonly string[]): readonly FileChange[];

/** What a guard may ask about the step's working copy. Passed when the step runs in a tracked workspace. */
export interface GuardContext {
  readonly workspaceKind: WorkspaceKind;
  /** Everything changed in the working copy since it was created. Rejects with WorkspaceError when it cannot be computed. */
  changes(): Promise<ChangeSet>;
}

export interface Guard {
  readonly type: string;
  check(guard: GuardDefinition, workdir: string, context?: GuardContext): Promise<GuardResult>;   // context added
}

/** A landing that did not happen or did not finish. `paths` is bounded to the first 50. */
export class LandingError extends WorkspaceError {
  constructor(
    message: string,
    readonly reason: 'conflict' | 'unsafe' | 'failed',
    readonly paths: readonly string[],
  );
}
```

`LedgerEntry` (declared in `@indaba/engine`) gains `readonly basis?: 'git' | 'folder'`; see below.

No new `PluginHost` method and no new registry: workspaces are wired by the composition root, as `workspaces` is today
(C-01). The extensibility rule holds because a custom `TrackedWorkspaceManager` can be passed to the engine exactly as the
built-in ones are.

### `@indaba/engine`

```ts
/** A handle for a workspace's contents at a moment (a git tree id, or a manifest digest for a copy). */
export type WorkspaceSnapshot = string;

/** A workspace that can say what changed in it, be forked, receive a fork's result, and be kept. Both built-ins implement it. */
export interface TrackedWorkspace extends Workspace {
  readonly kind: WorkspaceKind;
  /** A handle for the current contents. Equal contents give equal handles. Needs no commit. */
  snapshot(): Promise<WorkspaceSnapshot>;
  /**
   * What changed since `since`, or since creation when omitted: a unified diff for a git worktree, the plain change report
   * of `data-model.md` for a copy. Narrows `Workspace.diff()`, which takes no argument.
   */
  diff(since?: WorkspaceSnapshot): Promise<string>;
  /**
   * Everything changed since the workspace was created, or since `since` (a value from `snapshot()` of this workspace).
   * Rejects with WorkspaceError, never returns a partial list. A handle this workspace did not produce is rejected.
   */
  changes(since?: WorkspaceSnapshot): Promise<ChangeSet>;
  /** A new workspace of the same kind that starts from this one's current contents; its baseline is that state. */
  fork(label: string, signal?: AbortSignal): Promise<TrackedWorkspace>;
  /**
   * Puts the changes `from` made since `since` (a snapshot of `from` taken when it was forked) into this workspace.
   * Refuses with LandingError('conflict') if this workspace is no longer as it was then, ('unsafe') for a link or an unsafe
   * name, ('failed') after restoring what it had done. Nothing is half-applied.
   */
  land(from: TrackedWorkspace, since: WorkspaceSnapshot, signal?: AbortSignal): Promise<void>;
  /** Puts this workspace's changes into the project directory by the same staged procedure. See LandOptions. */
  landInProject(options?: LandOptions): Promise<LandResult>;
  /** Marks the workspace as surviving teardown and writes its record; `destroy()` then does nothing until discarded. */
  keep(): Promise<KeptWorkspace>;
}

export interface LandOptions {
  /** Check and report, write nothing. */
  readonly dryRun?: boolean;
  readonly signal?: AbortSignal;
}

export interface LandResult {
  readonly changes: ChangeSet;
  /** False for a dry run. */
  readonly applied: boolean;
}

export interface KeptWorkspace {
  readonly name: string;                     // the directory name under .indaba/worktrees
  readonly path: string;                     // absolute
  readonly kind: WorkspaceKind;
  readonly recordPath: string;               // absolute path of <name>.workspace.json
}

export interface WorkspaceCreateOptions {
  readonly settings?: CopySettings;          // read by a copy manager, ignored by git
  readonly signal?: AbortSignal;
}

export interface TrackedWorkspaceManager extends WorkspaceManager {
  readonly kind: WorkspaceKind;
  create(taskId: string, variant?: string, options?: WorkspaceCreateOptions): Promise<TrackedWorkspace>;
  /** Takes over a kept workspace of this kind by name (`specs/step-budgets` resume). Refuses a name with no valid record. */
  adopt(name: string): Promise<TrackedWorkspace>;
}

export function isTrackedWorkspace(workspace: Workspace): workspace is TrackedWorkspace;

export interface CopyWorkspaceOptions {
  readonly clock?: Clock;                    // @indaba/core; stamps records; default: the system clock at the composition root
}

/** Copies the project directory into .indaba/worktrees/<name> and tracks changes by content. Needs no git. */
export class CopyWorkspaceManager implements TrackedWorkspaceManager {
  readonly kind: 'copy';
  constructor(projectDir: string, options?: CopyWorkspaceOptions);
  create(taskId: string, variant?: string, options?: WorkspaceCreateOptions): Promise<TrackedWorkspace>;
}

// GitWorktreeManager and GitWorktree now also implement TrackedWorkspaceManager and TrackedWorkspace
// (kind: 'git_worktree'). Their existing members are unchanged.
```

```ts
/** The question asked when a run completes with `ask`. */
export interface LandingQuestion {
  readonly name: string;
  readonly folder: string;
  readonly summary: { readonly added: number; readonly modified: number; readonly deleted: number };
  /** At most 200, in path order; `more` is how many were left out. */
  readonly lines: readonly { readonly kind: ChangeKind; readonly path: string; readonly size?: number }[];
  readonly more: number;
}
export type LandingDecision = 'apply' | 'keep' | 'discard';

/** Asks a person. Resolves undefined when nobody can answer (no terminal, a cancel). */
export interface LandingDecider {
  decide(question: LandingQuestion, signal?: AbortSignal): Promise<LandingDecision | undefined>;
}

export interface WorkflowEngineOptions {
  // ... existing members unchanged; `workspaces` still means the manager for git_worktree ...
  readonly copyWorkspaces?: TrackedWorkspaceManager;   // the manager for `copy`; absent: a copy step fails (message 1's sibling)
  readonly apply?: ApplyPolicy;                        // the --apply override of the file's default
  readonly landing?: LandingDecider;                   // the CLI's terminal prompt; absent: `ask` keeps the workspace
}

/** Kept workspaces and interrupted landings, for `indaba apply` and the start of a run. */
export interface KeptWorkspaceRecord {
  readonly name: string;
  readonly kind: WorkspaceKind;
  readonly folder: string;
  readonly createdAt: string;                // ISO 8601
  readonly summary: { readonly added: number; readonly modified: number; readonly deleted: number };
}
export function listKeptWorkspaces(projectDir: string): Promise<readonly KeptWorkspaceRecord[]>;
export function landKeptWorkspace(projectDir: string, name: string, options?: LandOptions): Promise<LandResult>;
export function discardKeptWorkspace(projectDir: string, name: string): Promise<void>;
/** Rolls back a landing whose journal was left behind. Resolves the names it undid. */
export function recoverInterruptedLandings(projectDir: string): Promise<readonly string[]>;
```

`DiffWithinScopeGuard.check` and `GitDiffEmptyGuard.check` accept the optional `context`. With `workspaceKind: 'copy'`
they use `changesOutsideScope(await context.changes(), guard.paths)` and `changesUnderPaths(...)`; with no context or
`'git_worktree'` they run the git commands they run today; with no context in a folder that is not a git repository they
fail closed with message 11 of `spec.md`.

The decision ledger: `LedgerEntry.basis?: 'git' | 'folder'` (absent means `git`). `DecisionLedger.memoKey` returns, in a
folder without a git repository with a commit, a key built from the folder fingerprint (`spec.md` AC-32), bounded by
`DEFAULT_COPY_SETTINGS`; over the limits it returns `{ skipped: <message 13> }`. In a git repository it is unchanged.

`WorkflowEngine` stops using `workspaces` directly for isolated steps: it picks the manager whose `kind` matches the run's
isolation, calls the guards with a `GuardContext` built from the step's tracked workspace, applies `defaults.apply` after
a completed run, and starts a run by calling `recoverInterruptedLandings`. A step that needs a tracked workspace and is
given a plain `Workspace` fails with `WorkspaceError("This working copy cannot report changes; use the built-in ...")`.

### `indaba` (CLI)

| Addition | Behaviour |
| :--- | :--- |
| `indaba apply [name]` | no name: list kept copies (name, folder, created, counts). With a name: show the changes and ask whether to apply, keep or discard (message 8), see below |
| `indaba apply <name> --dry-run` | check and print the changes; write nothing; exit 0 unless the check finds a conflict (then 1) |
| `indaba apply <name> --discard` | remove the kept copy and its record; exit 0 |
| `indaba apply <name> --yes` | land without the prompt; for scripts |
| `indaba run --apply ask\|auto\|never` | `WorkflowEngineOptions.apply`; an unknown value is a usage error |

`indaba apply <name>` without `--yes` on a terminal asks the same question as a run (message 8) and without a terminal
refuses with a usage message that names `--yes`. Exit codes follow the other commands: 0 done, 1 refused or failed
(conflict, unsafe result, I/O), and the existing code for a usage error.

`indaba validate` and `plan` gain the messages 1, 2 (only when the folder can be scanned with `--workdir`), 4 and 12 of
`spec.md`, and `plan` prints each step's workspace kind. The composition root registers `CopyWorkspaceManager` as
`copyWorkspaces` and the terminal prompt as `landing`.

## Workflow schema

```yaml
version: "1.0"
name: "weekly-report"

copy:                       # optional; valid only when a step has isolation: copy
  include: []               # globs; empty means everything
  exclude: ["**/*.tmp", "archive/**"]
  max_files: 20000          # defaults shown; design choices, not measurements
  max_bytes: 1073741824
  max_file_bytes: 268435456

defaults:
  apply: "ask"              # ask | auto | never; absent: ask for copy, never for git_worktree

steps:
  - id: draft
    role: writer
    isolation: copy         # none | git_worktree | copy
    permissions:
      fs:
        write: ["reports/**"]
```

| Validation | Message |
| :--- | :--- |
| `isolation: git_worktree` where the working directory is not a git repository (checked by `run`, `plan` and `validate --workdir`) | message 1 |
| `isolation` is none of the three values | `<path>.isolation "<x>" is not supported` (existing wording) |
| a `copy` mapping without any step using `isolation: copy` | `copy: no step uses isolation: copy, so these settings are never used` |
| `copy.include`/`exclude` not a list of strings, a limit not a positive integer, an unknown key | the field path and the reason |
| two isolated steps of different kinds, declared or inherited | message 4 |
| `defaults.apply` is none of the three | `defaults.apply "<x>" is not supported (ask, auto or never)` |
| `permissions` without isolation | message 12 (a warning, as today) |

## Behaviour contract

- A workspace that is created is always destroyed or kept: on completion, failure, cancellation and a throw. Destruction
  is not cancelled by the abort signal.
- `changes()` is a function of the files at the moment of the call and the baseline; it takes no clock and no randomness.
  The list is sorted. Calling it twice with no change in between gives equal lists.
- `snapshot()` handles are values: equal contents give equal handles.
- Nothing in a change list, a message or an event contains file contents.

## What is not in this contract

- A text diff of a changed file; renaming detection; locks; history; remote storage (`spec.md` section 4).
- A new `PluginHost` registration. Workspaces are an engine seam wired by the composition root, as `workspaces` is now.
- The ruling channel: `LandingDecider` is the seam it would implement for a front end other than a terminal, and this
  contract does not depend on it.

## Checklist

- [ ] `@indaba/core` imports no `node:` module (`architecture.test.ts`); no hashing or file access is added to it
- [ ] `Workspace` and `WorkspaceManager` are unchanged; a test compiles a plain implementer of each
- [ ] A custom `Guard` written for two parameters still compiles and runs
- [ ] The `Isolation` change and the "major in practice" classification are in the changelog entry
- [ ] A workflow with only `none` and `git_worktree` produces the same outputs and spans as before, apart from the new
      attributes of `events.md` (a regression test pins one)
- [ ] `docs/workflow-format.md` documents `isolation: copy`, `copy`, `defaults.apply`, the one-kind rule, the guard
      difference of AC-29, `indaba apply`, and says a copy is not a sandbox
- [ ] `docs/extending.md` documents `TrackedWorkspace` and `GuardContext` for embedders and guard authors
- [ ] No `any`, no `!`, no suppression comment; no new runtime dependency
