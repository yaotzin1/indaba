# Plan: The local web view, step 3c (edit a workflow on the graph)

Against [`api-surface.md`](api-surface.md). Read [`spec.md`](spec.md) first.

## How it works

```
GraphView (palette, RunGraph in edit mode, selected step settings)
   │
   ├─ Brick click / Enter / drop ────────► (value) => stepBrickEdit / failureBrickEdit ─┐
   ├─ Canvas handle connection ──────────► (value) => connectStepsEdit ─────────────────┼─► onEdit(queuedEdit)
   ├─ Disconnect / Clear on failure ─────► (value) => disconnectDependsOnEdit / clear ──┤     (SourceScreen queue,
   ├─ Move up / Move down / Remove / Del ► moveStep / removeStep ───────────────────────┤      resolves against
   └─ Selected step field change ────────► MemberFields (from FormView) ────────────────┘      latest valueRef)
                                                                                                     │
                                                                                                     ▼
                                                                                         POST /api/v1/workflows/edit
```

Every action in `GraphView` produces a `QueuedEdit` (either a `WorkflowEdit[]` or a pure builder
`(value: JsonObject) => readonly WorkflowEdit[]` that resolves the step's current index by its unique `stepId` against
`SourceScreen`'s `valueRef.current` at the moment the queued request runs, AC-10). When the server answers
`{ text, value, problems }`, `SourceScreen` updates `valueRef.current` and the shared draft,
`buildWorkflowGraph(value, problems, direction)` recomputes the `dagre` layout deterministically, and `RunGraph` renders
the updated nodes and edges.

## Modules touched

| File | Change |
| :--- | :--- |
| `packages/web/src/graph-model.ts` | Add `unaddressableNodeId`, `StepDraftMeta`, `buildWorkflowGraph`, `isBrickKind`, `isStepBrickKind`, `stepBrickEdit`, `failureBrickEdit`, `isValidGraphConnection`, `connectStepsEdit`, `disconnectDependsOnEdit`, `clearFailureEdit`. Pure, no React, no DOM, all lookups via `Map`/`Set`, no hardcoded runner names (`specs/agent-permissions` AC-16) |
| `packages/web/src/ui/RunGraph.ts` | Extend `StepCard`, `StepNodeView`, `flowOf` and `RunGraph` with optional `edit?: RunGraphEditProps`: set `deleteKeyCode: null` on `ReactFlow`, pass `isValidConnection`, enable `isConnectable: true` on addressable step handles, forward `onConnect`, accept brick drops on canvas and addressable step cards (`onDragOver` with `preventDefault`, `onDrop`), handle `Delete`/`Backspace` on a focused addressable step card, and render `StepDraftMeta` lines and problem/dangling indicators |
| `packages/web/src/ui/FormView.ts` | Export `MemberFields`, `ProblemList` and `FieldContext` so `GraphView` reuses the exact step field rendering and problem placement of step 3b |
| `packages/web/src/ui/GraphView.ts` (new) | Render the refusal alert and top-level workflow problems, the **Bricks** palette (`Agent step`, `API step`, `Shell step`, `Debate`, and `Retry a step`, `Escalate`, `Fail`), the step selector list and `RunGraph` in edit mode, and the selected step's settings panel (`Move up`, `Move down`, `Remove`, **Connections** with **Disconnect** / **Clear on failure** buttons including dangling references, step problems via `placeProblems`, and `MemberFields`) |
| `packages/web/src/ui/SourceScreen.ts` | Extend `View` to `'form' \| 'graph' \| 'source'`; keep `valueRef` in sync with the latest `value` and let `applyEdits` accept `QueuedEdit`; re-read the draft via `applyEdits([])` when switching from `source` to either `form` or `graph`; jump to `source` when clicking a problem with a line from `form` or `graph`; add **Graph** to `.view-switch` |
| `packages/web/src/messages.ts` | Add `messages.form.viewGraph` and `messages.graph` |
| `packages/web/src/styles.css` | Add layout rules for `.graph-studio`, `.palette`, `.brick`, `.connections`, and `.step-card.has-problem` (responsive single-column at `<= 1000px`, zero horizontal page scroll at `320px`, WCAG 2.2 AA contrast in both themes) |
| `packages/web/test/logic.test.ts` | Unit tests for `buildWorkflowGraph`, `stepBrickEdit`, `failureBrickEdit`, `isValidGraphConnection`, `connectStepsEdit`, `disconnectDependsOnEdit`, `clearFailureEdit`, `isBrickKind`, including dangling references, cycles in `depends_on`, unaddressable steps (`\0step:<index>`), `__proto__` safety, and cross-handle rejection |
| `packages/web/test/form.test.ts` | Happy-dom tests for the **Graph** view: switching between Form, Graph and Source on one draft (including `Source -> Graph` re-read); adding each of the four step bricks and three failure bricks by click/keyboard and by drag-and-drop; connecting and disconnecting `depends_on` and `on_failure` (including two rapid queued connects to the same step); dangling reference display and removal; moving and removing steps (including `Delete` key on a focused node); editing step fields in the Graph view's side panel |
| `docs/web-view.md`, `docs/web-view-development.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`, `specs/web-app/plan-step-3.md` | Document the Graph view and mark step 3c implemented |

## Stage 5: analyze (updated after Claude co-op review)

| Question | Answer |
| :--- | :--- |
| A published signature broken without the right version? | No. No public export or HTTP contract changes. |
| A `node:` import or I/O in `@indaba/core` or `@indaba/web`? | No. `packages/web/test/layers.test.ts` enforces no `node:` import and no HTML sink. |
| A new runtime dependency? | No. Uses the existing bundled `@xyflow/react`, `@dagrejs/dagre` and `react`. |
| Untrusted data reaching a shell, a path, a URL or a log? | No. Drag-and-drop reads only a closed `BrickKind` allowlist; all lookups use `Map`/`Set` (never plain objects); all workflow strings are rendered as React text children; edits go through `POST /api/v1/workflows/edit`. |
| A wall clock, randomness or environment read in decision logic? | No. `buildWorkflowGraph`, `nextStepId` and all edit builders are pure functions of their inputs. |
| An unbounded loop, retry or buffer? | No. Edits go through the bounded single-flight queue in `SourceScreen.ts` and the server's `MAX_EDITS` / `MAX_SOURCE_BYTES` caps; queued edit builders read `valueRef.current` at execution time so rapid edits never overwrite each other. |

All six findings from Claude's stage 5 critique have been resolved in `spec.md`, `api-surface.md`, `plan.md` and `tasks.md`.
