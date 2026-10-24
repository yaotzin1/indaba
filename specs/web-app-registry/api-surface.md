# API surface contract: The registry's screens

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An implementation that finds
> this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**Minor (below 1.0).** Additive: new resources, new contract types, `CONTRACT_VERSION` `1.5.0` to `1.6.0`, a new optional
`RegistryControl` for the server. One behaviour widens: `indaba ui` also covers the per-user list of folders (spec C-01).
No workflow field, guard, runner, event or span attribute changes.

## `@indaba/core` web contract (declarations only; imports only `./`)

New file `src/web-contract/registry.ts`, exported from the contract index and the package index. It repeats the registry's
plain-data members instead of importing them (the contract may import only itself).

```ts
export type RegistryOriginView = 'scanned' | 'added' | 'created' | 'copied';

export type RegistryStateView =
  | { readonly state: 'valid' }
  | { readonly state: 'invalid'; readonly message: string }
  | { readonly state: 'missing'; readonly reason: string };

/** One workflow of the registry, hidden and missing ones included. No path of the machine: the root is named by `rootId`. */
export interface RegistryEntryView {
  readonly id: string;                    // 16 hexadecimal characters, exact
  readonly name: string;                  // the person's, else the workflow's, else the file's
  readonly project: string;
  readonly tags: readonly string[];
  readonly hidden: boolean;
  readonly path: string;                  // relative to its root, '/' separators
  readonly rootId: string;                // RegistryRootView.id
  readonly origin: RegistryOriginView;
  readonly copiedFrom?: string;           // an entry id
  readonly validation: RegistryStateView;
  readonly lastRun?: RunSummary;          // the existing type
  /** True when Remove is offered: the entry is missing, or was added by path and no scan would list it (registry C-08). */
  readonly removable: boolean;
}

/** A folder the registry covers. */
export interface RegistryRootView {
  readonly id: string;                    // first 16 hex of SHA-256 of the folder's path as the registry holds it (spec C-04)
  readonly name: string;                  // the folder's name
  readonly folder: string;                // the resolved folder, shown to its owner; local-only
  readonly readable: boolean;
}

export interface RegistryListResponse {
  readonly entries: readonly RegistryEntryView[];     // sorted by root, then path
  readonly roots: readonly RegistryRootView[];
  /** True when the last scan stopped at a limit, so the list may be incomplete. */
  readonly truncated: boolean;
}

export interface RegistryScanReportView {
  readonly rootId: string;
  readonly found: number;
  readonly added: number;
  readonly changed: number;
  readonly moved: number;
  readonly missing: number;
  readonly invalid: number;
  readonly truncated: boolean;
  readonly recovered: boolean;
}
export interface RegistryScanResponse {
  readonly reports: readonly RegistryScanReportView[];
}

/** `null` clears the person's value so the default shows again; an absent member is left alone. */
export interface RegistryAnnotateRequest {
  readonly name?: string | null;
  readonly project?: string | null;
  readonly tags?: readonly string[];
  readonly hidden?: boolean;
}

export interface RegistryCopyRequest {
  readonly rootId: string;
  readonly name?: string;                 // a file name without folders or extension, [A-Za-z0-9._-], at most 80
}
export interface RegistryCopyResponse {
  readonly entry: RegistryEntryView;
  readonly toReview: readonly string[];   // one line each, as `indaba workflows copy` prints them
}

/** Step one of an import: what a typed path resolves to. Writes nothing. */
export interface RegistryResolveRootRequest {
  readonly path: string;                  // at most 1024 characters
}
export interface RegistryResolveRootResponse {
  readonly folder: string;                // the resolved folder, shown back
  readonly name: string;
  readonly alreadyCovered: boolean;
  /** Workflow files a bounded scan lists in it; `atLeast` when a limit stopped the count. */
  readonly found: number;
  readonly atLeast: boolean;
}

/** Step two: the person confirmed `folder` as shown. The server resolves it again and refuses a different result. */
export interface RegistryAddRootRequest {
  readonly folder: string;
}
export interface RegistryAddRootResponse {
  readonly root: RegistryRootView;
  readonly alreadyCovered: boolean;
  readonly report: RegistryScanReportView;
}
```

`CONTRACT_VERSION` is `1.6.0`. `WorkflowSummary` is unchanged.

## `@indaba/server`

