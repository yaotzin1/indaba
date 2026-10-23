# Specification: The workflow registry

> **Status**: Clarified 2026-10-23 (section 8, decided by the maintainer); slices 1 (#69) and 2 (`feat/workflow-registry-ui`)
> implemented
> **Stage entry**: 1
> **Semver impact**: minor (new contract, an optional `PluginHost` member, new commands, one new file under `.indaba/`;
> below 1.0)
> **Builds on**: [`docs/workflow-format.md`](../../docs/workflow-format.md) (the file is the workflow),
> [`specs/web-app-actions`](../web-app-actions/spec.md) (the scan it replaces), [`specs/web-app`](../web-app/spec.md)
> and [`specs/tui`](../tui/spec.md) (the consumers).
> **Decided by the maintainer**: the registry is wanted; scanning stays, because workflows are also written outside
> any editor; CouchDB and PouchDB were considered and are not the default (C-01). On 2026-10-23: a JSON index per root,
> annotations kept on the machine, step 2's discovery rules, and two slices (C-01 to C-03, C-07).

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

Slice 1 (this pull request): the contract, the file store and `indaba workflows`. Slice 2: `indaba ui` and the page
use the registry (AC-14, AC-15).

**The contract**

- [x] AC-01. The registry is a contract, `WorkflowRegistry`, in `@indaba/core` (pure, no I/O). It lists, reads, scans,
  adds, annotates, removes and copies entries. Nothing else reads the store's file directly.
- [x] AC-02. An entry holds: a stable id; the root and the file's path relative to it; a display name (the person's,
  else the workflow's `name`, else the file's name); a project (the person's, else the root folder's name); tags;
  `hidden`; the SHA-256 of the file when last read; the validation state (`valid`, `invalid` with the first message, or
  `missing` with the reason); when it was last read; `origin` (`scanned`, `added`, `created`, `copied`) and, for a copy,
  the id it was copied from; and the last run (AC-12). The workflow's definition is **not** stored.

**The file store**

- [x] AC-03. The built-in store keeps one JSON index per root at `.indaba/registry/index.json`, written whole to a
  temporary file and renamed over the index. It is a cache of the folder plus the person's annotations; deleting it
  loses the annotations and nothing else. It stays on the machine (C-02): the store writes `.indaba/registry/.gitignore`
  holding `*`, so a project that does not ignore `.indaba/` still never commits it.
- [x] AC-04. A **root** is the folder the command runs in, or one the person added (`indaba workflows add <folder>`),
  kept in a per-user list in the user's configuration folder. A scan lists what step 2's scan lists (C-03):
  `*.workflow.ai.yml` and `*.workflow.ai.yaml` up to 4 folders down, and the default `.indaba/workflow.ai.yml`; never
  `node_modules`, `.git` or anything else under `.indaba/`; never through a link; at most 200 files and 2000 folders
  per scan. One function does this for the page and the registry. The limits are starting values, not measurements.
- [x] AC-05. A scan parses each file with the parser a run uses and records the validation state. A file that does not
  parse is listed with its message, never dropped and never fatal. A file over 1 MiB is listed invalid and not read.
- [x] AC-06. A scan is incremental: a file whose size and modified time are unchanged is not read again. Whether an
  annotation still applies is decided by the entry's id, which a content change does not alter.
- [x] AC-07. Identity survives a rename or a move within a root when the content hash matches an entry whose file is
  gone; otherwise the old entry becomes `missing` and a new one appears. A `missing` entry is never deleted by a scan;
  the person removes it.
- [x] AC-08. A scan runs when a `workflows` command lists, and on request (`indaba workflows scan`). It can be cancelled
  through its `AbortSignal`. It never runs a workflow and never executes anything from a file.

**The command line**

