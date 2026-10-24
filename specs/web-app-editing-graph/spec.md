# Specification: The local web view, step 3c (edit a workflow on the graph)

> **Status**: Implemented on `feat/web-app-editing-graph` (2026-10-25); amended after the stage 5 and stage 8 co-op
> reviews with Claude
> **Stage entry**: 1
> **Semver impact**: patch (or minor bundle update of `@indaba/server`; no public TypeScript signature, HTTP route, CLI
> option, workflow field, event or span attribute changes; `@indaba/web` is private and bundled into `@indaba/server`)
> **Parent**: [`specs/web-app`](../web-app/spec.md), C-03, C-09 step 3, C-13, C-16, AC-07, AC-20, slice 3c of
> [`plan-step-3.md`](../web-app/plan-step-3.md), and sketch 5 ([`05-editor-later.html`](../web-app/sketches/05-editor-later.html)).
> Free, in this repository (decision 3 of `plan-step-3.md`).
> **Builds on**: [`specs/web-app-editing-core`](../web-app-editing-core/spec.md) (the source view, save, conflict),
> [`specs/web-app-editing-forms`](../web-app-editing-forms/spec.md) (the schema-driven form, the edit queue, the catalog),
> and [`specs/workflow-editor`](../workflow-editor/spec.md) (`WorkflowDocument`, `addStep`, `removeStep`, `moveStep`,
> `set`, `remove`, `problems()`).

---

## 1. The problem

Step 3b lets a person edit a workflow's fields in a form, and step 1 shows a run's steps as a graph. A workflow is a
directed graph: which steps run in parallel, which step waits for which (`depends_on`), and where a failure sends the
run back (`on_failure: retry_step`). In a flat list of steps, seeing that shape—or wiring one step after another—means
reading and ticking lists of step ids by name.

Parent C-13 and sketch 5 commit to one graph component with a view mode (for a run) and an edit mode (for a workflow
file): a palette of bricks to add steps and failure routes, connecting handles to set `depends_on` and `retry_step`,
reordering and deleting steps, and editing the selected step's settings beside the canvas, with a complete keyboard path
for every pointer action (parent AC-20, `plan-step-3.md`).

## 2. User stories

- **US-01.** As a person editing a workflow, I switch to **Graph** and see the steps of my draft laid out left to right
  with their `depends_on` arrows and `on_failure: retry_step` routes, before the workflow has ever run.
- **US-02.** As that person, I add an agent step, an API step, a shell step or a debate from a palette of bricks—by
  dragging a brick onto the canvas or a step, or by pressing Enter on the brick—and only that step is added to the YAML.
