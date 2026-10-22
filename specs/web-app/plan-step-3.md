# Plan: The local web view, delivery step 3 (editing)

> **Status**: Plan only. No spec directory for the slices below exists yet; each slice gets its own `specs/<name>/`
> (spec, API surface, review) before code, as the process requires. This file orders the work and names what blocks it.
> Amended after the review of 2026-10-22 ([`../web-app-actions/plan-review.md`](../web-app-actions/plan-review.md)).
> Parent: [`spec.md`](spec.md) C-09 step 3, C-13, C-16, C-17. Step 2 (Run and Stop): [`../web-app-actions`](../web-app-actions/spec.md).

## What step 3 is

C-09 says: "(3) Editing: the wizard and editor of `specs/workflow-editor`." For a person who does not write YAML, it means
creating a workflow from a wizard, changing one in a form or on the graph, seeing what `indaba validate` says as they go,
and saving it, without losing the comments and layout of a file they or a colleague wrote.

## What blocks it, in order

| # | Needs | State | Why |
| :--- | :--- | :--- | :--- |
| 1 | Step 2 (Run and Stop) | specified | blocks nothing below but 3a; it is first because it needs no unbuilt spec, and Run after Save is the loop that makes editing worth having |
| 1b | `specs/debate-findings` | specified, not built | `workflow-editor` is stacked on it (its semver note) |
| 2 | `specs/workflow-editor` (`WorkflowDocument`, `problems()` with positions, `workflowJsonSchema()`, `catalogOf`) | specified, not built | everything below calls it; the page must never concatenate YAML |
| 3 | `specs/workflow-registry` | specified, not built | where a new or copied workflow is saved and listed; step 2's scan is only a stopgap |
| 4 | `specs/workflow-inputs` | specified, not built | C-17: a value that changes per run is an input the page asks for before Run |

Slices 1b and 2 are not page work. Starting the forms before the document model exists would mean writing YAML by string
in the browser, which `workflow-editor` exists to prevent. Slice 3a does not need it: it edits text, checks it with the
parser that already exists (`parseWorkflow` messages, without line or column) and gets positions later.
**Order: step 2, then 3a, then `debate-findings` and `workflow-editor`, then `workflow-registry`, then 3b to 3d.**

## The slices

Each is a pull request that leaves the page useful (C-09), and each starts with its own spec.

### 3a. Save what is edited: the write path (`specs/web-app-editing-core`)

- A server resource pair `GET`/`PUT /api/v1/workflows/{id}/source` (text of one workflow file), via a `WorkflowStore`
  backend supplied by the command line (the server stays free of file writes, as in step 2). `PUT` has **its own body cap
  of 1 MiB** (the 64 KiB `MAX_BODY_BYTES` of the settings resource is too small), a starting value, not measured.
- **Confinement, as in step 2.** `{id}` is resolved only from a fresh scan; any path or id in the payload is ignored; no
  link is followed; the write goes to a temporary file in the same folder and is renamed over the target; `PUT` never
  creates or renames a file, only replaces one the scan returned. A request without an `Origin` is refused.
- Optimistic concurrency: `PUT` carries the hash of the text it started from; a file changed on disk since is `409` with
  both versions, never an overwrite. A file written by someone in the same minute is the case that matters.
- Saving never runs anything. **A saved edit always invalidates the confirmation**, because the content hash changed, and
  this is an acceptance criterion of 3a, tested: save, then Run, shows the summary of use again. Without it a page that
  edits and runs could appear to confirm what the person never saw.
- The page checks a draft by posting the text to a `check` resource, as the logging settings do (`POST .../check`). In 3a
  that is the parser's messages; once `workflow-editor` exists it is `WorkflowDocument.problems()`, with line and column.
- **Source view first:** a text editor panel with the problems underlined by line and column and a Save button. It is the
  smallest thing that is useful and it exercises 3a without any form. It is also the fallback when a file is too unusual
  for the forms.

### 3b. Forms from the schema (`specs/web-app-editing-forms`)

- The step panel and the workflow header render fields from `workflowJsonSchema()` and the catalog (runners, guard types,
  arbiters, voters, prompts, with their descriptions), including `permissions` presets (C-16: read-only, edit only these
  folders, full access) and the `goal` text (C-17).