- [x] AC-09. `indaba workflows list [--json] [--all]`, `scan`, `add <folder-or-file>`, `annotate <id> [--name <n>]
  [--project <p>] [--tag <t>]... [--no-tags] [--hide | --show] [--clear-name] [--clear-project]`, `remove <id>` and `copy <id> --to <folder>
  [--name <n>]`. An id may be given by its first characters when they name one entry. Each takes `--plugin <spec>`
  (repeatable), so a store a plugin registers is the one used (AC-13).
- [x] AC-10. `copy` writes `<folder>/<name>.workflow.ai.yml` (the name defaulting to the source's file name) with the
  source's bytes, refusing to overwrite (`wx`) and refusing a folder outside every root. It records `origin: copied`
  with the source id, and prints what a person will usually change (the workflow's `name`, and each path, glob and
  command the file holds) without rewriting the content (C-05).
- [x] AC-11. `remove` takes an entry out of the list and never deletes the file. An entry whose file a scan would find
  again is not removed: the command says to hide it instead, since it would come back. A path from outside Indaba is an
  id to look up; every path stored or read resolves inside its root and not through a link.
- [x] AC-12. The last run comes from the root's trace files, read by the reader `watch` uses. A trace records the
  workflow's `name`, not its file (C-06), so a run is an entry's when the entry is the only one of its root with that
  name; two entries with one name show no last run rather than a guess. A root with no traces shows "no run yet".
- [x] AC-13. A store registered through `PluginHost.registerRegistry` replaces the built-in one for that command, with
  the same contract and no access the built-in lacks. A store that throws fails the command, which says so; it does not
  fall back to the file store.

**Slice 2**

- [x] AC-14. `indaba ui` lists the registry of its `--root` folders, by the registry's ids. The first request for the
  list scans; a later one scans again when the last scan is 30 seconds old or more, so a page that asks again on window
  focus scans at most once every 30 seconds. Starting a run and opening a source find the workflow by the registry's id.
  An entry whose file is missing is not offered: it can neither run nor open.
- [x] AC-15. The Run a workflow panel shows each workflow's tags and last run (its state, when it started and its cost,
  "unknown" where the cost is unknown), hides hidden ones behind **Show hidden** with their number, and asks for the list
  again when the window gains focus.

## 4. Non-goals

- **No database in the default install.** No server, no container, no native module (C-01).
- **No second copy of the workflow.** The file is the definition.
- **No version history of workflows.** Git does that; an entry holds only a hash.
- **No sync between machines, and no sharing of annotations through git** (C-02). A store plugin can offer either.
- **No access control.** A registry lists what a person can already read; permissions belong to the host process.
- **No running of workflows.** The registry points at files; the engine runs them.
- **No deleting of files.** A separate, confirmed action, not in this spec.
- **No connected workflows** (workflows that depend on one another): a paid feature with its own spec, which uses this
  contract's ids (`plan-step-3.md`).

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the index is corrupt or unreadable | kept as `index.json.bak`, treated as empty, rescanned; the scan report says so once |
| a root is gone or unreadable | it lists nothing, since its index lived in it; the command names the root that cannot be read; other roots are unaffected |
| a file is half-written by an editor during a scan | the parse error is recorded as its state; the next scan corrects it |
| two processes write the index at once | each write is whole and atomic; the later one wins, and a scan restores entries it lost (annotations made in the lost write are lost) |
| a scan reaches a limit | it stops, keeps what it found, marks nothing missing that it did not look for, and reports `truncated` |
| a copy target exists, or is outside every root | refused; nothing is written |
| an id matches no entry, or several | the command says so and lists the candidates' ids |
| a store plugin throws | the command fails with its message (redacted); no fallback |

## 6. Security and data handling

File contents are untrusted: they are parsed with the safe parser and never evaluated. Names, tags and messages that
come from a file are shown as text, cleaned of control sequences. Paths are confined to their root and never followed
through a link, so a scan cannot be steered out of its root or into a device. The index holds no secrets and no file
contents, only paths, names, hashes and the first line of a parse error; error messages name a path relative to the
root and never an environment value. A copy writes with `wx` inside a root.

## 7. Where it lives

