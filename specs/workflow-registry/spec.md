# Specification: The workflow registry

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommendations the maintainer confirms)
> **Semver impact**: minor (new contract, new commands, one new file under `.indaba/`; below 1.0)
> **Builds on**: [`docs/workflow-format.md`](../../docs/workflow-format.md) (the file is the workflow),
> [`specs/web-app`](../web-app/spec.md) and [`specs/tui`](../tui/spec.md) (the consumers).
> **Decided by the maintainer**: the registry is wanted; scanning stays, because workflows are also written outside
> any editor; CouchDB and PouchDB were considered and are not the default (C-01).

---

## 1. The problem

A workflow is a file, and Indaba finds it only when a command is given its path. A person with ten workflows across
four projects has no list: no way to see which ones are valid, which ran last and what it cost, or to open one from a
screen. A page or a dashboard that shows "your workflows" needs a list that exists even when no run has happened, that
notices a file added or edited by hand, and that remembers a little about each (where it lives, the project it belongs
to, the last result).

The file must stay the source of truth. People edit workflow files in their own editors, keep them in git, copy them
between machines and review them in pull requests. A registry that holds the real definition would break all of that.

## 2. User stories

- **US-01.** As a person, I see all my workflows in one list with their state, last run and last cost.
- **US-02.** As a person, I add a folder and every workflow file in it appears; a file I write by hand shows up
  without my registering it.
- **US-03.** As a person, I rename, tag or hide an entry in the list without touching the file.
- **US-04.** As a person, I make a copy of a workflow for another project, and the copy knows it is a copy.
- **US-05.** As a developer embedding Indaba, I use my own store (a database, a shared service) behind the same
  contract, through a plugin.
- **US-06.** As an operator of a hosted service, I replace the store without changing the engine, the page or the CLI.

## 3. Acceptance criteria

- [ ] AC-01. The registry is a contract, `WorkflowRegistry`, in `@indaba/core` (pure, no I/O). It lists, reads, adds,
  removes and annotates entries and reports changes. Nothing else in the codebase reads the store directly.
- [ ] AC-02. An entry holds: a stable id, the file's path relative to a **root**, the root, a display name, the project
  it belongs to, tags, `hidden`, the SHA-256 of the file when last read, the validation state (valid, or the message), the
  time of the last scan, `origin` (found by scan, added by hand, created by the editor, copied from another entry) and a
  reference to the last run (`traceId`, result, cost). The workflow's definition is **not** stored.
- [ ] AC-03. The built-in store is a JSON file at `.indaba/registry/index.json` under each root, written atomically
  (temporary file, then rename) and readable if truncated by returning to an empty index and rescanning. It is a cache of
  the folder plus the person's annotations; deleting it loses the annotations and nothing else.
- [ ] AC-04. A **root** is a folder the person registered (or the folder `indaba` was started in). A scan walks a root
  for `*.workflow.ai.yml`, `*.workflow.yml` and `workflow.ai.yml`, to a depth of 6, skipping `node_modules`, `.git`,
  `.indaba` and `dist`, never following a symbolic link or junction, and stopping at 5000 files visited per root. These
  are design choices, not measurements.
- [ ] AC-05. A scan parses each candidate with the same parser a run uses and records the validation state. A file that
  does not parse is listed with its message, not dropped and not fatal. A file that is not a workflow is skipped (it must
  be YAML with a `steps` mapping and a `version`).
- [ ] AC-06. A scan is incremental: a file whose size and modified time are unchanged is not re-read, and one whose
  content hash is unchanged keeps its validation state. The hash, not the time, decides whether an annotation still
  applies after an edit.
- [ ] AC-07. Identity survives a rename within a root when the content hash matches and the old path is gone; otherwise
  the old entry becomes `missing` and a new one appears. A `missing` entry is never silently deleted; the person removes it.
- [ ] AC-08. A scan runs on `indaba ui` start, on request, and (in the page) on window focus at most once every 30
  seconds. It is cancellable and reports progress. It never runs a workflow and never executes anything from a file.
- [ ] AC-09. `indaba workflows list [--json]`, `scan`, `add <folder>`, `remove <id>` and `copy <id> --to <folder>
  [--name <n>]` exist. `copy` writes a new file, refuses to overwrite one, records `origin: copied` with the source id,
  and lists what a person will usually change (paths, names) without rewriting the file's content.
