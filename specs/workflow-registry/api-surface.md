# API surface contract: The workflow registry

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.
> Rewritten 2026-10-23 with the maintainer's decisions (`spec.md` section 8); this is slice 1.

## Semver classification

**Minor (below 1.0).** All additions. `PluginHost` gains an **optional** `registerRegistry` (spec C-09), so no
implementer of the interface breaks. The command line's `run-control/scan.ts` keeps its exports; its walk moves to
`@indaba/engine` as `scanWorkflowFiles`, unchanged in what it finds. A new command group, `indaba workflows`.

## `@indaba/core` (pure; no `node:` import, no I/O)

New file `src/registry/index.ts`, exported from the package index.

```ts
export type RegistryOrigin = 'scanned' | 'added' | 'created' | 'copied';

export type RegistryValidation =
  | { readonly state: 'valid' }
  | { readonly state: 'invalid'; readonly message: string }   // the first problem, one line, cleaned
  | { readonly state: 'missing'; readonly reason: string };   // plain words: "the file is gone", "the root cannot be read"

export interface RegistryEntry {
  readonly id: string;                  // 16 hex characters, stable (spec C-10)
  readonly root: string;                // the root, as given (absolute)
  readonly path: string;                // relative to the root, '/' separators
  readonly name: string;                // the person's, else the workflow's `name`, else the file's name
  readonly project: string;             // the person's, else the root folder's name
  readonly tags: readonly string[];
  readonly hidden: boolean;
  readonly hash: string;                // SHA-256 hex of the bytes last read; '' when never read (too large, missing)
  readonly validation: RegistryValidation;
  readonly readAt: string;              // ISO 8601, from the injected clock
  readonly origin: RegistryOrigin;
  readonly copiedFrom?: string;         // an entry id, for origin 'copied'
  readonly lastRun?: RunSummary;        // the web contract's type: runId, startedAt, status, workflow, cost (spec AC-12)
}

export interface RegistryScanReport {
  readonly root: string;
  readonly found: number;               // files the scan listed in this root
  readonly added: number;               // new entries
  readonly changed: number;             // entries whose bytes changed
  readonly moved: number;               // entries kept across a rename (spec AC-07)
  readonly missing: number;             // entries now missing
  readonly invalid: number;             // entries invalid after the scan
  readonly truncated: boolean;          // a limit stopped the scan
  readonly recovered: boolean;          // the index could not be read and was set aside as index.json.bak
}

/** `null` clears the person's value, so the default shows again. Absent leaves it as it is. */
export interface RegistryAnnotation {
  readonly name?: string | null;
  readonly project?: string | null;
  readonly tags?: readonly string[];
  readonly hidden?: boolean;
}

export interface RegistryCopy {
  readonly entry: RegistryEntry;
  /** Places of the copied file a person will usually change, one line each: "name: site", "steps[1].outputs: docs/x.md". */
  readonly toReview: readonly string[];
}

export type RegistryErrorCode =
  | 'not_found'          // no entry has this id
  | 'ambiguous'          // an id prefix names several (detail: the ids)
  | 'outside_roots'      // a path or folder is in no root, or reaches out of one through a link
  | 'not_a_workflow'     // add <file>: not a regular file, or over 1 MiB
  | 'exists'             // copy: the target file exists
  | 'would_return'       // remove: a scan would list it again (spec C-08)
  | 'store_failed';      // the store could not read or write its index

export class RegistryError extends IndabaError {
  constructor(readonly code: RegistryErrorCode, message: string, readonly candidates?: readonly string[]);
  // name: 'RegistryError'
}

export interface WorkflowRegistry {
  /** The roots this registry covers, in order. */
  roots(): readonly string[];
  /** The entries of every root, from the index; no scan. Hidden ones only with `includeHidden`. Sorted by root, then path. */
  list(options?: { readonly includeHidden?: boolean }): Promise<readonly RegistryEntry[]>;
  /** An entry by its id, or by the start of it when that names one entry; rejects `ambiguous`. */
  get(idOrPrefix: string): Promise<RegistryEntry | undefined>;
  /** Scans every root (spec AC-04 to AC-07) and writes the indexes; rejects with the signal's reason when aborted. */
  scan(options?: { readonly signal?: AbortSignal }): Promise<readonly RegistryScanReport[]>;
  /** Lists one file a scan would not find (another name); `outside_roots`, `not_a_workflow`. Idempotent. */
  add(file: string): Promise<RegistryEntry>;
  annotate(idOrPrefix: string, annotation: RegistryAnnotation): Promise<RegistryEntry>;
  /** Never deletes the file; `would_return` for a file a scan lists. */
  remove(idOrPrefix: string): Promise<void>;
  /** `<folder>/<name or the source's file name>.workflow.ai.yml`, the source's bytes, `wx`; `exists`, `outside_roots`. */
  copy(idOrPrefix: string, to: { readonly folder: string; readonly name?: string }): Promise<RegistryCopy>;
}

