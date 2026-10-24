# Specification: The local web view, the registry's screens (Workflows)

> **Status**: Implemented on `feat/web-app-registry-screens` (2026-10-24), except the real-browser half of AC-14 (see `review.md`);
> C-01 and C-05 confirmed by the maintainer the same day
> **Stage entry**: 1
> **Semver impact**: minor (below 1.0): additive HTTP resources, additive contract types (`CONTRACT_VERSION` 1.5.0 to
> 1.6.0), one new screen, and one widening of what `indaba ui` serves (C-01)
> **Parent**: [`specs/web-app`](../web-app/spec.md) AC-06, AC-13 and section 6. **Builds on**:
> [`specs/workflow-registry`](../workflow-registry/spec.md) (C-14: "Editing them from the page is a later slice, with the
> registry's screens"), [`specs/web-app-actions`](../web-app-actions/spec.md) (the backend pattern, AC-17). Where this file is
> silent, those rule.

---

## 1. The problem

The registry lists every workflow of a person's folders, remembers a name, a project, tags and a hidden flag for each,
and can copy a file into another folder. All of it is reachable only with `indaba workflows annotate|add|copy|remove`. The
page shows the registry's data (tags, last run, Show hidden in the Run a workflow panel, `workflow-registry` AC-15) and
changes none of it, and it has no Workflows screen: a person who does not use a terminal can start a workflow but cannot
rename it, tidy the list, bring in another project's folder or reuse a workflow in a second project.

This slice is the Workflows screen of parent AC-06, minus the parts that belong to other specs, and the registry's actions
from the page.

## 2. User stories

- **US-01.** As a person, I open Workflows and see every workflow of my folders in a table I can sort, search and page,
  with its project, last result, cost and when it last ran.
- **US-02.** As that person, I rename a workflow, set its project and tags, or hide it, without touching the file.
- **US-03.** As that person, I copy a workflow to another project of mine, see the places I will want to change, and open
  the copy.
- **US-04.** As that person, I add a folder to the places Indaba looks by typing its path once, seeing the folder Indaba
  resolved it to, and confirming.
- **US-05.** As that person, I take a missing entry off the list, and I am never offered a way to delete a file.
- **US-06.** As a developer, everything the page does here is also what `indaba workflows` does, with the same refusals.

## 3. Acceptance criteria

**The screen**

- [x] AC-01. **Workflows** is a screen of the page (address `/workflows`, a Workflows item beside Runs in the header),
  an `apsw-gridwright` grid (parent C-02) with sorting, search, selection and paging. Columns: name, project, tags, last
  result, last cost, last run, state. The state is `valid`, `invalid` (the first message) or `missing` (the reason), as the
  registry words it, with a symbol and a word, never colour alone. Last result and last cost read like the Runs screen
  (`unknown`, `at least … (partial)`, `no model calls`, parent AC-19); a workflow with no run says "never run". A row's name
  opens the workflow (`/workflows/{id}`, the source and form screen that exists). A missing entry is listed here, unlike in
  the Run a workflow panel (`workflow-registry` AC-14), and its name opens nothing.
- [x] AC-02. **Health is not a column.** The report of parent AC-14 and AC-15 does not exist; a column that is always empty
  is a dead control. It arrives with that report.
- [x] AC-03. Hidden entries are not listed until **Show hidden (n)** is on, as in `workflow-registry` AC-15; the choice is
  kept in the address, not in storage (parent C-05).

**The actions**

- [x] AC-04. **Edit details** (one selected entry) sets the name, the project and the tags, and **Hide** or **Show** sets
  the flag. Saving sends only what changed. A button next to the name and the project clears the person's value so the
  default shows again (`workflow-registry` AC-02: the workflow's `name`, the root folder's name). The tags are a list of
  short words; the limits of C-03 apply. The entry in the table changes when the server answers, not before.
- [x] AC-05. **Copy to another project** (one selected entry) asks for the target among the folders the registry covers
  (listed by the server, chosen from a list, never typed) and an optional file name, then calls `copy`. The page shows the
  places a person will usually change (`toReview`, as the command prints them), says the file was copied unchanged, and
  offers **Open the copy**. A name already taken is refused in plain words, with nothing written. The page sends a folder's
  **id** and a name, never a path.
- [x] AC-06. **Import a folder** asks for a folder path typed by the person. The server resolves it and the page shows the
  resolved folder and how many workflow files a scan would list in it (a bounded count, marked "at least" when a limit
  stopped it); only **Add this folder** adds it. There is no native folder dialog (parent section 6). A path that is not a
  folder, cannot be read, or reaches a device or a link out of itself is refused in plain words. The added folder joins the
  per-user list that `indaba workflows add` writes (C-01), is scanned, and its workflows appear.
- [x] AC-07. **Remove from the list** (one selected entry) names what will happen, asks, and calls `remove`. It is offered
  for an entry the registry would not list again: one that is `missing`, or was added by path and is not matched by a scan
  (`workflow-registry` C-08). For any other entry the page offers **Hide** instead and says why. Removing never deletes a
  file, and nothing on this screen can.
- [x] AC-08. **Scan again** asks the server to scan now (`workflow-registry` AC-08), shows the report in words (found, new,
  changed, moved, missing, and that a limit stopped it), and refreshes the table.
- [x] AC-09. Every action is an explicit act of the person (parent AC-13). One action is in flight at a time; a second press
  sends nothing. A destructive one (Remove) names the workflow and asks first.

**The server**

- [x] AC-10. `@indaba/server` serves the registry resources of `api-surface.md` only when the command line supplies a
  `RegistryControl`, as it does `RunControl` (`web-app-actions` AC-17); without one the list answers `404` (and a write `405`, as the other resources
  do) and the Workflows screen says in words that this server does not offer it; the header shows the item only when the list
  answers, so no menu entry leads nowhere (`indaba ui` always supplies the control). The server writes nothing and spawns nothing; the layers test stays
  green.
- [x] AC-11. Every resource needs the token, the `Host` check and, for a write, an `Origin` equal to the server's own
  (parent AC-02, `web-app-actions` AC-16). An entry id in an address is the registry's 16 hexadecimal characters, matched
  **exactly** (never as a prefix); a root id is likewise 16. A body field is read only when this file names it. The only
  path the page ever sends is the one of AC-06, and the server resolves it before using it.
- [x] AC-12. A refusal of the registry is answered with a status and a stable `code` the page words itself:
  `not_found` (404), `ambiguous` (cannot occur: ids are exact), `outside_roots` (422), `exists` (409), `would_return` (409),
  `not_a_workflow` (422), `store_failed` (500), plus `invalid_request` (400) for a malformed body and `not_a_folder` (422)
  for AC-06. No answer carries a stack, an environment value or an absolute path other than the resolved folder the person
  typed.
- [x] AC-13. The answers use the registry's own types where they are plain data (`RegistryEntry`'s members, the scan report),
  declared in `@indaba/core`'s web contract without importing the registry contract (`web-contract` imports only itself).