- `@indaba/core`: `WorkflowRegistry` and its value types, `PluginHost.registerRegistry` (optional).
- `@indaba/engine`: `FileWorkflowRegistry` (the index, the scan, the parser call, the last runs), and the scan of
  workflow files moved from the command line so both use one.
- `indaba` (the CLI): the `workflows` command group, the per-user list of roots, the plugin host's registration.

## 8. Clarifications

- **C-01. A file index, not CouchDB.** Decided by the maintainer, 2026-10-23. A registry of a few hundred small records
  does not need a database, and the repository's promise is "no database, no server, no container". CouchDB is a
  separate server process; PouchDB's value is replication, which is only worth its complexity once two machines share a
  list. The contract (AC-01, AC-13) makes that a plugin the day it is wanted. Rejected: SQLite through `node:sqlite`
  (experimental in Node 22), and storing definitions in a database (breaks editing by hand).
- **C-02. One index per root, on the machine.** Decided by the maintainer, 2026-10-23. The index next to its project, in
  `.indaba/registry/`, holds the cache and the annotations together; nothing is committed or merged. The draft said
  copying a project copies its list; that holds for a copied folder, not for git. Sharing annotations with a team is a
  store plugin's job.
- **C-03. Discovery is step 2's.** Decided by the maintainer, 2026-10-23: the registry lists exactly what the page lists
  today, including the project default `.indaba/workflow.ai.yml` the draft would have skipped. The draft's
  `*.workflow.yml` and shape check are dropped; a file with another name is added by path (`add <file>`, origin `added`).
- **C-04. Annotations are kept by id.** A tag or a hidden flag survives an edit; a rename keeps the id when the content
  is unchanged (AC-07).
- **C-05. Copy does not interpret.** Workflows differ across projects in prompts, paths and models; guessing which to
  change is worse than listing the places a person will look at. The form of `indaba ui` is the guided way.
- **C-06. A last run is found by the workflow's name.** The trace names the workflow, not its file, and recording the
  file would be a new span attribute (a change of its own). Matching by name within a root is right whenever the name is
  unique there, and when it is not, the entry says nothing rather than something wrong.
- **C-07. Two slices.** Decided by the maintainer, 2026-10-23: the contract, the store and the commands first; `indaba ui`
  and the page in the next pull request.
- **C-08. Remove is for what a scan would not bring back.** A missing entry, or one added by path whose file a scan does
  not match. Removing a scanned file would last until the next scan; hiding is what the person wants, and the command
  says so.
- **C-09. `registerRegistry` is optional on `PluginHost`,** as `registerLogSink` is, so an implementer of the interface
  is not broken; the draft accepted that break.
- **C-11. A root that is gone.** Its index was inside it, so there is nothing left to show as missing; the draft's
  "entries missing with the reason" needs a store outside the root. The command line skips a listed root that is not a
  folder and says so (stage 6 found it, 2026-10-23).
- **C-12. The roots of `indaba ui` are its `--root` folders** (slice 2, 2026-10-23), as they were for step 2; the
  per-user list of added folders belongs to `indaba workflows`. A page that serves other folders is started with them.
- **C-13. A run control or store built without a registry keeps step 2's scan and ids** (an embedder, the tests of
  step 2 and 3a); `indaba ui` always gives it the registry.
- **C-14. No annotating from the page in slice 2.** Names, tags and hiding are set with `indaba workflows annotate`;
  the page shows them. Editing them from the page is a later slice, with the registry's screens.
- **C-10. Ids.** Sixteen random hexadecimal characters, made once when an entry appears and kept in the index; the
  command line generates them, the store takes a generator. Step 2's ids (a hash of the root's position and the path)
  change when the order of roots changes; slice 2 moves the page to these.

## Artifacts not written

- `research.md`: the store alternatives are named in C-01; no measurement exists to compare.
- `data-model.md`: the entry is defined in `api-surface.md`, and the index file is described there.
- `events.md`: the registry emits no event and adds no span.