// PluginHost gains (optional, as registerLogSink is):
//   registerRegistry?(registry: WorkflowRegistry): void;   // the last one registered is used
```

`RunSummary` is the existing type of `@indaba/core`'s web contract.

## `@indaba/engine`

```ts
export interface FileWorkflowRegistryOptions {
  readonly roots: readonly string[];                        // absolute folders
  readonly parse: (source: string) => WorkflowDefinition;   // throws WorkflowValidationError, as `indaba validate`
  readonly clock: () => Date;
  readonly ids: () => string;                               // 16 hex characters
  readonly logger?: Logger;
}
export class FileWorkflowRegistry implements WorkflowRegistry {
  constructor(options: FileWorkflowRegistryOptions);
}
/** Where a root's index is, relative to the root. */
export const REGISTRY_INDEX = '.indaba/registry/index.json';

/** The walk of step 2, moved here (spec AC-04). */
export interface WorkflowFile {
  readonly root: string;
  readonly rootIndex: number;
  readonly path: string;     // relative, '/' separators
  readonly file: string;     // absolute
  readonly size: number;
}
export function scanWorkflowFiles(
  roots: readonly string[],
): Promise<{ readonly files: readonly WorkflowFile[]; readonly truncated: boolean }>;
export const SCAN_MAX_DEPTH: number;        // 4
export const SCAN_MAX_FILES: number;        // 200
export const SCAN_MAX_DIRECTORIES: number;  // 2000
export const DEFAULT_WORKFLOW: string;      // '.indaba/workflow.ai.yml'
export const MAX_WORKFLOW_BYTES: number;    // 1 MiB
```

### Amendment of 2026-10-23 (stage 6 found it, stage 3 decided it)

The command line's run control and store read a workflow through the same confined read, so it moves with the walk:

```ts
export function readWorkflowFile(root: string, file: string): Promise<Buffer>;  // regular file, inside root, ≤ 1 MiB
export class UnreadableWorkflow extends Error { readonly reason: 'missing' | 'too_large' }
export function tooLarge(): string;                                                // the sentence for a file over 1 MiB
```

The index file (version 1), one per root, never read by anything but `FileWorkflowRegistry`:

```json
{
  "registry": 1,
  "entries": [
    {
      "id": "3f2a9c1d0b7e4a65", "path": "site.workflow.ai.yml", "origin": "scanned",
      "hash": "<sha-256>", "size": 512, "mtimeMs": 1761200000000, "readAt": "2026-10-23T12:00:00.000Z",
      "workflowName": "site", "validation": { "state": "valid" },
      "name": null, "project": null, "tags": [], "hidden": false
    }
  ]
}
```

`name` and `project` hold the person's values (`null` when not set); `workflowName` is the file's. Unknown fields of an
entry are dropped on the next write; an entry with a field of the wrong type is dropped and found again by the next scan.
`.indaba/registry/.gitignore` holds `*`.

## `indaba` (CLI)

```
indaba workflows list [--json] [--all] [--plugin <spec>]...
indaba workflows scan [--json] [--plugin <spec>]...
indaba workflows add <folder-or-file> [--plugin <spec>]...
indaba workflows annotate <id> [--name <n>] [--project <p>] [--tag <t>]... [--no-tags] [--hide | --show]
                               [--clear-name] [--clear-project] [--plugin <spec>]...
indaba workflows remove <id> [--plugin <spec>]...
indaba workflows copy <id> --to <folder> [--name <n>] [--plugin <spec>]...
```

- Roots: the current folder, then the folders in `<user config>/indaba/workflow-roots.json` (beside the confirmations of `indaba ui`) (a JSON list of absolute
  paths, written whole) that still exist. `add <folder>` adds the folder there and scans it; `add <file>` lists a file.
- `list` scans first (incremental, AC-08), then prints one line per entry: id (8 characters, more when needed to be
  unique), state, name, project, path, last run. `--json` prints `{ "registry": 1, "entries": [...] }`.
- Exit codes: `0`; `1` for a refusal (`RegistryError`) or a store plugin's failure; `2` for a usage error.
- `indaba --help` lists `workflows`.

## Log records (existing contract)

`engine.registry`: `scan finished` (root, the counts of the report), `index set aside` (root), `entry copied` (source
and new id). `cli.workflows`: the command and its outcome code. Never a file's content.

## Workflow schema, events and attributes

No change.
