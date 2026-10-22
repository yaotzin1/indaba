# Specification: The local web view, step 3a (edit a workflow's source and save it)

> **Status**: Implemented on `feat/web-app-source-edit` (2026-10-22), except the real-browser check of AC-13 (see
> `review.md`)
> **Stage entry**: 1
> **Semver impact**: minor (below 1.0): additive HTTP resources, additive contract types, one optional option of
> `startServer`, one optional dependency of `ui`
> **Parent**: [`specs/web-app`](../web-app/spec.md), C-09 step 3, slice 3a of [`plan-step-3.md`](../web-app/plan-step-3.md).
> **Builds on**: [`specs/web-app-actions`](../web-app-actions/spec.md) (the scan, the confirmation, the checks of a write).

---

## 1. The problem

A person who runs a workflow from `indaba ui` and sees it fail, or sees its confirmation list a command they did not
expect, has to leave the page, find the file, open an editor, change it, and come back. For the people who use Indaba
without a terminal (`docs/vision.md`), that is where they stop. The page that runs a workflow should let them read and
change its file, and say what is wrong with it before they run it.

This is the write path the rest of step 3 (forms, the graph editor, the wizard) stands on: one file, read whole, changed
as text, checked with the parser a run uses, and written back only if nobody changed it meanwhile.

## 2. User stories

- **US-01.** As a person, I open a workflow from the page and see its file as text.
- **US-02.** As that person, I change it and see, as I type, the problems `indaba validate` would report, with the line
  when it is known.
- **US-03.** As that person, I save it, and the next Run shows me again what it will use, because the content changed.
- **US-04.** As that person, when the file changed on disk after I opened it (an editor, `git pull`), saving does not
  overwrite that change: I see that it happened and choose.

## 3. Acceptance criteria

**Reading**

- [x] AC-01. `GET /api/v1/workflows/{id}/source` answers the text of the workflow the step 2 scan lists under `id`, with
  its path relative to its root, its project, the SHA-256 of its bytes (`contentHash`) and its problems. `{id}` is looked
  up in a fresh scan, never opened as a path; an id the scan does not return is `404 workflow_not_found`. The file is
  read as in step 2: a regular file (no link) inside its root, at most 1 MiB; a larger one is `413 too_large`, with
  nothing sent. Bytes that are not UTF-8 are `422 not_text`; nothing is sent that the page could mangle on save.

**Checking**

- [x] AC-02. `POST /api/v1/workflows/check` with `{ text }` answers `{ problems }`: what `indaba validate` would say of that
  text, by the same parser with the same runners and guards, each problem a sentence with its `line` and `column` when the
  parser gives them (YAML syntax), without them otherwise. It writes nothing and reads no file. The page asks while the
  person types, at most once per pause.

**Saving**

