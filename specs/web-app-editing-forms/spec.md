# Specification: The local web view, step 3b (edit a workflow through forms)

> **Status**: Draft (stages 1 to 5)
> **Stage entry**: 1
> **Semver impact**: minor (below 1.0): additive HTTP resources, additive contract types and one optional field, one
> optional option of `startServer`, one optional dependency of `ui`
> **Parent**: [`specs/web-app`](../web-app/spec.md), C-09 step 3, C-13, C-16, C-17, slice 3b of
> [`plan-step-3.md`](../web-app/plan-step-3.md). Free, in this repository (decision 3 of that plan).
> **Builds on**: [`specs/web-app-editing-core`](../web-app-editing-core/spec.md) (the source view, save, conflict) and
> [`specs/workflow-editor`](../workflow-editor/spec.md) (`WorkflowDocument`, `diagnose`, the schema, the catalog).

---

## 1. The problem

Step 3a lets a person change a workflow, but only as YAML text. The people `docs/vision.md` is written for do not write
YAML: they want to give a step another goal, let it change one more folder, or make it wait for another step, and see
what is wrong before they run it. A form does that, if it changes only the field the person touched, so the comments and
layout a colleague wrote survive, and if it is built from the same description of the format the parser enforces, so it
does not drift from `indaba validate`.

## 2. User stories

- **US-01.** As a person, I open a workflow and see its name and its steps as fields, not as text.
- **US-02.** As that person, I change a step's goal, runner, role, dependencies, isolation or what to do on failure, and
  only that part of the file changes.
- **US-03.** As that person, I say what a step's agent may change with a preset (read only, edit only these folders,
  full access) rather than by writing globs.
- **US-04.** As that person, I add, remove and reorder steps.
- **US-05.** As that person, I see the problem of a field next to that field, in the words `indaba validate` uses.
- **US-06.** As that person, I switch to the source view for anything the form does not show, and back, without losing
  what I changed in either.

## 3. Acceptance criteria

**What the server offers**

- [ ] AC-01. `GET /api/v1/editor` answers the JSON Schema of the workflow file (`workflowJsonSchema()`) and the catalog of
  this installation (`catalogOf` over the runners, guards and arbiters of `indaba ui`'s bundle, plugins included), each
  description cut and cleaned as the catalog does. It reads no file.
- [ ] AC-02. `POST /api/v1/workflows/edit` with `{ text, edits }` applies the edits, in order, to the text with
  `WorkflowDocument` and answers `{ text, value, problems }`: the new text, the document as plain JSON, and its problems,
  each with its `path` as well as its `line` and `column`. An empty `edits` reads the text without changing it. It writes
  nothing, reads no file and starts nothing; saving stays the `PUT` of step 3a.
- [ ] AC-03. An edit is one of `set` (a path and a JSON value), `remove` (a path), `addStep` (a step and an optional
  `after`), `removeStep` (an id) and `moveStep` (an id and an optional `after`), as `WorkflowDocument` defines them. A
  text the document cannot read (not YAML, several documents, a root that is not a mapping, too large) is
  `422 not_editable` with the document's sentence; an edit it refuses (an unsafe key, a path through a scalar, a value
  that is not plain JSON, an unknown step) is `422 edit_refused` with the sentence and the index of the edit. Neither
  changes anything.
- [ ] AC-04. The problems of the edit and check resources carry the `path` the sentence is about (`$.steps[0].role`), in
  addition to the position, for every problem `diagnose` places. A page that knows no `path` ignores it.

**The form**

- [ ] AC-05. The workflow screen of step 3a shows the workflow as a **Form** or as **Source**, with a switch between them
  that says which is shown. Both edit one draft: a change in either is in the other, and Save, the conflict view, the
  unsaved-changes guard and Run behave as in step 3a. The form is shown first when the text can be read as a document;
  otherwise the source view, with a sentence saying why the form is not available.
- [ ] AC-06. The fields are rendered from the schema: a field with enumerated values is a choice, a string is a text
  field, an integer a number field, a list of strings a list with one item per line, a mapping with known fields a group
  of them. Where the catalog or the document knows the choices, the field offers them: a runner from the catalog's
  runners, a role from the document's `roles`, an arbiter from the catalog's arbiters, `depends_on` from the other steps'
  ids. A value the choices do not hold (a runner no plugin registers here, a role not declared) is shown as it is, marked,
  never replaced.
