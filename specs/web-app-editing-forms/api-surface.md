# API surface contract: The local web view, step 3b (edit a workflow through forms)

> **Immutable during stage 6.** An implementation that finds this wrong stops and returns to stage 3; it does not edit
> this file.

## Semver classification

**Minor (below 1.0).** Additive: new declarations in `@indaba/core` (types only) and one new optional field of an
existing response type, two new HTTP resources, one new optional option of `startServer`, one new optional dependency of
`ui`. No existing export, route, field, option or default changes meaning. `CONTRACT_VERSION` moves `1.2.0` to `1.3.0`.

The page's first view of a workflow changes from the text to the form when the text can be read (spec C-03). `@indaba/web`
is private and the source view is one press away, so no consumer's contract changes.

## `@indaba/core` `web-contract` (types only)

```ts
/** One problem of a workflow text. */
export interface WorkflowProblem {
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  /** Added in contract 1.3: the place the sentence is about, as the parser writes it (`$.steps[0].role`). */
  readonly path?: string;
}

/** A value as JSON carries it. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export interface JsonObject { readonly [key: string]: JsonValue }

/** Keys and indexes from the root: `['steps', 0, 'role']`. */
export type WorkflowPath = readonly (string | number)[];

/** One change of a workflow text, as `WorkflowDocument` of `@indaba/engine` makes it. */
export type WorkflowEdit =
  | { readonly op: 'set'; readonly path: WorkflowPath; readonly value: JsonValue }
  | { readonly op: 'remove'; readonly path: WorkflowPath }
  | { readonly op: 'addStep'; readonly step: JsonObject; readonly after?: string }
  | { readonly op: 'removeStep'; readonly id: string }
  | { readonly op: 'moveStep'; readonly id: string; readonly after?: string };

export interface EditWorkflowRequest {
  readonly text: string;
  /** Applied in order; empty reads the text without changing it. */
  readonly edits: readonly WorkflowEdit[];
}

export interface WorkflowEditResponse {
  /** The text after the edits. */
  readonly text: string;
  /** The document as plain JSON: what the form shows. */
  readonly value: JsonObject;
  /** The problems of `text`, as the check of step 3a gives them, each with its `path`. */
  readonly problems: readonly WorkflowProblem[];
}

/** `422`: the text cannot be read as a workflow document. */
export interface WorkflowNotEditable extends ApiError {
  readonly code: 'not_editable';
}

/** `422`: one edit was refused; nothing was changed. */
export interface WorkflowEditRefused extends ApiError {
  readonly code: 'edit_refused';
  /** The index in `edits` of the edit refused. */
  readonly index: number;
  /** The path the refusal is about, when it is about one. */
  readonly path?: string;
}

/** What this installation offers a workflow: `Catalog` of `@indaba/engine`, version 1, as the page receives it. */
export interface EditorCatalog {
  readonly catalog: 1;
  readonly runners: readonly Described[];
  readonly guards: readonly Described[];
  readonly arbiters: readonly Described[];
  readonly voters: readonly Described[];
  readonly prompts: readonly Described[];
  readonly values: {
    readonly decisionTypes: readonly string[];
    readonly isolation: readonly string[];
    readonly failureActions: readonly string[];
    readonly mcpPolicies: readonly string[];
    readonly promptAdditions: readonly string[];
  };
}

export interface EditorResponse {
  /** `workflowJsonSchema()`: JSON Schema draft 2020-12 of the workflow file. */
  readonly schema: JsonObject;
  readonly catalog: EditorCatalog;
}
```

`Described` is the existing `{ readonly name: string; readonly description: string }` of `@indaba/core`.

### Amendment of 2026-10-23 (stage 6 found it, stage 3 decided it)

`web-contract` imports only from its own folder (`core/test/web-contract.test.ts`), so it cannot name `Described` of
`mesh/`. `EditorCatalog` uses a local `CatalogEntry` with the same two fields; the two are structurally the same type,
so engine's `Catalog` is assignable to `EditorCatalog`.