- **US-03.** As that person, I connect one step to another on the canvas (or in the step's panel) so it waits for it, or
  disconnect an existing link, and the graph lays itself out deterministically without my dragging cards into place by
  hand.
- **US-04.** As that person, I set what happens when a step fails (retry a step, escalate, or fail) from the bricks, by
  connecting the failure handle on the canvas, or in the step's panel.
- **US-05.** As that person, I select any step on the graph and edit its fields, move it up or down, or remove it right
  beside the canvas; removing a step leaves other steps' references visible as problems until I change or disconnect
  them.
- **US-06.** As a person using only a keyboard or a screen reader, or a 320 px screen, I can do every action the canvas
  offers.

## 3. Acceptance criteria

**The Graph view and shared draft**

- [x] AC-01. The workflow editor screen (`/workflows/{id}`) offers **Form**, **Graph** and **Source** in its view
  switch when the server provides `workflowEditor` (`GET /api/v1/editor`). **Form** remains the first view when the file
  can be read as a document. All three views edit the same draft (`text`, `value`, `problems`) through the sequential
  edit queue of step 3b: a change in **Graph** is immediately in **Form** and **Source**, switching from **Source** to
  **Graph** re-reads the draft as switching to **Form** does, clicking a problem with a line number in **Graph** jumps to
  that line in **Source**, and **Save**, the conflict view, the unsaved-changes guard and **Run** behave identically
  across all three. When the draft cannot be read as a document (`422 not_editable`), **Graph** shows the reason and a
  button to open **Source**, as **Form** does.

**One graph component and deterministic layout**

- [x] AC-02. The edit graph uses the same layout engine (`@dagrejs/dagre` in `graph-model.ts`) and the same canvas
  component (`RunGraph.ts`, extended with edit-mode props) as the Run screen's graph (parent C-03, C-13): left to right
  on wide screens, top to bottom below 640 px. Node positions are a pure function of the draft's `steps` order and
  their valid `depends_on` edges (`nodesDraggable: false`), never stored as freehand coordinates: editing a step's
  fields or `on_failure` never moves any node, while adding, removing or reordering a step or changing `depends_on`
  re-ranks the graph deterministically (C-06). Cycles in `depends_on` are laid out with finite coordinates without
  throwing, and `problems` reports the cycle.
- [x] AC-03. Each step card on the edit graph shows:
  1. the step's `id` (or `(no id)` when the step has no string `id`);
  2. its kind/runner summary: `debate (<roles>)` when `consensus_with` or `decision_type: consensus` is set, else its
     `runner` (or `role: <role>` when it inherits its runner from a role);
  3. its rule or command summary: for a `shell` step, how many commands it has (`1 command`, `2 commands`, `no commands`);
     for an agent or API step, its permission rule (`read-only`, `writes <globs>`, `full access`,
     `old style full access`, `custom permissions`, or `runner default`, parent C-16);
  4. whether the step has validation problems (`has problems`), and whether another step retries it on failure (`runs
     again if <id> fails`) or a dependency/retry target is missing (`missing: <ids>`, `retry missing: <id>`).
   Colour is never the only sign of a problem or state (parent AC-07, AC-20).

**Dangling references and unaddressable steps**

- [x] AC-04. Removing or renaming a step never silently rewrites other steps' `depends_on` or `on_failure.target`
  (`workflow-editor` AC-03, `plan-step-3.md`). When a step's `depends_on` or `on_failure.target` names an id that is not
  an addressable step in the draft, `buildWorkflowGraph` does not pass that missing node to `dagre` or emit a broken
  canvas edge: instead it records the missing id in `draft.missingDependsOn` or `draft.missingFailureTarget`, the card
  and the selected step's **Connections** panel show it (`no such step`), `problems` lists the validation error, and the
  person can disconnect or clear it with one press. A step that has no string `id`, is not a mapping, or shares its `id`
  with another step is given a synthetic non-colliding node id (`\0step:<index>`), marked `addressable: false`, and
  shown on the graph with its handles, move and remove disabled.

**Bricks palette**

- [x] AC-05. The **Bricks** palette beside the canvas offers two groups (sketch 5):
  - **Steps** (using only `catalog.runners` and never hardcoding built-in runner names in `@indaba/web`, per
    `specs/agent-permissions` AC-16 and `packages/web/test/layers.test.ts`):
    - **Agent step**: adds `{ id, ...(runner ? { runner } : {}) }` where `runner` is the first non-`'shell'` runner in
      `catalog.runners` whose `permissions.edit.mode` is not `'unsupported'` (or the first non-`'shell'` runner when
      `permissions` is absent);
    - **API step**: adds `{ id, ...(runner ? { runner } : {}) }` where `runner` is the first non-`'shell'` runner in
      `catalog.runners` whose `permissions` supports `read` but not `edit` (`read.mode !== 'unsupported'` and
      `edit.mode === 'unsupported'`), or else the first non-`'shell'` runner in `catalog.runners`;
    - **Shell step**: adds `{ id, runner: 'shell' }`;
    - **Debate**: adds `{ id, decision_type: 'consensus', ...(first role as role, and second role in consensus_with,
      when the document declares roles) }`.
    Each new step gets `nextStepId(stepIds)` (`step-1`, `step-2`, ...), is inserted with `addStep` (`after` is set only
    when the target `afterId` is an addressable step in `value.steps`; otherwise appended at the end), and becomes the
    selected step.
  - **If it fails** (for the selected addressable step):
    - **Retry a step**: sets `on_failure` on the step to
      `{ action: 'retry_step', target: <existing target or step's own id>, max_retries: <existing max_retries or 3> }`;
    - **Escalate**: sets `on_failure` on the step to `{ action: 'escalate' }` (replacing any previous `target` and
      `max_retries`);
    - **Fail**: sets `on_failure` on the step to `{ action: 'fail' }` (replacing any previous `target` and
      `max_retries`).
- [x] AC-06. Every brick is a `<button type="button">` that acts on click, `Enter` or `Space`, **and** is draggable
  (`draggable: true`): dragging a step brick onto the canvas adds the step (dropping it onto an addressable step card
  inserts it `after` that step), and dragging an **If it fails** brick onto an addressable step card sets that step's
  `on_failure`.

**Connecting, disconnecting, reordering and deleting**

- [x] AC-07. In edit mode, each addressable step node has connectable handles (`isConnectable: true`). Dragging a
  connection from step `A`'s output handle (`out`) to step `B`'s input handle (`in`) sends a `set` edit on `B`'s
  `depends_on` adding `A` (unless `A === B` or `B` already has `A` in `depends_on`). Dragging a connection from step
  `A`'s failure handle (`fail-out`) to step `B`'s failure handle (`fail-in`) sets `A`'s `on_failure` to
  `{ action: 'retry_step', target: B, max_retries: <existing max_retries or 3> }`. Cross-handle connections (`out` to
  `fail-in` or `fail-out` to `in`) are rejected (`isValidConnection` and `connectStepsEdit` return false/`undefined`).
  Handle dragging is a pointer shortcut; the keyboard path for every connection is in the step's panel (AC-08).
- [x] AC-08. In the selected step's panel, the **Connections** section lists each step in its `depends_on` (including
  any dangling id) with a **Disconnect** button that removes that id from `depends_on` (`set` with the remaining ids, or
  `remove` when none remain), and when `on_failure` is set, a **Clear on failure** button that removes `on_failure`.
  The **Waits for** checkboxes and **On failure** fields of step 3b remain in the same panel, so adding or removing any
  connection works with the keyboard or on a touch screen.
