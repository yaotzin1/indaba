# API surface contract: The local web view, step 3a (edit a workflow's source and save it)

> **Immutable during stage 6.** An implementation that finds this wrong stops and returns to stage 3; it does not edit
> this file.

## Semver classification

**Minor (below 1.0).** Additive: new declarations in `@indaba/core` (types only), three new HTTP resources, one new
optional option of `startServer`, one new optional dependency of `ui`. No existing export, route, field, option or
default changes meaning. `CONTRACT_VERSION` moves `1.1.0` to `1.2.0`.

## `@indaba/core` `web-contract` (types only)

```ts
/** One problem of a workflow text, as `indaba validate` words it. */
export interface WorkflowProblem {
  readonly message: string;
  /** 1-based, when the parser gives a position (YAML syntax); absent otherwise. */
  readonly line?: number;
  readonly column?: number;
}

export interface WorkflowSourceResponse {
  readonly workflow: WorkflowSummary;
  readonly text: string;
  /** SHA-256 of the file's bytes, lowercase hex: the `baseHash` of a later save. */
  readonly contentHash: string;
  readonly problems: readonly WorkflowProblem[];
}

export interface SaveWorkflowSourceRequest {
  readonly text: string;
  readonly baseHash: string;
}

export interface SaveWorkflowSourceResponse {
  readonly contentHash: string;
  readonly problems: readonly WorkflowProblem[];
}

export interface WorkflowChangedOnDisk extends ApiError {
  readonly code: 'changed_on_disk';
  readonly current: { readonly text: string; readonly contentHash: string };
}

export interface CheckWorkflowRequest {
  readonly text: string;
}

export interface WorkflowCheckResponse {
  readonly problems: readonly WorkflowProblem[];
}
```

## `@indaba/server`

```ts
/** What the command line supplies so the server reads, checks and writes no workflow file itself. */
export interface WorkflowStore {
  /** Rejects with a `WorkflowStoreError`: `workflow_not_found`, `too_large`, `not_text`. */
  read(id: string): Promise<WorkflowSourceResponse>;
  /** Rejects with `workflow_not_found`, `too_large`, `changed_on_disk` (detail: current), `not_saved`. */
  save(id: string, request: SaveWorkflowSourceRequest): Promise<SaveWorkflowSourceResponse>;
  check(text: string): WorkflowCheckResponse;
}
export class WorkflowStoreError extends Error {
  constructor(readonly code: string, message: string, readonly detail?: Readonly<Record<string, unknown>>);
}
// ServerOptions gains one optional member:
//   readonly workflowStore?: WorkflowStore;   // without it the three resources answer 404 source_unavailable
/** The largest body of a source `PUT` or a check `POST`: 1 MiB of text, with room for JSON escaping. */
export const MAX_SOURCE_BODY_BYTES = 2 * 1024 * 1024;
/** The largest text, in UTF-8 bytes; the scan's limit. */
export const MAX_SOURCE_BYTES = 1024 * 1024;
```

Recognised by `name` and `code` as well as class, like `RunControlError`, for the same reason.

| Method and path | Needs | Answers |
| :--- | :--- | :--- |
| `GET /api/v1/workflows/{id}/source` | token | `200 WorkflowSourceResponse`; `404 workflow_not_found`; `413 too_large`; `422 not_text` |
| `PUT /api/v1/workflows/{id}/source` | token, `Origin`, JSON body | `200 SaveWorkflowSourceResponse`; `400`; `404`; `409 changed_on_disk` / `not_saved`; `413` |
| `POST /api/v1/workflows/check` | token, `Origin`, JSON body | `200 WorkflowCheckResponse`; `400`; `413` |

`{id}` matches `^[0-9a-f]{32}$` (the scan's ids) before use; anything else is `404`. `text` must be a string of at most
`MAX_SOURCE_BYTES` UTF-8 bytes and `baseHash` 64 lowercase hex, else `400` (`413` for size). `methodsOf` allows `PUT`
and `POST` on these paths only when `workflowStore` was given. Without it every one answers `404 source_unavailable`.

## `indaba` (CLI)

```ts
// UiDeps gains one optional member, supplied by main.ts:
//   readonly workflowStore?: (roots: readonly string[]) => WorkflowStore;
```

No new command or option. `indaba ui` help text adds that the page can edit a workflow file of a root.

## Log records (existing contract)

`cli.ui`: `workflow saved` (relative path, new hash, problem count), `a workflow could not be saved` (reason, never the
text). `server.workflows`: `save refused` (code). Never the text, the body or a hash of anything but the file.

## Not changed

No engine event, span attribute, workflow field, runner, guard or plugin contract. The parser is used as it is.
