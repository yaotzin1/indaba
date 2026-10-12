# API surface contract: The workflow registry

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**Minor (below 1.0).** All additions. `PluginHost` gains `registerRegistry`; a class that implements `PluginHost` needs the
method (a major for such implementers; only the engine implements it, and the changelog says so).

## Public symbols added

### `@indaba/core` (pure; no `node:` import, no I/O)

```ts
export type RegistryOrigin = 'scanned' | 'added' | 'created' | 'copied';
export type RegistryValidation =
  | { readonly state: 'valid' }
  | { readonly state: 'invalid'; readonly message: string }
  | { readonly state: 'missing' };

export interface RegistryRunRef {
  readonly traceId: string;
  readonly result: 'completed' | 'failed' | 'escalated' | 'cancelled' | 'stopped';
  readonly costKnown: boolean;
  readonly cost?: { readonly amount: string; readonly currency: string }; // absent when unknown; never zero for unknown
  readonly finishedAt: string;
}

export interface RegistryEntry {
  readonly id: string;                 // stable, opaque
  readonly root: string;               // the registered root (display only)
  readonly path: string;               // relative to the root, '/' separators
  readonly name: string;
  readonly project?: string;
  readonly tags: readonly string[];
  readonly hidden: boolean;
  readonly hash: string;               // SHA-256 of the file when last read
  readonly validation: RegistryValidation;
  readonly origin: RegistryOrigin;
  readonly copiedFrom?: string;        // an entry id
  readonly scannedAt: string;
  readonly lastRun?: RegistryRunRef;
}

export interface RegistryScanReport {
  readonly root: string;
  readonly found: number;
  readonly added: number;
  readonly changed: number;
  readonly missing: number;
  readonly invalid: number;
  readonly truncated: boolean;         // the file limit was reached
}

export interface RegistryAnnotation {
  readonly name?: string;
  readonly project?: string;
  readonly tags?: readonly string[];
  readonly hidden?: boolean;
}

export interface WorkflowRegistry {
  list(options?: { readonly includeHidden?: boolean }): Promise<readonly RegistryEntry[]>;
  get(id: string): Promise<RegistryEntry | undefined>;
  scan(options?: { readonly roots?: readonly string[]; readonly signal?: AbortSignal }): Promise<readonly RegistryScanReport[]>;
  addRoot(folder: string): Promise<void>;
  add(file: string): Promise<RegistryEntry>;
  annotate(id: string, annotation: RegistryAnnotation): Promise<RegistryEntry>;
  remove(id: string): Promise<void>;   // never deletes the file
  copy(id: string, to: { readonly folder: string; readonly name?: string }): Promise<RegistryEntry>;
}

export interface PluginHost {
  // ... existing members unchanged
  registerRegistry(registry: WorkflowRegistry): void;
}
```

### `@indaba/engine`

- `FileWorkflowRegistry implements WorkflowRegistry`: constructor takes the roots, the parser, a clock, an id generator and a
  file-system port (injected, so tests need no disk). Reads last runs through the trace reader of `specs/tui`.

### `indaba` (CLI)

`indaba workflows list [--json] | scan | add <folder-or-file> | remove <id> | copy <id> --to <folder> [--name <n>]`.

## Files

`.indaba/registry/index.json` under each root, and a per-user file of roots in the user's configuration folder. Both are
caches and annotations; neither holds a definition or a secret.

## Workflow schema, events and attributes

No change.
