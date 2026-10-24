# API surface contract: The local web view, step 3c (edit a workflow on the graph)

> **Immutable during stage 6.** An implementation that finds this wrong stops and returns to stage 3; it does not edit
> this file.

## Semver classification

**Patch (or minor bundle update of `@indaba/server`, below 1.0).** No exported TypeScript symbol, workflow field, CLI
command or option, HTTP route, event or span attribute changes in `@indaba/core`, `@indaba/engine`, `@indaba/runners`,
`@indaba/tui`, `@indaba/server` or `indaba`. All code changes are inside the private `@indaba/web` package, whose built
static files ship inside `@indaba/server`'s `page/` directory. `CONTRACT_VERSION` stays `1.3.0`.

## `@indaba/core`, `@indaba/engine`, `@indaba/runners`, `@indaba/server`, `indaba`

No change. The graph editor uses the `EditorResponse`, `WorkflowEdit`, `EditWorkflowRequest`, `WorkflowEditResponse` and
`WorkflowProblem` types and the `GET /api/v1/editor` and `POST /api/v1/workflows/edit` endpoints introduced in step 3b
([`specs/web-app-editing-forms/api-surface.md`](../web-app-editing-forms/api-surface.md)).

## `@indaba/web` internal modules (private package)

```ts
// src/graph-model.ts

/** The brick kinds the palette offers (spec AC-05, AC-06). */
export type StepBrickKind = 'agent' | 'api' | 'shell' | 'debate';
export type FailureBrickKind = 'retry_step' | 'escalate' | 'fail';
export type BrickKind = StepBrickKind | FailureBrickKind;

/** Synthetic node id for a step at `index` that has no unique string `id` (spec AC-04). */
export function unaddressableNodeId(index: number): string;

/** Extra facts shown on a step card when the graph edits a workflow draft (spec AC-03, AC-04). */
export interface StepDraftMeta {
  /** Index of the step in `steps` (0-based). */
  readonly index: number;
  /** Display label on the card: the step's `id`, or `(no id)` when absent/empty. */
  readonly label: string;
  /** True when the step is a mapping with a unique non-empty `id` in the draft. */
  readonly addressable: boolean;
  /** Runner name, `role: <name>`, or `debate (<roles>)`. */
  readonly runnerLabel: string;
  /** Permission rule (`read-only`, `writes ...`, `full access`, `old style full access`, `custom permissions`, `runner default`) or command count. */
  readonly ruleLabel: string;
  /** Whether any problem in `problems` points at this step or a field inside it. */
  readonly hasProblems: boolean;
  /** Step ids in `depends_on` that do not match any addressable step in the draft (spec AC-04). */
  readonly missingDependsOn: readonly string[];
  /** Target step id in `on_failure.target` when it does not match any addressable step in the draft (spec AC-04). */
  readonly missingFailureTarget?: string;
}

// `GraphNode` gains one optional member:
//   readonly draft?: StepDraftMeta;

/**
 * Builds a deterministic `RunGraph` from a workflow draft (`value: JsonObject`) and its `problems`, using `@dagrejs/dagre`
 * in the given `direction` ('LR' | 'TB'). Only edges between addressable steps in the draft are passed to `dagre` and
 * emitted as `GraphEdge`s; dangling references in `depends_on` or `on_failure.target` are recorded in
 * `draft.missingDependsOn` and `draft.missingFailureTarget`. All lookups use `Map`/`Set` (safe for any step id).
 */
export function buildWorkflowGraph(
  value: JsonObject,
  problems: readonly WorkflowProblem[],
  direction?: Direction,
): RunGraph;

/** Narrow an unknown string (such as a drag-and-drop transfer payload) to a known `BrickKind`. */
export function isBrickKind(value: string): value is BrickKind;
export function isStepBrickKind(value: BrickKind): value is StepBrickKind;

/**
 * The `addStep` edit a step brick produces, and the new step's generated id. `afterId` is included as `after` only when
 * it names an addressable step in `value.steps` (spec AC-05).
 */
export function stepBrickEdit(
  kind: StepBrickKind,
  value: JsonObject,
  catalog: EditorCatalog,
  afterId: string | undefined,
): { readonly id: string; readonly edit: WorkflowEdit };

/**
 * The `set` edit on `['steps', stepIndex, 'on_failure']` a failure brick produces for the addressable step `stepId`
 * in `value`, or `undefined` if `stepId` is not an addressable step (spec AC-05, AC-10).
 */
export function failureBrickEdit(
  value: JsonObject,
  stepId: string,
  kind: FailureBrickKind,
): WorkflowEdit | undefined;

/** Whether connecting `sourceHandle` on `source` to `targetHandle` on `target` is a valid handle pair (spec AC-07). */
export function isValidGraphConnection(
  source: string,
  target: string,
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
): boolean;

/**
 * The edit produced when a person connects `source` (`sourceHandle`) to `target` (`targetHandle`) on the canvas
 * (spec AC-07, AC-10), or `undefined` when the handles do not match, `source === target` for `depends_on`, the
 * dependency already exists, or either step is not addressable in `value`.
 */
export function connectStepsEdit(
  value: JsonObject,
  source: string,
  target: string,
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
): WorkflowEdit | undefined;

/**
 * The edit produced when a person disconnects `fromId` from addressable step `stepId`'s `depends_on` (spec AC-08,
 * AC-10): `set` with the remaining ids, or `remove` when none remain; `undefined` when `stepId` is not addressable or
 * `fromId` is not in `depends_on`.
 */
export function disconnectDependsOnEdit(
  value: JsonObject,
  stepId: string,
  fromId: string,
): WorkflowEdit | undefined;

/**
 * The edit produced when a person clears `on_failure` on addressable step `stepId` (spec AC-08, AC-10), or `undefined`
 * when `stepId` is not addressable or has no `on_failure`.
 */
export function clearFailureEdit(value: JsonObject, stepId: string): WorkflowEdit | undefined;
```

```ts
// src/ui/RunGraph.ts (extended for edit mode, spec C-02)

export interface RunGraphEditProps {
  /** Called when the person connects two handles on the canvas. */
  readonly onConnect: (
    source: string,
    target: string,
    sourceHandle: string | null | undefined,
    targetHandle: string | null | undefined,
  ) => void;
  /** Called when a brick is dropped onto the canvas (`targetStepId` is undefined) or onto an addressable step card. */
  readonly onDropBrick: (kind: BrickKind, targetStepId: string | undefined) => void;
  /** Called when the person presses Delete or Backspace on a focused addressable step node. */
  readonly onDeleteStep: (stepId: string) => void;
}

// `RunGraphProps` gains one optional member:
//   readonly edit?: RunGraphEditProps;
```

```ts
// src/ui/GraphView.ts (new)

/** Either a ready list of edits, or a function that computes them from the latest `value` in the edit queue (spec AC-10). */
export type QueuedEdit = readonly WorkflowEdit[] | ((value: JsonObject) => readonly WorkflowEdit[]);

export interface GraphViewProps {
  readonly value: JsonObject;
  readonly info: EditorResponse;
  readonly problems: readonly WorkflowProblem[];
  readonly refusal: string | undefined;
  readonly revision: number;
  readonly onEdit: (edits: QueuedEdit) => void;
  readonly onShowSource: (path: WorkflowPath) => void;
  readonly confirm: (message: string) => boolean;
}

export function GraphView(props: GraphViewProps): ReactElement;
```
