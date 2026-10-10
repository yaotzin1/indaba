# Events and telemetry contract: Workspaces without git

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it.

Names and values here are public contract once released. Only counts, kinds, sizes, short enumerated words and relative
paths are carried. No file contents, prompt, output, environment value or secret appears in any of them. Paths are
relative to the working directory, cleaned and redacted as in the run event stream, cut at 200 characters, and at most 20
appear in any one record. Messages for people (`spec.md`, section 8) are not telemetry and are not recorded here except
through the `reason` words below.

## Events added (`@indaba/core`)

None. The engine's event classes are not changed; everything is a span attribute or a span event, as the workspace is today.

## Span attributes added

On the step's span, for a step that runs in a tracked workspace:

| Attribute | Value |
| :--- | :--- |
| `indaba.workspace.kind` | `git_worktree` or `copy`; absent for a step with `isolation: none` and no isolated dependency |
| `indaba.workspace.name` | the directory name under `.indaba/worktrees` |

On the run's root span, once, when a copy is created:

| Attribute | Value |
| :--- | :--- |
| `indaba.workspace.files` | files copied |
| `indaba.workspace.bytes` | bytes copied |
| `indaba.workspace.skipped` | links and special files not copied |

On the step's span, after its guards and `changes()` have been asked:

| Attribute | Value |
| :--- | :--- |
| `indaba.workspace.added`, `.modified`, `.deleted` | counts in the workspace's change list |

On the run's root span, after the apply policy has run:

| Attribute | Value |
| :--- | :--- |
| `indaba.workspace.apply` | `applied`, `kept`, `discarded`, `conflict`, `refused`, `failed` or `not_asked` |

## Span events added

| Event | Attributes | When |
| :--- | :--- | :--- |
| `indaba.workspace.created` | `kind`, `name`, `files`, `bytes`, `skipped` | the working copy exists |
| `indaba.workspace.limit` | `limit` (`files`, `bytes` or `file_bytes`), `found`, `max` | a scan stopped at a limit, at creation or in `changes()` |
| `indaba.workspace.changes` | `added`, `modified`, `deleted`, `paths` (at most 20) | `changes()` completed for a guard or a landing |
| `indaba.workspace.landing` | `target` (`project` or `workspace`), `outcome` (`applied`, `conflict`, `unsafe`, `failed`, `rolled_back`), `files`, `paths` (at most 20 for a conflict) | a landing finished or was refused |
| `indaba.workspace.kept` | `name`, `kind`, `reason` (`asked`, `nobody_to_ask`, `conflict`, `budget`, `chosen`) | a workspace was kept |
| `indaba.workspace.recovered` | `name`, `files` | an interrupted landing was rolled back |
| `indaba.workspace.discarded` | `name`, `by` (`run`, `choice`, `command`) | a kept workspace was removed |

The ledger's existing attribute `indaba.arbiter.memo` gains the value `skipped` with the reason words
`folder_too_large` and, in a folder, no `uncommitted changes` reason (the fingerprint replaces it); the existing git
reasons are unchanged.

## Events and attributes changed

None. No existing name, payload or value changes. A run that uses only `none` and `git_worktree` gains the attributes
above and no others.

## Not recorded

File names beyond the bounded lists, file contents, hashes of individual files (the manifest digest is not an attribute),
the project directory's absolute path, and any answer a person gave to a question other than the word
`apply`, `keep` or `discard`.

## Checklist

- [ ] A test greps the records of a run in which the "agent" wrote a recognisable string into a file and finds it nowhere
- [ ] No record has more than 20 paths; every path is at most 200 characters
- [ ] The attributes are the same for both kinds where the meaning is the same