**Quality**

- [ ] AC-14. Every control is reachable with the keyboard, labelled, announces its outcome (`role="status"`), works at 320 px
  and takes its words from the message catalogue; the dialogs trap and return focus. A failure says what to do next and shows
  no status code (parent AC-20, `web-app-actions` AC-14).
- [x] AC-15. The server logs each change under `server.registry` (the action, the entry id or the root's folder name, the
  outcome `code`), never a file's content, a tag or a name the person typed beyond its length.

## 4. Non-goals

- **New workflow, and the wizard.** `workflow-editor` step 3d (paid, outside this repository). The New workflow button of
  sketch 6 is not built; no dead control is shown.
- **Health** (AC-02 above), **connected workflows**, **a registry plugin for `indaba ui`** (it loads no plugins).
- **Removing a root.** `indaba workflows` has no such command either; a person edits the per-user list.
- **Deleting files**, from here or anywhere (`workflow-registry` non-goals).
- **Changing the landing screen** (C-05).
- **Live updates of a second open page** (parent AC-05 names a registry-change event). The page asks again on window focus
  (`workflow-registry` AC-15); a stream event is a later slice.
- **Editing the workflow's own `name`.** That is the file; the form edits it.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the entry disappeared (another page or the command line removed it) | `404 not_found`; the page says so and refreshes the table |
| the file was renamed or deleted outside | the next scan marks it moved or missing; the table says so (registry AC-07) |
| a copy target exists | `409 exists`; nothing written; the page asks for another name |
| the target folder is not covered by the registry | `422 outside_roots`; cannot happen from the list, answered anyway |
| Remove on an entry a scan would list again | `409 would_return`; the page offers Hide |
| the typed folder is not a folder, is unreadable or is a link out | `422 not_a_folder`; nothing is written, the per-user list is unchanged |
| the same folder is imported twice | idempotent: the answer says it was already covered |
| the per-user list cannot be written | `500 store_failed`; the folder is not added for this session either |
| a store plugin throws | not applicable: `indaba ui` loads no plugins (`workflow-registry` non-goal) |
| two pages annotate one entry | the later write wins; the answer carries the entry as stored, and the page shows it |
| the server was started without a registry control | the resources are `404`; the screen says the server does not offer it |
| a scan reaches its limits | the report says `truncated`; the table says the list may be incomplete |

## 6. Security and data handling