- Every edit goes through `WorkflowDocument.set` and shows the file's own comments untouched (AC-04 of the editor).
- A field the schema knows but the form does not render is edited in the source view, never dropped.
- Strings from the message catalogue; every control labelled; the error for a field is the message of `problems()` at its
  path (an editor must underline a field, not a sentence).

### 3c. The graph as an editor (`specs/web-app-editing-graph`)

- The edit mode of the one graph component (C-13): a palette of step kinds, drag to add, connect to set `depends_on`,
  delete, reorder, through `addStep`, `removeStep`, `moveStep`; a deleted step leaves a visible dangling reference rather
  than a silent repair (the editor's AC-03).
- Layout stays deterministic (dagre); an edit never moves unrelated nodes.
- A keyboard path for every pointer action (AC-20 of the parent spec): this is the hard part, and the reason 3c comes
  after 3b. React Flow's keyboard support is partial; each gap is a task, not a hope.

### 3d. The wizard (`specs/web-app-wizard`)

- `WorkflowDocument.create({ name })` and a short sequence: what do you want to do, which agents, which folder may they
  change, is a person needed to decide. It writes a plain file, previews it as the source view, validates, saves into the
  registry.
- For people who do not write files (the audience in `docs/vision.md`): no YAML shown until asked, plain words, the
  permissions presets by their names.
- "Execute a spec" and "Review a spec" templates (C-17) are workflows that take the spec as an input; they arrive with
  `workflow-inputs`.

### Later, each with a spec of its own (not in step 3)

- **Skills** (C-18) and **an assistant in the editor over ACP** (C-19): both marked "not decided" in the parent spec. They
  need `ruling-channel` and a conversation spec first. Nothing in 3a to 3d may assume them.
- Copy for another project, import and remove (AC-06 of the parent): the registry's screens.
- **Connected workflows** (the maintainer, 2026-10-22: wanted, as a **paid** feature). Workflows that depend on one
  another (one waits for another, one's outputs feed another's inputs) as a layer above single files: a separate file that
  names workflows by their registry id, so "one file per workflow" (decision 1) still holds. It needs
  `workflow-registry` (stable ids) and `workflow-inputs`, and it gets its own spec, which decides where the line between
  the MIT packages and the paid one runs (a separate package through the plugin contracts, not a fork of the engine).

## Decisions to take before 3a

1. **One file or many?** Decided by the maintainer, 2026-10-22: **one file per workflow.** `workflow-editor` edits one
   workflow file; a workflow that includes others does not exist, through step 3 at least.
2. **Where does a new workflow go?** Decided by the maintainer, 2026-10-22: **inside the project, as a plain file the
   person can keep in git: `<root>/workflows/<name>.workflow.ai.yml` by default**, with the name and subfolder theirs to
   change before saving. Never under `.indaba/` (gitignored runtime state) and never in the user's configuration folder
   (it would not travel with the project). The path is confined to a served root, ends in `.workflow.ai.yml`, and is
   created exclusively (`wx`): a taken name is the person's to change, never overwritten. With several roots the person
   picks one, the first by default. Step 2's search finds such a file at once; the registry later indexes it where it
   is, with origin "created by the editor". 3a only replaces files that exist; this applies from 3d (and to any
   "save as" before it).
3. **Is editing part of a paid edition?** C-13 says this is a product decision the spec does not make. It changes nothing
   in 3a, which is a local file write, but it changes how 3d is packaged. Maintainer to decide before 3d.

## Risks

- **Drift between the schema, the parser and the forms.** The editor's conformance test (AC-10) guards the first two; the
  forms are generated from the schema precisely so there is no third copy.
- **A save is a code change.** A workflow can contain `shell` steps. Saving is not running, and running a changed file
  asks again, but the page must never auto-save a draft into the file a run is about to read. Drafts live in the page;
  a Save is a click.
- **Concurrent edits** by a person and an agent in the same file: handled by the hash in 3a, not by locking.
- **Scope creep into a platform.** The non-goals of `workflow-editor` (no undo history, no merging, no templating)
  stand for the page too.

## Estimate

Not given. A number here would be invented (`no invented numbers`); the tasks of each slice are sized when its spec is
written, and the first slice after the prerequisites is 3a.