- [x] AC-09. Selecting a step on the canvas (by clicking it, by pressing `Tab` to focus it and `Enter`, or from the step
  buttons above the canvas) opens its **Step settings** panel beside the canvas. The panel contains: **Move up**, **Move
  down** (`moveStep`), **Remove** (`removeStep` after confirmation), the step's connections (AC-08), the step's
  validation problems, and all of the step's schema-driven fields (`MemberFields` from `FormView`). React Flow's
  built-in `deleteKeyCode` is disabled (`null`); pressing `Delete` or `Backspace` while an addressable step node itself
  is focused on the canvas asks for the same confirmation and removes the step.
- [x] AC-10. **Queue-safe edits by step id.** Graph actions that address a step (`failureBrickEdit`, `connectStepsEdit`,
  `disconnectDependsOnEdit`, `clearFailureEdit`) resolve the step's index against the latest `value` inside the
  `SourceScreen` edit queue when the request is about to be sent, so two rapid connections to the same step or a move
  followed by a connection never overwrite each other or hit a stale step index.

**Quality and safety**

- [x] AC-11. Keyboard, labels, announcements, 320 px, both themes, and strings from `messages.ts` (parent AC-20): every
  brick, step selector, connection button and field is keyboard-reachable and labelled; at 1000 px and below the studio
  columns stack into a single column with no horizontal page scroll (`scrollWidth === clientWidth` at 320 px); below
  640 px the graph runs top to bottom.
