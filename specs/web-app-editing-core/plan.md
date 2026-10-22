# Plan: The local web view, step 3a (edit a workflow's source and save it)

The spec is [`spec.md`](spec.md), the signatures [`api-surface.md`](api-surface.md).

## Where each piece goes

| Piece | Package | Why there |
| :--- | :--- | :--- |
| Contract types | `@indaba/core` `web-contract` | shared by page and server, declarations only |
| Three resources, `WorkflowStore` interface, body cap | `@indaba/server` | HTTP is its job; it writes no file (layers test) |
| Read, check, atomic save, conflict | `indaba` `run-control/source.ts` | file reads and writes and the parser are the composition root's; it reuses step 2's `scanRoots` and `readWorkflow` |
| Edit in the panel, the source screen | `@indaba/web` | the page |

## How a save goes

1. The page has the text and the `contentHash` it read with `GET .../source`. It sends `PUT { text, baseHash }`.
2. The server checks token, `Host`, `Origin`, JSON, size, the id's shape, `text` and `baseHash`, then calls
   `WorkflowStore.save(id, { text, baseHash })`.
3. The store scans afresh and finds `id` (else `workflow_not_found`), reads the file with `readWorkflow` (regular file,
   inside its root by realpath, at most 1 MiB) and hashes it. A hash other than `baseHash` is `changed_on_disk` with the
   current text and hash.
4. It writes `text` to `<target>.<pid>.<n>.indaba-save` beside the target with `wx` and the target's mode, reads the
   target once more and checks it is still a regular file inside the root with the same hash, then renames the temporary
   file over it. Any failure removes the temporary file and is `not_saved`.
5. It answers the new hash and the parser's problems for `text`. The confirmation store keys on the hash, so the next
   Run is unconfirmed (AC-07) without any call between the two.

**The window.** Between the last check and the rename another program could write the file; that write is lost. The
window is the time of a `stat`, a read of at most 1 MiB and a rename. Closing it needs a lock every editor would honour,
which does not exist; the check narrows it to that, and the person's own editor shows a changed file on its next read.

## Positions

`WorkflowParser` reports a YAML syntax error as `invalid YAML: <message>`, and the `yaml` package words its message with
`at line N, column M`. The store takes `line` and `column` from that, and nothing else. When `workflow-editor` exists,
`problems()` replaces this, with positions for every problem (the plan of step 3).

## The page

- `RunPanel` gets **Edit** on every workflow (also an invalid one: that is where it gets fixed). It navigates to
  `/workflows/{id}` and closes the dialog. The router gains the route.
- `SourceScreen`: loads the source; a header with the path and project; a `textarea` with a line-number gutter that
  scrolls with it; Tab inserts two spaces, Escape then Tab moves on (so the editor is no keyboard trap); the problems
  list (a problem with a line is a button that selects that line and column); a status line (saved, unsaved changes,
  checking, saving); **Save**; **Run** once the saved file has no problems (opens the Run panel's flow for that id).
- The check is debounced (`CHECK_DELAY_MS`, the settings screen's value) and only the latest answer is shown.
- Unsaved changes: `beforeunload` while the text differs from what was saved, and an in-page question on Back or the
  header's links.
- A conflict shows the disk's version read-only beside the person's, with **Use the version on disk** and **Keep mine and
  save** (a `PUT` with the disk's hash).
- `client.ts`: `workflowSource`, `saveWorkflowSource`, `checkWorkflow`; `messages.ts`: `editor`.

## Decisions recorded

- **`WorkflowStore` mirrors `RunControl`.** Same pattern, separate interface: a server may be given one without the
  other, and each is tested alone.
- **The store reuses the step 2 scan and read.** One definition of "a workflow of this root", one confinement check.
- **No editor library** (spec, non-goals).

## Analysis (stage 5)

- Published signature broken: no; additions only.
- `node:` in core: no.
- New runtime dependency: none.
- Untrusted data reaching a shell, path, URL or log: the id is matched against the scan; the text is written only to the
  scanned file and never logged; `baseHash` is compared, never used as a name.
- Clock, randomness, environment in decision logic: none; the temporary file's name uses the injected pid and a counter.
- Unbounded buffer: the body is capped before parsing, the text by bytes, the check by the text.
- Process lifetime: no process is started.
- Security audit: no new construct of the kinds it bans; checked by the hook on every commit.