- [ ] AC-10. Removing an entry never deletes the file. Deleting a file is a separate, confirmed action that is not in
  this spec's commands.
- [ ] AC-11. A path stored or read is confined: it must resolve inside its root and not through a link. A path from outside
  Indaba (the page, a request) is an id to look up.
- [ ] AC-12. The last-run reference is filled from the trace files by the same reader as `watch`, so an entry shows a
  result without a second record of it. A missing trace shows "no run yet", not an error.
- [ ] AC-13. A store registered through `PluginHost.registerRegistry` replaces the built-in one for the whole process,
  with the same contract and no access the built-in lacks. A store that throws fails the call, and the CLI says so; it
  does not fall back silently to the file store.

## 4. Non-goals

- **No database in the default install.** No server, no container, no native module (C-01).
- **No second copy of the workflow.** The file is the definition.
- **No version history of workflows.** Git does that; an entry holds only a hash.
- **No sync between machines.** A store plugin can offer it.
- **No access control.** A registry lists what a person can already read; permissions belong to the host process.
- **No running of workflows.** The registry points at files; the engine runs them.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the index is corrupt or unreadable | treat as empty, rescan, keep a `.bak` of the unreadable file, say so once |
| a root is gone or unreadable | its entries are `missing` with the reason; other roots are unaffected |
| a file is half-written by an editor during a scan | the parse error is recorded as its state; the next scan corrects it |
| two processes write the index at once | writes are atomic and whole-file; the later one wins, and a scan restores anything it lost |
| a scan exceeds the file limit | it stops, lists what it found, and says which root to narrow |
| a copy target exists | refuse; nothing is written |
| a store plugin throws | the call fails with its message; no silent fallback |

## 6. Security and data handling

File contents are untrusted: they are parsed with the safe parser and never evaluated. Names, tags and messages that
come from a file are shown as text. Paths are confined to their root and never followed through a link, so a scan cannot
be steered out of its root or into a device. The index holds no secrets and no file contents; error messages name a path
relative to the root and never an environment value. A copy writes through the same confined-path code as artifacts.

## 7. Where it lives

- `@indaba/core`: `WorkflowRegistry`, `RegistryEntry`, `RegistryScanReport`, `PluginHost.registerRegistry`.
- `@indaba/engine`: `FileWorkflowRegistry` (the scan, the parser call, the index file, the trace reader for AC-12).
- `indaba` (the CLI): the `workflows` command group and the composition root's registration.
- Contract: `WorkflowRegistry` of `api-surface.md`.

## 8. Clarifications

All recommendations; the maintainer confirms.

- **C-01. A file index, not CouchDB.** A registry of a few hundred small records does not need a database, and the
  repository's promise is "no database, no server, no container". CouchDB is a separate server process; PouchDB's
  value is replication, which is only worth its complexity once two machines share a list. The contract (AC-01, AC-13)
  makes that a plugin the day it is wanted, and the hosted service has its own store (`docs/hosted-service.md`).
  Alternatives rejected: SQLite through `node:sqlite` (still experimental in Node 22, and a native dependency otherwise),
  and storing definitions in the database (breaks editing by hand).
- **C-02. Roots, not one global list.** A root per project keeps the index next to what it describes, so copying a
  project copies its list, and no per-user database is needed. A per-user list of roots is a small file in the user's
  configuration folder.
- **C-03. Discovery by name and shape.** Names alone miss files called `review.yml`; shape alone parses every YAML file
  in a repository. Both together keep the scan cheap and the list honest. A person can add a file by hand by path.
- **C-04. Annotations are kept by id and hash.** A tag or a hidden flag survives an edit but not a rename that changes
  content, which is rare and visible.
- **C-05. Copy does not interpret.** Workflows differ across projects in prompts, paths and models; guessing which to
  change is worse than listing the places a person will look at. The editor (`specs/workflow-editor`) offers the
  guided version.

## Artifacts not written

- `plan.md`: the plan waits for the clarifications to be confirmed.
- `tasks.md`: nothing to schedule until the plan exists.
- `research.md`: the store alternatives are named in C-01; no measurement exists to compare.
- `data-model.md`: the entry is defined in `api-surface.md` and the index is its list.
- `events.md`: the registry emits no event and adds no span.