- [x] AC-12. All edits are `WorkflowEdit` operations sent through `POST /api/v1/workflows/edit`; only the touched path
  or step list entry changes in the YAML file, keeping comments, blank lines, key order and quoting untouched
  (`workflow-editor` AC-04). Everything from the file is rendered as text only (parent AC-16).

## 4. Non-goals

- **Freehand node positions stored in the workflow file.** The workflow format has no coordinate fields; layout is
  always computed deterministically by `dagre` (AC-02).
- **Creating, copying, renaming or deleting workflow files** (step 3d and the registry's screens).
- **Auto-repairing `depends_on` or `on_failure.target` when a step is removed or renamed.** `workflow-editor` AC-03 and
  `plan-step-3.md` forbid silent repair; dangling references are shown and reported by `problems()`.
- **Editing `artifacts`, `mcp_servers`, `agent` or `guards` on the canvas.** Like in step 3b (AC-07), they are named in
  the step panel with a button that opens the **Source** view at their line; guard bricks and MCP bricks in sketch 5 are
  deferred to the slice that adds form editors for `guards` and `mcp_servers` (C-03).
- **The paid wizard or templates** (step 3d) and **the workflow assistant** (`specs/workflow-assistant`).

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the draft is not valid YAML or its root is not a mapping | `422 not_editable`; the Graph view explains why and offers a button to open **Source**, and returns when the text is readable |
| an edit is refused by `WorkflowDocument` | `422 edit_refused`; the refusal sentence is shown as an alert at the top of the Graph view, and the draft is unchanged |
| a step has no `id`, is not a mapping, or shares an `id` with another step | shown on the graph with synthetic node id `\0step:<index>` and `addressable: false` so nothing crashes; handles, move and remove are disabled for it with a note to give it a unique id first |
| a step connects to itself (`A -> A`) for `depends_on`, or connects mismatched handles (`out -> fail-in`) | rejected (`connectStepsEdit` returns `undefined`, `isValidConnection` returns `false`); a step cannot wait for itself (whereas `retry_step` to itself on `fail-out -> fail-in` is allowed) |
| a connection creates a cycle in `depends_on` | the edit is applied (`WorkflowDocument` allows invalid intermediate states, AC-06 of `workflow-editor`), `dagre` lays out the cyclic graph with finite coordinates, and `problems` reports the cycle |
| two connections or a move and a connection are triggered back to back | each edit builder runs against the latest `value` in the queue, so both changes survive and hit the right step (AC-10) |
| a step is removed while another step depends on it | confirmed first; the other step keeps the deleted id in `depends_on`, shown as a dangling reference (`no such step`) with a **Disconnect** button and reported in `problems` |
| the person types in **Source** while a graph edit is in flight | the edit's answer is dropped and the typed text wins, as in step 3b |

## 6. Security and data handling

- No new HTTP endpoint, no file I/O, no process spawning and no change to `@indaba/server`, `@indaba/engine`,
  `@indaba/core` or `indaba`.
- Every edit goes through the existing `POST /api/v1/workflows/edit` endpoint with the token, `Host` check, `Origin`
  check and body/depth/length caps of step 3b.
- Step ids, runner names, role names, globs and problem messages come from untrusted workflow text, are indexed only in
  `Map`/`Set` structures (never plain objects where `__proto__` could collide), and are rendered only as React text
  children (never `innerHTML` or `dangerouslySetInnerHTML`). Drag-and-drop `dataTransfer` payloads carry only a brick
  key from a fixed allowlist (`'agent' | 'api' | 'shell' | 'debate' | 'retry_step' | 'escalate' | 'fail'`); any other
  string dropped onto the canvas is ignored.

## 7. Where it lives

- `@indaba/web`:
  - `src/graph-model.ts`: `buildWorkflowGraph(value, problems, direction)` (pure: turns a draft's `JsonObject` and
    `WorkflowProblem[]` into a deterministic `RunGraph` with edit metadata for each node and edge, including dangling
    references), plus pure helpers for brick edits and edge connection/disconnection edits keyed by step id;
  - `src/ui/RunGraph.ts`: edit-mode support on the existing `RunGraph` component (connectable handles, `onConnect`,
    `isValidConnection`, brick drop targets on the canvas and on step cards, `deleteKeyCode: null` with explicit
    `Delete`/`Backspace` handling on a focused step node, and edit-mode card lines);
  - `src/ui/GraphView.ts` (new): the studio layout (Bricks palette, Canvas with step picker, and Step settings panel
    reusing `MemberFields` from `FormView.ts`);
  - `src/ui/FormView.ts`: exports `MemberFields`, `ProblemList` and `FieldContext` so `GraphView` and `FormView` share
    one implementation of step field editing;
  - `src/ui/SourceScreen.ts`: adds `'graph'` to `View` (`'form' | 'graph' | 'source'`), supports queued edit builders
    that read the latest `value`, and re-reads the draft when switching from **Source** to **Graph**;
  - `src/messages.ts` and `src/styles.css`: strings and studio/palette styles.

## 8. Clarifications

- **C-01. Three views in the switch: Form, Graph, Source.** **Form** stays the initial view when a workflow opens (so
  step 3b's contract and tests hold unchanged) and edits workflow-level fields, roles and steps in one page. **Graph**
  puts the canvas and bricks front and centre with the selected step's settings beside it (matching sketch 5 and the
  three views named in `specs/workflow-assistant` AC-01).
- **C-02. One graph component (parent C-13).** `RunGraph` renders both a run's graph and a draft's edit graph. In view
  mode handles are `isConnectable: false` and cards show run state and elapsed time; in edit mode handles on addressable
  steps are `isConnectable: true` and cards show the step's runner/debate kind, permission/command summary and problem
  status.
- **C-03. Scope of bricks in 3c.** Sketch 5 showed four step bricks (`Agent step`, `API step`, `Shell step`, `Debate`),
  three failure bricks (`Retry a step`, `Escalate`, `Fail`), two guard bricks and an MCP brick. In step 3b (AC-07),
  `guards` and `mcp_servers` were deliberately left as source-only fields for a later task. 3c implements the four step
  bricks and the three failure bricks—the ones that create nodes and edges on the graph—while `guards` and `mcp_servers`
  continue to link to their line in **Source** from the step panel.
- **C-04. Drag-and-drop is progressive enhancement over buttons.** Browsers, touch devices and assistive technologies
  vary in HTML5 drag-and-drop support, and React Flow intercepts pointer drag on nodes. Every brick is a button that
  acts on click or `Enter`/`Space` (inserting after the selected step or applying to the selected step) and also
  supports HTML5 drag onto the canvas or a step card; every connection can be made by dragging between handles
  (`onConnect`) and by toggling **Waits for** / **On failure** or pressing **Disconnect** in the step panel.
- **C-05. No contract version bump needed.** Nothing in `@indaba/core` `web-contract` or `@indaba/server` changes;
  `CONTRACT_VERSION` stays `1.3.0`.
- **C-06. Deterministic layout vs. structural edits.** `plan-step-3.md` wrote "Layout stays deterministic (dagre); an
  edit never moves unrelated nodes." In `dagre`, editing a step's non-structural fields (`goal`, `runner`, `permissions`,
  `on_failure`) keeps every node at the exact same coordinates, whereas adding/removing a step or changing `depends_on`
  re-ranks the graph deterministically; `plan-step-3.md` is amended to state this explicitly.

## Artifacts not written

- `research.md`: `@xyflow/react` and `@dagrejs/dagre` were already chosen and bundled in delivery step 1.
- `data-model.md`: nothing is stored but the workflow file itself; the pure view shapes live in `graph-model.ts` and are
  listed in `api-surface.md`.
- `events.md`: no engine event, span attribute or server log record is added.