- **Untrusted**: every body field, the typed path, and every name, tag and message that came from a workflow file. File-
  derived text is shown as text (parent AC-16); names and tags the person typed are bounded and cleaned of control sequences
  before they are stored (C-03).
- **Paths are identifiers.** Entry and root ids are looked up, never opened. The one path the page sends (AC-06) is resolved
  with `realpath`, must be an existing directory, and is shown back; the folder that is added is the **resolved** one, sent
  in a second request the person makes, and the server resolves it again and refuses it if it differs from what was shown
  (a link swapped in between). A file path cannot be imported from the page (`add <file>` stays a command).
- **What a root grants.** A folder added lets the page list its workflows and, with a confirmation per file hash
  (`web-app-actions` AC-04, and AC-05 of `agent-permissions` for `full`), run them. Adding a folder is therefore stated in
  the confirmation: "Indaba will list and be able to run the workflow files in this folder." (C-01).
- **Writes**: the per-user roots file, the target folder's new workflow file (`wx`, inside a covered root) and the root's
  `.indaba/registry/` index. No other write; nothing under `.indaba/worktrees/`.
- A write is a state change by the person: token, `Host` and same-origin `Origin` (AC-11).

## 7. Where it lives

- `@indaba/core` `web-contract`: the request and response types of `api-surface.md` (declarations only).
- `@indaba/server`: the resources and the `RegistryControl` interface; no process, no file write.
- `indaba` (the CLI): `RegistryControl` over the registry, the per-user roots file and the finder that follows a root added
  at run time; `indaba ui` passes it and reads the per-user roots (C-01).
- `@indaba/web`: the Workflows screen, its dialogs, the client calls and the messages.
- `@indaba/engine`: nothing new (the registry exists); at most a small export if the folder check of AC-06 is shared.

## 8. Clarifications

- **C-01. The roots of `indaba ui` include the per-user list.** *Confirmed by the maintainer, 2026-10-24.*
  `workflow-registry` C-12 gave `indaba ui` its `--root` folders only and left the per-user list to `indaba workflows`.
  A folder imported from the page must survive the session and must appear for `indaba workflows list`, so it is written to
  the same per-user list; and a folder the person already added with the command should appear on the page. So `indaba ui`
  covers `--root` folders (or the current folder), **then** the per-user list that still exists. This widens what a started
  page can run (a command-added folder was not runnable from the page before); each file still needs its own confirmation
  of its hash (`web-app-actions` AC-04), and the page says so when it adds a folder (AC-06). Rejected: a second list used
  only by the page (two lists that differ confuse a person who uses both), and importing for the session only (an import
  that is forgotten at once is not an import).
- **C-02. The backend pattern, not a child process.** An earlier idea was to run `indaba workflows …` as a child process for
  each action, as runs are. Runs are children because they live long and must be stoppable; a registry action is a short
  call on a store the command line already holds in the process (`createWorkflowFinder`). So the control calls the registry
  directly and the server keeps its rule of spawning nothing (AC-10).
- **C-03. Limits of what a person types.** Name at most 120 characters; project at most 120; at most 20 tags of at most 40
  characters each; control characters removed; empty after trimming means "no value" for tags and an error for a name sent
  as a string (clearing is `null`). Starting values, not measurements; each is a named constant.
- **C-04. Roots by id.** A root's id is the first 16 hexadecimal characters of the SHA-256 of the folder's path as the registry
  holds it (a `--root` as `indaba ui` resolved it, an imported folder as `realpath` gave it), so the page
  can name a copy target without sending a path and the id survives a restart and a change of the order of roots. It is an
  identifier, not a secret.
- **C-05. The landing screen stays Runs.** *Confirmed by the maintainer, 2026-10-24.* Parent AC-06 calls Workflows the
  home screen of the finished page. Moving the landing changes what a person sees on opening `indaba ui`, and the Runs screen
  is where a started run shows up. This slice adds the Workflows item and leaves `/` as it is; the change is one line when
  the maintainer wants it.
- **C-06. Health waits.** AC-02: parent AC-14 and AC-15 need the sandbox doctor (`specs/agent-sandbox`) and a report type
  that do not exist. A sketch shows the column; the page shows it when it has something true to say.
- **C-07. The grid.** `apsw-gridwright` 0.22.0 is already a dependency of the page (the Runs and Steps tables). No new
  dependency is added. A gap in the grid is fixed there (parent C-02), not worked around here; the plan names what to check
  (row selection controlled by the page, a search add-on, the row actions).

## Artifacts not written

- `research.md`: nothing here needs a comparison; the decisions are C-01, C-02 and C-05.
- `data-model.md`: the index file is `workflow-registry`'s; this slice adds none.
- `events.md`: no engine event and no span; log records only (AC-15).