```ts
export interface CatalogEntry { readonly name: string; readonly description: string }
// EditorCatalog's five lists are readonly CatalogEntry[]
```

## `@indaba/server`

```ts
/** What the command line supplies so the server applies no edit itself (spec AC-13). */
export interface WorkflowEditor {
  /** The schema and the catalog; the same answer for the life of the server. */
  info(): EditorResponse;
  /** Throws a `WorkflowEditorError`: `not_editable`, or `edit_refused` with detail `{ index, path? }`. */
  edit(request: EditWorkflowRequest): WorkflowEditResponse;
}

export class WorkflowEditorError extends Error {
  constructor(readonly code: string, message: string, readonly detail?: Readonly<Record<string, unknown>>);
}

// ServerOptions gains one optional member:
//   readonly workflowEditor?: WorkflowEditor;   // without it both resources answer 404 editor_unavailable

/** The most edits one request may carry. A starting value (spec C-07). */
export const MAX_EDITS = 64;
/** The most keys and indexes in one path. */
export const MAX_PATH_PARTS = 16;
/** The longest key, step id or `after`, in characters. */
export const MAX_KEY_LENGTH = 256;
/** How deep a value may nest; a scalar is depth 0. */
export const MAX_VALUE_DEPTH = 16;
```

Recognised by `name` (`WorkflowEditorError`) and `code` as well as class, like `WorkflowStoreError`, because the command
line does not import the optional `@indaba/server`.

| Method and path | Needs | Answers |
| :--- | :--- | :--- |
| `GET /api/v1/editor` | token | `200 EditorResponse`; `404 editor_unavailable` |
| `POST /api/v1/workflows/edit` | token, `Origin`, JSON body | `200 WorkflowEditResponse`; `400 bad_request`; `404 editor_unavailable`; `413 too_large`; `415`; `422 not_editable`; `422 edit_refused` |

The body of the `POST` is read with `MAX_SOURCE_BODY_BYTES`; `text` is checked as the check's is (a string of at most
`MAX_SOURCE_BYTES` UTF-8 bytes, else `400` or `413`). `edits` must be an array of at most `MAX_EDITS` items, each an
object whose `op` is one of the five, with:

- `path`: a non-empty array of at most `MAX_PATH_PARTS` items, each a string of at most `MAX_KEY_LENGTH` characters or a
  non-negative safe integer;
- `value` (for `set`) and `step` (for `addStep`, an object): JSON at most `MAX_VALUE_DEPTH` levels deep;
- `id` (a non-empty string) and `after` (absent, or a non-empty string), each of at most `MAX_KEY_LENGTH` characters.

Anything else is `400 bad_request`, with a sentence naming the index of the edit and never echoing a value. The server
passes a new object holding only these fields, so any other field of the body or of an edit never reaches the editor.
`methodsOf` allows `POST` on the edit path only when `workflowEditor` was given.

The store's `check` answer of step 3a gains `path` on its problems (contract 1.3), with no other change.

## `indaba` (CLI)

```ts
// UiDeps gains one optional member, supplied by main.ts:
//   readonly workflowEditor?: UiWorkflowEditor;
// UiWorkflowEditor (server-loader.ts) is the shape of WorkflowEditor, declared there because the server is optional.
```

`createWorkflowEditor` (`run-control/editor.ts`, internal to the CLI) builds it from the parser's `diagnose` and `parse`
(the store's), `workflowJsonSchema()` and `catalogOf` over the bundle of `indaba ui` with the arbiter `human` listed as
`indaba catalog` lists it. No new command or option; the `indaba ui` help text says the page can edit a workflow as a
form.

## Log records (existing contract)

`server.workflows`: `edit refused` (code, index). `cli.ui`: none per edit (an edit changes no file). Never the text, a
value, a path or a step id.

## Not changed

No engine export, event, span attribute, workflow field, runner, guard or plugin contract. `WorkflowDocument`,
`workflowJsonSchema` and `catalogOf` are used as `specs/workflow-editor` published them.
