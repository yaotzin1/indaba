# Plan: The workflow registry, slice 1

Against [`api-surface.md`](api-surface.md). Read [`spec.md`](spec.md) first.

## Modules

- `@indaba/core` `src/registry/index.ts`: the types, `RegistryError`, the optional `PluginHost.registerRegistry`.
- `@indaba/engine` `src/registry/files.ts`: `scanWorkflowFiles` and `readWorkflowFile` (the confined read), moved from
  `packages/cli/src/run-control/scan.ts` with their limits; the command line's `scanRoots`, `readWorkflow` and
  `UnreadableWorkflow` become thin wrappers and re-exports, so step 2 and 3a keep their behaviour and tests.
- `@indaba/engine` `src/registry/index-file.ts`: reading (with recovery to `index.json.bak`), checking each entry's
  fields, writing whole (temporary file with `wx`, rename), the `.gitignore`.
- `@indaba/engine` `src/registry/file-registry.ts`: `FileWorkflowRegistry`.
- `indaba` `src/workflows.ts`: parsing the arguments, the roots file, printing; `main.ts` wires it with the plugin
  host's registry when one was registered.

## The scan, per root

1. Read the index; an unreadable one is renamed `index.json.bak` and the scan starts empty (`recovered`).
2. The walk (`scanWorkflowFiles`) over every root at once, so its limits are the page's.
3. A listed file whose path is in the index with the same size and modified time keeps its entry as it is (AC-06).
   Otherwise it is read (confined, at most 1 MiB), hashed, parsed: `valid`, or `invalid` with the first problem's first
   line, cleaned; a file over the limit is `invalid` without being read.
4. An entry the walk did not list is looked at directly: still a regular file inside the root, it is kept (and read
   again when its size or time changed), which covers a file added by path and a walk cut short by a limit; gone, it
   is a candidate for a move.
5. A newly listed file whose hash equals a candidate's keeps that entry's id and annotations at its new path (`moved`);
   one candidate per file, the first by path. Every other new file gets a new id; every candidate left is `missing`.
6. A root that is not a readable folder: every entry `missing` ("the root cannot be read"), the index not written.
7. The index is written whole; `.indaba/registry/.gitignore` is written when absent.

The last runs: `TraceReader(<root>/.indaba/traces).listRuns()` once per `list`, newest first; an entry gets the newest
run whose `workflow` equals its workflow's name when no other entry of the root has that name (AC-12).

## Annotate, remove, copy, add

- `annotate`: the person's values in the index; `null` clears. Tags are trimmed, empty ones dropped, duplicates
  dropped, order kept.
- `remove`: refused with `would_return` when the entry is `scanned` and its file is still there, or `added` and the walk
  lists it; otherwise taken out of the index.
- `copy`: the folder must be inside a root (realpath); the file is `<name>.workflow.ai.yml` with the name made of
  letters, digits, `-`, `_` and `.` only; the source's bytes are read confined and written with `wx`; the new entry
  is `copied` with `copiedFrom`. `toReview` comes from the parsed source: `name`, then each `artifacts` value,
  `input_artifacts`, `outputs`, `permissions.fs.read` and `.write`, guard `paths`, and the number of commands of each
  shell step, each as `path: value`.
- `add <file>`: inside a root (realpath), a regular file of at most 1 MiB; an entry `added`, or the existing one.

## Stage 5: analyze

| Question | Answer |
| :--- | :--- |
| A published signature broken without the right version? | No. `registerRegistry` is optional; the moved functions keep their command line exports. Minor. |
| A `node:` import or I/O in `@indaba/core`? | No: types and one error class. |
| A new runtime dependency? | No. |
| Untrusted data reaching a shell, a path, a URL or a log? | No shell. Paths: every file is confined by realpath to its root; a copy's name is restricted to a safe set of characters and written with `wx`. Logs hold counts, roots and ids, never content. A file's name and messages are cleaned before they are stored or printed. |
| A wall clock, randomness or environment read in decision logic? | The clock and the ids are injected; the command line supplies `new Date` and random bytes. |
| An unbounded loop, retry or buffer? | The walk's limits; a file is read only up to 1 MiB; the index holds at most what the walk can list plus added files. |

## Tests

- Engine, on temporary folders: a scan lists what step 2 lists; incremental (an unchanged file is not read again,
  shown by a parser that counts); a change re-reads; a move keeps id and annotations; a deleted file is `missing` and
  stays; an unreadable index is set aside; a root that is gone; a link is not followed and a file reached through a
  linked folder is refused; annotate, remove (each refusal), copy (exists, outside, a name with a separator, toReview),
  add; the last run by name, and none when two entries share it; the `.gitignore`; an aborted scan writes nothing.
- CLI: each command and its output, `--json`, an id prefix and an ambiguous one, the roots file, a plugin store used,
  a plugin store that throws, the exit codes.
- Core: `RegistryError`'s name and code; a plugin registering a registry through the host.