```ts
/** What the command line supplies so the server itself spawns and writes nothing (spec AC-10). */
export interface RegistryControl {
  list(): Promise<RegistryListResponse>;                       // scans when the last scan is old (registry AC-14); includes missing and hidden
  scan(): Promise<RegistryScanResponse>;                       // scans now
  annotate(id: string, request: RegistryAnnotateRequest): Promise<RegistryEntryView>;
  copy(id: string, request: RegistryCopyRequest): Promise<RegistryCopyResponse>;
  remove(id: string): Promise<void>;
  resolveRoot(request: RegistryResolveRootRequest): Promise<RegistryResolveRootResponse>;
  addRoot(request: RegistryAddRootRequest): Promise<RegistryAddRootResponse>;
}

/** A refusal of the control, by a `code` the server maps to a status and plain words. */
export class RegistryControlError extends Error {
  constructor(readonly code: RegistryControlErrorCode, message: string, readonly detail?: Readonly<Record<string, unknown>>);
}
export type RegistryControlErrorCode =
  | 'not_found' | 'outside_roots' | 'exists' | 'would_return' | 'not_a_workflow' | 'store_failed'
  | 'invalid_request' | 'not_a_folder';
```

`StartServerOptions` gains `registry?: RegistryControl`. A server without it answers `GET /registry` with `404 registry_unavailable` and a
write `405`, as the other optional resources do (amended in stage 6, see `review.md`).

### Resources (all behind the token, `Host`, and for writes a same-origin `Origin`)

| Method and address | Body | Answer | Refusals |
| :--- | :--- | :--- | :--- |
| `GET /api/v1/registry` | | `200 RegistryListResponse` | |
| `POST /api/v1/registry/scan` | none | `200 RegistryScanResponse` | `500 store_failed` |
| `POST /api/v1/registry/{id}/annotate` | `RegistryAnnotateRequest` | `200 RegistryEntryView` | `400 invalid_request`, `404 not_found` |
| `POST /api/v1/registry/{id}/copy` | `RegistryCopyRequest` | `200 RegistryCopyResponse` | `400`, `404`, `409 exists`, `422 outside_roots` |
| `POST /api/v1/registry/{id}/remove` | none | `204` | `404`, `409 would_return` |
| `POST /api/v1/registry/roots/resolve` | `RegistryResolveRootRequest` | `200 RegistryResolveRootResponse` | `400`, `422 not_a_folder` |
| `POST /api/v1/registry/roots` | `RegistryAddRootRequest` | `200 RegistryAddRootResponse` | `400`, `422 not_a_folder`, `500 store_failed` |

`{id}` is 16 lowercase hexadecimal characters; anything else is `404`. The addresses `scan` and `roots` are matched before
`{id}`. The body is at most `MAX_BODY_BYTES`; unknown members are ignored; a member of the wrong type, a name or tag outside
the limits of spec C-03, or a file name outside the pattern is `400 invalid_request` naming the member.

`methodsOf` learns the new addresses so a wrong method is `405` with `Allow`.

## `indaba` (CLI)

- `packages/cli/src/run-control/registry.ts`: `createRegistryControl({ registry factory, rolesFile, finder, clock, logger })`.
  It holds the current registry and finder; `addRoot` writes the per-user list (the function `indaba workflows add` uses, moved
  to a shared module), builds a registry over the longer list and swaps the finder atomically, so a request in flight sees
  the old or the new one whole.
- `indaba ui` passes `registry` to the server and covers `--root` folders (or the current folder), then the per-user list
  folders that still exist (spec C-01). `indaba workflows` is unchanged.
- No new option, command or exit code.

## `@indaba/web` (private)

- `client.ts`: `registry()`, `scanRegistry()`, `annotate(id, request)`, `copyWorkflow(id, request)`, `removeEntry(id)`,
  `resolveRoot(path)`, `addRoot(folder)`, each answering a tagged result (`ok`, `refused` with a `code`, `unavailable`, `network`)
  as the other write calls do.
- `ui/WorkflowsScreen.ts`, `ui/WorkflowDialogs.ts`; `messages.registry`; route `workflows` (list) beside the existing
  `workflow` (one) route; a Workflows item in the header.

## Log records (existing contract)

`server.registry`: `annotated` (id), `copied` (source id, new id), `removed` (id), `scanned` (counts), `root resolved` (the
folder's name), `root added` (the folder's name, `alreadyCovered`), `refused` (action, `code`). Never a file's content or
a typed name or tag.

## Workflow schema, events and attributes

No change.
