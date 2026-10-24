# Tasks: The local web view, step 3c (edit a workflow on the graph)

Ordered by dependency. Each task brings its tests. Run `pnpm qa` after each group.

## Model (pure, no DOM)

- [x] **T-01** `packages/web/src/messages.ts`: add `messages.form.viewGraph` and `messages.graph` (view switch label,
  brick names and descriptions, canvas and connection labels, dangling reference words, card summaries).
- [x] **T-02** `packages/web/src/graph-model.ts` and `packages/web/test/logic.test.ts`: implement
  `unaddressableNodeId`, `StepDraftMeta`, `buildWorkflowGraph`, `isBrickKind`, `isStepBrickKind`, `stepBrickEdit`,
  `failureBrickEdit`, `isValidGraphConnection`, `connectStepsEdit`, `disconnectDependsOnEdit`, and `clearFailureEdit`,
  with unit tests covering every brick kind, `depends_on` and `retry_step` connections, cross-handle rejection,
  self-connections, duplicate edges, dangling `depends_on` and `on_failure.target` references (no ghost nodes in
  `dagre`), cyclic `depends_on` graphs, steps without ids or with duplicate ids (`\0step:<index>`), `__proto__` step ids,
  and both `'LR'` and `'TB'` directions.

## Components and styles

- [x] **T-03** `packages/web/src/ui/RunGraph.ts`: extend `StepCard`, `StepNodeView`, `flowOf` and `RunGraph` with
  optional `edit?: RunGraphEditProps` (`deleteKeyCode: null`, `isValidConnection`, connectable handles on addressable
  steps, `onConnect`, brick drag-over/drop on the canvas and on addressable step cards, `Delete`/`Backspace` key
  handling on focused addressable step nodes, and draft card lines with problem/dangling indicators).
- [x] **T-04** `packages/web/src/ui/FormView.ts` and `packages/web/src/ui/GraphView.ts`: export `MemberFields`,
  `ProblemList` and `FieldContext` from `FormView.ts`; build `GraphView.ts` with `contextOf` and `placeProblems`, the
  **Bricks** palette (buttons + drag sources), the step selector list, `RunGraph` in edit mode, and the selected step's
  settings panel (**Move up**, **Move down**, **Remove**, **Connections** with **Disconnect** and **Clear on failure**
  buttons, step problems, and `MemberFields`).
- [x] **T-05** `packages/web/src/ui/SourceScreen.ts` and `packages/web/src/styles.css`: add `'graph'` to `View` and the
  `.view-switch` group (`Form`, `Graph`, `Source`), support `QueuedEdit` builders resolved against `valueRef.current` in
  `applyEdits` (AC-10), re-read the draft on `Source -> Graph` and jump to `Source` on problem click from `Graph`, wire
  `GraphView`, and add the responsive studio, palette and card styles in `styles.css`.

## Tests, documentation and verification

- [x] **T-06** `packages/web/test/form.test.ts`: happy-dom integration tests for the **Graph** view (view switching
  across Form, Graph and Source on a shared draft including `Source -> Graph` re-read; unreadable YAML fallback; every
  step brick and failure brick via button click/keyboard and drag-and-drop; handle connection and disconnection
  including two rapid queued connects to the same step; dangling reference display and disconnection; move up/down and
  remove via button and `Delete` key; editing step fields in the side panel).
- [x] **T-07** Update `docs/web-view.md`, `docs/web-view-development.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`, and
  `specs/web-app/plan-step-3.md`.
- [x] **T-08** Run all blocking gates (`node scripts/validate-skills.mjs`, `node scripts/sync-claude-skills.mjs --check`,
  `node scripts/sync-agent-docs.mjs --check`, `node scripts/check-workflow.mjs`,
  `node scripts/security-audit.mjs --source`, `node --test scripts/*.test.mjs`, `pnpm qa`, `pnpm e2e`, `pnpm smoke`),
  have Claude audit the implementation, and complete `specs/web-app-editing-graph/review.md`.