- [ ] AC-07. The form shows the workflow's `name` and `defaults.mcp_policy`; each role's `runner`, `model` and `mcp`; and
  for each step `id`, `role`, `runner`, `goal` (several lines), `depends_on`, `permissions`, `isolation`, `on_failure`,
  the debate fields (`consensus_with`, `decision_type`, `arbiter`), `input_artifacts`, `outputs`, `commands`, `mcp` and
  `mcp_policy`. A field the form does not render (`artifacts`, `mcp_servers`, `agent`, `guards`, a runner given as a list,
  a key the format does not know) is named with what it holds and a button that opens the source view at its line. It is
  never dropped and never rewritten.
- [ ] AC-08. **Only the field changes.** Each change of a field sends one edit of its path; the rest of the file, its
  comments, blank lines, key order and quoting included, is as it was (the editor's AC-04). Clearing an optional field
  removes its key; a required field (`name`, a step's `id`) cannot be cleared from the form, only changed. A text field
  sends its edit when it loses focus or on Enter (a single-line field), not per key press; a choice sends it at once.
- [ ] AC-09. **Permissions presets (parent C-16).** A step's permissions are one of: **Read only** (`fs.write` empty,
  `terminal: deny`), **Edit only these folders** (`fs.write` as the globs the person lists, `terminal: deny`), **Full
  access** (`fs.write: ["**"]`, `terminal: allow`), and **Not set** (no `permissions` key). `fs.read` is kept as it is. A
  value that matches none is **Custom**, shown with its fields, never changed unless the person picks a preset. The form
  says, in words from `docs/workflow-format.md`, that a goal's sentence is not a rule and that the `diff_within_scope`
  guard checks the change after the step.
- [ ] AC-10. **Steps.** The form lists the steps in file order. **Add a step** appends one, or puts it after the step
  shown, with an id no other step has (`step-1`, `step-2`, and so on) and the runner `shell` left for the person to change;
  **Remove** asks first and leaves other steps' `depends_on` as they are, so `problems` names the dangling reference
  (the editor's AC-03); **Move up** and **Move down** reorder. Renaming a step's id changes that id only.
- [ ] AC-11. **Problems at their field.** A problem whose `path` is a field's path is shown under that field, which is
  marked invalid and described by it; a problem about a step is shown at the top of that step; any other problem is
  shown at the top of the form. Every problem is still in the list of step 3a, so nothing is only in one place.
- [ ] AC-12. Keyboard, labels, announcements, 320 px, both themes, words from the message catalogue, as in the parent's
  AC-20: every control has a label, a group of fields is a `fieldset` with a `legend`, the switch and the step actions
  are buttons, and a field's error is tied to it with `aria-describedby`.

**Safety**

- [ ] AC-13. The new resources need the token and the `Host` check; the `POST` needs the page's own `Origin`. The body is
  capped at `MAX_SOURCE_BODY_BYTES` and its text at `MAX_SOURCE_BYTES`, as the check's; `edits` holds at most
  `MAX_EDITS` items, each path at most `MAX_PATH_PARTS` parts of at most `MAX_KEY_LENGTH` characters, each value at most
  `MAX_VALUE_DEPTH` levels deep; anything else is `400` before the backend sees it. `@indaba/server` still applies no
  edit itself: a `WorkflowEditor` the command line supplies does, as it supplies the store. Without it both resources
  answer `404 editor_unavailable` and the page offers no form.
- [ ] AC-14. The text, the values and the edits are untrusted: shown as text and never logged. A refusal's sentence (the
  document's, which may quote the YAML it could not read) goes only to the page that sent the text, cleaned as the
  sentences of `problems` are in step 3a; a log record of a refusal holds its code and the edit's index.

## 4. Non-goals

- **Creating, copying or renaming a workflow file** (3d and the registry). The form edits the file step 3a opened.
- **The graph as an editor** (3c). The step list is a list; the graph stays a view.
- **Every field.** `artifacts`, `mcp_servers`, `agent`, `guards`, a runner chain and unknown keys are edited in the source
  view (AC-07). Each is a later task, not a gap the form hides.
- **Renaming a step everywhere.** Changing an id does not rewrite other steps' `depends_on` or `on_failure.target`: the
  editor never repairs silently, and `problems` shows what to change.
- **Undo, a history, auto-save, merging** (the editor's non-goals stand). Drafts live in the page; a Save is a click.
- **Inputs** (`specs/workflow-inputs`) and anything paid: the wizard and connected workflows.
- **Running the edit in the browser.** The parser imports Node modules and the page takes only types from `@indaba/core`
  (its layering test); edits go to the command line like checks.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the draft is not YAML, or its root is not a mapping | `422 not_editable`; the page shows the source view with the reason, the form returns when the text is readable |
| an edit is refused | `422 edit_refused` with the sentence and the index; the field keeps the person's value, shows the sentence, the draft is unchanged |
| two edits are sent close together | they are applied in the order made, each to the text the previous one returned; only the latest answer is shown |
| the person types in the source view while an edit is in flight | the edit's answer is dropped; the text typed wins, and the form is read again from it |
| the body is too large, not JSON, or breaks a limit | `413` / `415` / `400` before the editor sees it |
| a request without the page's `Origin` | `403 origin_not_allowed` |
| `indaba ui` was started without the editor | `404 editor_unavailable`; the page shows only the source view, as in step 3a |
| the server stops during an edit | the page reports the failure as any lost connection; the draft is still in the page |

## 6. Security and data handling

- Untrusted: the body (`text`, `edits`) and the file's content. The edit runs on data only: `WorkflowDocument` builds
  YAML nodes with the core schema, refuses `__proto__`, `constructor` and `prototype`, and checks the result by reading it
  back. No path, process or URL is built from a value.
- Every limit of AC-13 is checked before the edit runs, so the work of one request is bounded by the body cap.
- The catalog's descriptions come from plugins; they are cut and cleaned (`catalogOf`) and rendered as text.

## 7. Where it lives

- `@indaba/core` `web-contract`: the request and response types, `path` on `WorkflowProblem`, the catalog as the page
  receives it (declarations only).
- `@indaba/server`: two resources, the `WorkflowEditor` interface, the limits; no edit applied.
- `indaba` (the CLI): `WorkflowEditor` over `WorkflowDocument`, `workflowJsonSchema` and `catalogOf`, with the problems
  of the store of step 3a.
- `@indaba/web`: the Form and Source switch, the form, the messages.

## 8. Clarifications

- **C-01. Why the edit is on the command line.** The page may import only types from `@indaba/core`, and the parser that
  `WorkflowDocument` uses imports `node:fs` (AC-02 of the parent: no Node code reaches the browser). Bundling a browser
  build of the engine would add a second copy of the parser to keep in step. One round trip per field change is the cost,
  the same as the check of step 3a.
- **C-02. The resource takes the text, not the id.** An edit changes a draft that is not saved, so the text is the only
  thing it can work on; the file is read and written only by the store of step 3a, against its hash.
- **C-03. Form first.** The audience of the page does not write YAML, so the form is the first view when the document can
  be read. A person who prefers the text switches once per visit; remembering that choice is a later convenience.
- **C-04. Presets are exact.** A preset is a value, not a guess: a value that is not exactly one of them is Custom, so
  opening a file never changes its permissions. `fs.read` is outside the presets because "read only" in C-16 is about
  what the agent may change.
- **C-05. Ids of new steps.** `step-N` with the smallest N not taken: plain, valid by the format's pattern, and the
  person's to rename. The runner `shell` with no command makes the new step invalid until it has one, which `problems`
  says; a step with no runner would be invalid too and say less.
- **C-06. Text fields commit on blur and Enter.** Per key press would send a request and rewrite the draft per
  character; a pause timer would commit half a word. A choice commits at once.
- **C-07. Limits.** `MAX_EDITS` 64, `MAX_PATH_PARTS` 16, `MAX_KEY_LENGTH` 256, `MAX_VALUE_DEPTH` 16: starting values
  that bound the work of a request well above what a form sends (one edit per change, paths of at most five parts), not
  measurements.
- **C-08. Contract version.** `CONTRACT_VERSION` goes from `1.2.0` to `1.3.0` (additive; `path` is optional).
- **C-09. Order in the plan.** `plan-step-3.md` put `workflow-registry` before 3b. 3b edits only files the scan of step 2
  already lists and creates none; the registry is needed by 3d and by copy and import. The plan is amended to say so.

## Artifacts not written

- `research.md`: no library is chosen; the form uses the page's existing React and the schema `workflow-editor` built.
- `data-model.md`: nothing is stored but the workflow file, written by the store of step 3a.
- `events.md`: no engine event and no span; the log records are under the existing logging contract (`api-surface.md`).
