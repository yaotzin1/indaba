# Plan: The registry's screens

> Stage 3. Spec: `spec.md`. Contract: `api-surface.md`.

## Shape

Three layers, each the pattern of an earlier slice:

1. **Contract** (`@indaba/core` web-contract): the types of `api-surface.md`, version 1.6.0.
2. **Server** (`@indaba/server`): `RegistryControl` and the seven resources, built like `RunControl` and `WorkflowStore`.
3. **Command line** (`indaba`): `createRegistryControl` over the registry and the finder that exist (`finder.ts`), plus the
   per-user roots file shared with `workflows.ts`.
4. **Page** (`@indaba/web`): the Workflows screen, its dialogs, client calls and messages.

## Decisions taken in the plan

| Question | Decision | Why |
| :--- | :--- | :--- |
| Child process or direct call? | Direct call (spec C-02) | the store is in-process; a child per click adds latency and a second index writer |
| How does a root added at run time reach the registry? | `FileWorkflowRegistry` takes its roots at construction, so `addRoot` builds a **new** registry over the longer list and swaps `registry` and `finder` behind the control | no change to the engine contract; the index lives in each root, so nothing is lost by a rebuild; a swap is atomic from a request's view |
| The finder of the run control and workflow store | they receive a `getFinder()` that reads the control's current finder, not a fixed one | otherwise a run could not start from an imported folder until restart |
| Shared roots file | move the read and write of `workflow-roots.json` out of `workflows.ts` into `run-control/roots.ts`, exported to both | one writer; the command keeps its behaviour and tests |
| Resolving a typed folder | `realpath`, `stat` is a directory, no file, no device; compared again at `addRoot` | spec section 6 |
| Counting files for the preview | `scanWorkflowFiles([folder])` (bounded; same walk as the registry), reading nothing | no parse; no index written for a folder not yet added |
| Root ids | SHA-256 of the resolved path, first 16 hex | spec C-04; `node:crypto` is already used by the CLI, never by the page |
| `removable` | computed in the control: `missing`, or `origin === 'added'` and a scan does not match its path | the page cannot know what a scan matches; the registry's own `remove` stays the judge (`would_return`) |
| The grid | `apsw-gridwright` with controlled selection and the search add-on | spec C-07; check the three items on the first task and fix gaps upstream |
| Show hidden | `?hidden=1` in the address | parent C-05: state that survives a reload lives in the URL |
| Landing | unchanged (spec C-05) | maintainer to confirm |

## Order

1. Contract types and the server resources with a fake control (tests drive every status).
2. The CLI control, roots file move, finder swap, `indaba ui` wiring.
3. Client calls, messages, the screen, dialogs.
4. Docs, spec ticks, `pnpm qa`, the node gates, a real-browser check.

## Risks

- **A swapped registry while a scan runs.** A scan in flight on the old registry finishes and writes its index; the new one
  scans again. The finder's one-scan-at-a-time guard is per finder, so the swap waits for the old scan (`await`) before
  replacing. Tested with a slow fake registry.
- **The typed path.** The only place a path from the browser is used. Tested: a link out of the folder, a file, a missing
  path, a very long path, a relative path, a path with control characters, a path that changes between resolve and add.
- **Grid gaps.** If the grid cannot offer a controlled selection or keyboard-complete row actions (parent AC-20), the gap is
  filed and fixed in `apsw-gridwright`; until then the toolbar acts on a checkbox column the page owns.
- **`messages.ts` conflicts.** Another branch (`feat/web-app-editing-graph`) adds a section to the same file. A new top-level
  `registry` section in its own place keeps a merge mechanical.

## Questions answered by reading

| Question | Answer |
| :--- | :--- |
| Does the registry offer annotate, copy and remove? | yes, `WorkflowRegistry` (`workflow-registry` AC-01) |
| Does the page already list tags and last runs? | yes, `WorkflowSummary` 1.4 and the Run a workflow panel |
| Does a route for one workflow exist? | yes, `/workflows/{id}` (source and form screens) |
| Is there a health report? | no (spec C-06) |
| Does the contract announce capabilities? | no; the page learns from `404`/`405` (spec AC-10) |