- [x] AC-03. `PUT /api/v1/workflows/{id}/source` with `{ text, baseHash }` replaces the file the scan lists under `id` and
  answers `200` with the new `contentHash` and the problems of what was saved. It never creates, renames or deletes a
  file: an id the scan does not return is `404`. A text that has problems is saved (a draft is the person's to keep) and
  the answer lists them; Run refuses it as it refuses any invalid file.
- [x] AC-04. **No lost update.** `baseHash` is the `contentHash` the page read. When the file's bytes on disk no longer hash
  to it, the save is `409 changed_on_disk` carrying the current text and hash, and nothing is written. The page shows that
  the file changed, lets the person load the version on disk or keep their own, and keeping their own sends a new `PUT`
  with the disk's hash as `baseHash`.
- [x] AC-05. **The write is whole.** The text goes to a new temporary file in the same folder (flag `wx`), keeps the
  file's permission bits, and is renamed over the target; a failure leaves the original as it was and removes the
  temporary file. The target is checked again just before the rename: still a regular file, still inside its root, its
  bytes still hashing to `baseHash`.
- [x] AC-06. The text is at most 1 MiB in UTF-8 (the scan's limit; a larger file would not be listed). The body of a `PUT`
  may be at most 2 MiB (`MAX_SOURCE_BODY_BYTES`, room for JSON escaping), larger is `413`. Both are starting values, not
  measurements. Any field of the body other than `text` and `baseHash` is ignored; a `path` or `id` in it never reaches
  the store.
- [x] AC-07. **A save invalidates the confirmation.** The confirmation of step 2 is kept per SHA-256 of the file's bytes,
  so changed content is unconfirmed: after a save that changed the text, the next Run answers `409 confirmation_required`
  with the summary of the new content. Tested end to end: confirm, run, edit, save, Run asks again. A save that writes
  the same bytes changes nothing.
- [x] AC-08. Saving never runs anything and starts no process.

**The page**

- [x] AC-09. Each valid or invalid workflow in the Run a workflow panel has **Edit**, which opens its source view at
  `/workflows/{id}` (the address names it, so a reload opens it again). The view shows the path and project, the text in a
  monospace editor that keeps the person's indentation (Tab inserts two spaces; Escape then Tab leaves the editor), the
  problems under it, **Save**, and **Run** once the saved file is valid.
- [x] AC-10. A problem with a line is a button that puts the caret at that line and column. The editor shows line numbers,
  so a line named in any message can be found.
- [x] AC-11. The view says whether the text is saved, being checked, or has unsaved changes. Leaving with unsaved changes
  (Back, another screen, closing the tab) asks first.
- [x] AC-12. A conflict (AC-04) shows the version on disk read-only beside the person's text, with **Use the version on
  disk** and **Keep mine and save**; neither happens without a press.
- [ ] AC-13. Keyboard, labels, announcements of saved and failed, 320 px, both themes, words from the catalogue, as in the
  parent's AC-20.

**Safety**

- [x] AC-14. Every new resource needs the token and the `Host` check; `PUT` and the check's `POST` need the page's own
  `Origin` (AC-16 of step 2). `@indaba/server` still writes no file: reading, checking and saving are the work of a
  `WorkflowStore` the command line supplies, as it supplies the run control. Without it the resources answer
  `404 source_unavailable` and the page offers no Edit.
- [x] AC-15. The text is untrusted: shown as text only (no HTML, no link), never logged, never put in an error message.
  A log record of a save holds the workflow's relative path, its new hash and the number of problems.

## 4. Non-goals

- **Creating, copying, renaming or deleting a workflow file.** A new file is 3d (the wizard) and follows the decision
  recorded in `plan-step-3.md`: `<root>/workflows/<name>.workflow.ai.yml`, created with `wx`.
- **Forms or the graph as an editor** (3b, 3c), and any change to the file other than the text the person typed.
- **Underlining a problem in the text, and positions for problems that are not YAML syntax.** They need
  `WorkflowDocument.problems()` from `specs/workflow-editor`. The plan's "underlined" source view arrives with it; 3a
  lists the problems and jumps to a known line (a narrowing recorded in C-02).
- **A code editor library.** A `textarea` with line numbers; a library is a dependency decision for 3b or later.
- **Merging** two versions. The person chooses one.
- **Editing `indaba.config`, plugins or scripts a workflow calls.**

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the id is not in a fresh scan | `404 workflow_not_found`; the page says the workflow is no longer in the project |
| the file grew past 1 MiB, or is not UTF-8 | `413 too_large` / `422 not_text`; the page says so and offers no editor |
| the file changed on disk since it was read | `409 changed_on_disk` with the current text and hash; nothing written |
| the folder cannot be written | `409 not_saved`; the original is untouched, no temporary file is left; the page keeps the person's text |
| the text has problems | saved, the answer lists the problems; Run refuses the file until they are fixed |
| the body is too large or not JSON | `413` / `415` / `400` before the store sees it |
| a request without the page's `Origin` | `403 origin_not_allowed` |
| `indaba ui` stops while a save is in flight | the rename either happened or did not; the file is one version or the other, never a mix |

## 6. Security and data handling

- Untrusted: the id in the address, the body (`text`, `baseHash`), and the file's content.
- The file written is only one the scan returned for `{id}`, re-checked at write time as a regular file inside its root
  by realpath. No path is taken from a request. The temporary file is created with `wx` beside the target, so a link
  planted at its name fails the save rather than being followed.
- The check parses text with the engine's parser, which builds data, not code (`yaml` with the core schema). It reads no
  file, runs nothing, and its answer is bounded by the text's size.
- The text never reaches a log, an error message or a URL.

## 7. Where it lives

- `@indaba/core` `web-contract`: the request and response types (declarations only).
- `@indaba/server`: three resources, the `WorkflowStore` interface, the body cap of a `PUT`; no file write.
- `indaba` (the CLI): `WorkflowStore` implemented over the step 2 scan in `run-control/source.ts`.
- `@indaba/web`: Edit in the panel, the source screen, the messages.

## 8. Clarifications

- **C-01. Save a text with problems.** Yes (AC-03). A file in a person's editor can be invalid between two saves; refusing
  would make the page the one editor that loses work. Run refuses it, which is where validity matters.
- **C-02. Positions.** The parser reports YAML syntax errors with "at line N, column M"; the store turns those into
  `line` and `column`. Structural problems (`steps[1].runner ...`) name a path, not a position, until `workflow-editor`
  gives `problems()` with positions. The plan asked for underlining; 3a lists and jumps instead, and says so here.
- **C-03. Concurrency by content hash, not modification time.** The hash is what the confirmation and the page already
  use, and a time can stay the same across a fast edit.
- **C-04. Contract version.** `CONTRACT_VERSION` goes from `1.1.0` to `1.2.0` (additive).
- **C-05. Where the page reaches the editor.** From the Run a workflow panel. A Workflows screen with health is the
  registry's (`specs/workflow-registry`); 3a does not build one.

## Artifacts not written

- `research.md`: the choice between a `textarea` and an editor library is recorded in the non-goals.
- `data-model.md`: nothing is stored but the workflow file itself.
- `events.md`: no engine event; the log records are under the existing logging contract (`api-surface.md`).
