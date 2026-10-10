# Data model: Workspaces without git

What is kept on disk and in what shape. Everything is under `.indaba/` (gitignored runtime state) except the ledger, which
is committed. All files are UTF-8 JSON, written whole to a temporary file in the same directory and renamed into place.
Every reader validates the shape, a wrong `version` is an error naming the file, and a path in any file is checked to be
inside `.indaba/worktrees` (or the project directory, for `folder`) before it is used. Nothing here holds a secret or a
file's contents.

## The working copy

`.indaba/worktrees/<name>/`: the copy itself. `<name>` is `<taskId>[-<variant>]` and passes the name check of the git
manager. Created once per run. Not committed.

## The kept-workspace record

`.indaba/worktrees/<name>.workspace.json`, next to the copy and outside it, written by `keep()`:

```json
{
  "version": 1,
  "kind": "copy",
  "name": "run-7f3a",
  "taskId": "run-7f3a",
  "folder": "D:/documents/reports",
  "createdAt": "2026-10-10T20:41:07.000Z",
  "keptAt": "2026-10-10T20:44:52.000Z",
  "reason": "nobody_to_ask",
  "settings": { "include": [], "exclude": ["archive/**"], "maxFiles": 20000, "maxBytes": 1073741824, "maxFileBytes": 268435456 },
  "baseline": { "digest": "<sha256 of the manifest at creation>", "files": 412, "bytes": 18734012 },
  "summary": { "added": 1, "modified": 2, "deleted": 0 },
  "skipped": 3,
  "workflow": "weekly-report"
}
```

| Field | Meaning |
| :--- | :--- |
| `version` | `1` |
| `kind` | `copy` or `git_worktree`; for git the record only names the worktree and `baseline` is absent |
| `name`, `taskId` | the directory name and the run's task id |
| `folder` | absolute path of the project directory the copy came from, forward slashes. Landing refuses if the folder is no longer this path |
| `createdAt`, `keptAt` | ISO 8601 from the injected clock |
| `reason` | `asked` (the person chose keep), `nobody_to_ask`, `conflict`, `budget` (a stop that can be resumed), `chosen` |
| `settings` | the `CopySettings` in force, so a later landing and a resume read the same exclusions |
| `baseline` | the manifest digest at creation and its totals. The manifest itself is `<name>.manifest.json` (below) |
| `summary` | the change counts when kept |
| `skipped` | links and special files not copied |
| `workflow` | the workflow name, for the listing |

The record is not a security boundary: an agent running as the same user could edit it. The conflict check compares
content, not the record, so editing the record cannot make a landing overwrite a changed file.

## The baseline manifest

`.indaba/worktrees/<name>.manifest.json`, written at creation for a copy so a kept copy can be compared after a restart,
and read by `changes()` and `landKeptWorkspace`:

```json
{
  "version": 1,
  "entries": [
    { "path": "notes/todo.txt", "size": 214, "sha256": "<64 hex>", "executable": false },
    { "path": "reports/q3.docx", "size": 48213, "sha256": "<64 hex>", "executable": false }
  ]
}
```

- `entries` is sorted by `path` in byte order, `/` as the separator, unique, every path portable.
- Its digest is the SHA-256 of the canonical text `<path>\0<size>\0<sha256>\0<0|1>\n` for each entry in order. The same
  digest is the `WorkspaceSnapshot` of a copy.
- Size: about 150 bytes an entry; at the default limit of 20000 files about 3 MB. It is written once per snapshot a kept
  workspace needs, not per `changes()` call.
- Snapshots taken during a run (for variants) are held in memory under their digest and are not written, except the
  creation baseline.

## The landing journal

`.indaba/landing/<name>.json`, written before the first file is moved and removed after the last step:

```json
{
  "version": 1,
  "target": "project",
  "name": "run-7f3a",
  "startedAt": "2026-10-10T20:45:30.000Z",
  "phase": "renaming",
  "moved": ["reports/q3.docx"],
  "added": ["reports/q4.docx"],
  "deleted": []
}
```

| Field | Meaning |
| :--- | :--- |
| `target` | `project` or `workspace` (a fork landing into its parent; then `name` is the parent's) |
| `phase` | `staging`, `moving`, `renaming`, `deleting`; the last step known to have started |
| `moved` | paths whose originals are in `.indaba/landing/<name>/before/` |
| `added` | paths created by the landing, to be removed on rollback |
| `deleted` | paths whose deletion is complete |

`.indaba/landing/<name>/before/` holds the moved originals under their relative paths, and `.indaba/landing/<name>/stage/`
the temporary new files when they are not written beside their targets. Rollback moves every path in `moved` back and
removes every path in `added`, then removes the journal. A path in the journal that is not portable or that resolves outside
the target is refused and the rollback stops with the file named.

## The change report (`diff()` of a copy)

Plain text, one change per line, sorted: `added   reports/q4.docx   48213`, `changed  notes/todo.txt  214`,
`removed  old/draft.txt  1020`. Written to the artifact named `patch` when the workflow defines it. No contents.

## The decision ledger line

An existing JSONL line of `.indaba-decisions/<workflow>.jsonl` gains one optional member:

| Member | Meaning |
| :--- | :--- |
| `basis` | `"folder"` when `key` is a folder fingerprint; `"git"` or absent when it is built from git. `commit` is absent on a folder line |

A reader of an old line sees no `basis` and treats it as git. The key of a folder line is
`SHA-256(length-prefixed [workflow, stepId, topic, fingerprint])`, with the fingerprint the SHA-256 of the sorted
(path, size, content hash) list of the folder's files outside `.indaba/`, `.indaba-decisions/` and `.git/`. A git
repository never looks up or writes a folder key, and a folder never looks up a git key, because the lookup is by key and
the two are built from different inputs.

## Types added

In code: `FileFingerprint`, `FileChange`, `ChangeSet`, `CopySettings`, `KeptWorkspaceRecord` and `LandingQuestion` of
`api-surface.md`. The two JSON documents above are internal to `@indaba/engine`; their shape is a promise only to the next
version of Indaba reading them (a `version` field says which), not to other tools.
