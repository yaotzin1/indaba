# API surface contract: The local web view

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**Minor (below 1.0).** Two new packages, one new CLI command, a new local HTTP surface, and new type declarations in
`@indaba/core` (an addition, with no runtime code). No existing class, workflow key or command changes; where a
declaration moves from `@indaba/engine` to core, the engine re-exports it, so no import path breaks.

## Public symbols added

| Name | Kind | Notes |
| :--- | :--- | :--- |
| `@indaba/core` `web-contract` | types only | `WorkflowView`, `WorkflowStepView`, `HealthReport` and its parts, `ApiError`, the request and response types listed below. No function, class or `node:` import |
| `@indaba/server` | npm package | `startServer(options): Promise<ServerHandle>`, `RunStarter`, the health report builder |
| `@indaba/web` | npm package | the static bundle served by the server; exports no API of its own; imports `@indaba/core` types only |
| `indaba ui [--port <n>] [--no-open] [--root <dir>...]` | CLI command | starts the server; ends with the command, and stops the runs it started |

```ts
// @indaba/server
export interface RunStarter {
  start(request: StartRunRequest): Promise<StartRunResponse>;   // the composition root of `indaba` supplies it
  stop(runId: string): Promise<void>;                           // the engine's teardown; also called by close()
}
export interface ServerOptions {
  readonly roots: readonly string[];       // project roots the registry scans and the server may touch
  readonly runs: RunStarter;               // how a run starts; the server registers no runner or plugin itself
  readonly staticDir: string;              // the folder of the built @indaba/web, resolved by `indaba ui`
  readonly port?: number;                  // default: a free port
  readonly host?: '127.0.0.1';             // the only accepted value in this version
  readonly token?: string;                 // default: a random token at each start; a test passes its own
  readonly pollMs?: number;                // how often the streams look for news (default 1000)
  readonly sleep?: Sleep;                  // replaces the wait between polls; tests inject one
  readonly coalesceMs?: number;            // events of one run this close together are one snapshot (default 50)
}
export interface ServerHandle {
  readonly url: string;                    // includes the token in the fragment
  readonly port: number;
  close(): Promise<void>;                  // stops every run the server started, then closes the listener
}
export const CONTRACT_VERSION = '1.0.0';   // the page's own major is compiled into it at build time (how: plan time)

// @indaba/core, `web-contract`: declarations only
export type HealthState = 'ok' | 'warning' | 'missing' | 'unreachable' | 'denied';
export interface HealthItem {
  readonly target: 'runner' | 'agent' | 'key' | 'server' | 'sandbox' | 'folder';
  readonly name: string;
  readonly state: HealthState;
  readonly reason: string;                 // plain words; never a value, never a URL
  readonly nextAction?: string;            // the one thing to do
}
export interface HealthReport { readonly checkedAt: string; readonly items: readonly HealthItem[]; }
export interface ApiError { readonly code: string; readonly message: string; readonly nextAction?: string; }
```

## HTTP API (under `/api/v1`)

Every request carries `Authorization: Bearer <token>` and is refused without it. The one exception is the static files of
the page, which are served without the token because a browser navigation cannot send a header; they still pass the
`Host` check and carry the Content-Security-Policy. The accepted `Host` values are `localhost`, `127.0.0.1` and `[::1]`,
each with the server's own port. A request that changes anything (every method but `GET`) must carry an `Origin` equal
to the server's own address.

| Endpoint | Request body | Response | Purpose |
| :--- | :--- | :--- | :--- |
| `GET /contract` | none | `{ contractVersion }` | the page refuses to run when its major is older than the server's |
| `GET /workflows` | none | `RegistryEntryView[]` | the registry entries with last result and state (`specs/workflow-registry`) |
| `POST /workflows` | `{ project: string, name: string, template?: string }` | `RegistryEntryView` | create a workflow in a registered project, as a draft for the editor |
| `POST /workflows/scan` | none | `RegistryEntryView[]` | rescan the roots |
| `POST /workflows/import` | `{ path: string, confirmed: boolean }` | `{ resolved: string, entries: RegistryEntryView[] }` | with `confirmed: false` returns the resolved folder to show the person and changes nothing; with `true` adds it as a root |
| `DELETE /workflows/{id}` | none | `{ removed: true }` | remove the entry from the registry; never deletes the file |
| `GET /workflows/{id}` | none | `WorkflowView` | steps, edges, every attribute with its source |
| `POST /workflows/{id}/validate`, `.../plan` | none | what `indaba validate` and `plan` return | |
| `POST /workflows/{id}/copy` | `{ project: string }` | `{ draftId: string }` | a copy for another project, as a draft for the editor |
| `PUT /workflows/{id}` | `{ draftId: string }` | `WorkflowView` | save an edit (phase 3 of C-09) |
| `GET /health`, `GET /workflows/{id}/health` | none | `HealthReport` | |
| `POST /runs` | `StartRunRequest` | `StartRunResponse` | starts a run or a single step (`specs/single-step-run`); a workflow that needs the confirmation of AC-22 is refused with code `needs_confirmation` until `confirmed: true` |
| `GET /runs`, `GET /runs/{id}` | none | run summaries; the `RunState` data shape of `specs/tui` | list and read runs |
| `GET /runs/{id}/steps/{step}/log` | none | text, bounded by a `Range` header | the full output of a step, for "open the full log" |
| `GET /runs/{id}/events` | none | **SSE** | the events of one run, resumable with `Last-Event-ID` |
| `GET /events` | none | **SSE** | the server-wide stream: a run started or ended, a registry entry added, changed or removed; resumable with `Last-Event-ID` |
| `GET /runs/{id}/board` | none | the board entries (`specs/run-blackboard`) | |
| `GET /runs/{id}/changes` | none | `ChangeListView` | the change list of a workspace |
| `POST /runs/{id}/changes/apply`, `.../keep`, `.../discard` | `{ confirmed: boolean }` | `ChangeListView` | the choices of `specs/workspace-without-git`; a destructive one needs `confirmed: true` |
| `POST /runs/{id}/stop`, `POST /runs/{id}/resume` | none | `RunSummaryView` | stop; resume after a budget stop |
| `POST /runs/{id}/messages` | `{ stepId: string, text: string }` | `{ accepted: boolean, reason?: string }` | a message to an agent; unavailable until a spec and a runner capability exist (C-07) |
| `POST /runs/{id}/answers` | `{ questionId: string, answer: string }` | `{ recorded: true }` | an answer to a question (`specs/ruling-channel`) |

Every response is JSON except the streams and the log. Errors are `ApiError` with a plain-words `message`. Identifiers are
opaque ids from the registry and the run store; a path appears in no request but the confirmed import above, and never in
a response.

## Types the page relies on

All declared in `@indaba/core`, `web-contract`, with no runtime code:

- `WorkflowView`: `{ id, name, project, steps: WorkflowStepView[], edges: [from, to][], defaults }`. Each
  `WorkflowStepView` carries `attributes: { name, value, source: 'step' | 'workflow' | 'default' }[]` and the resolved
  runner chain, budget, workspace kind and sandbox. It is named `WorkflowStepView` because `@indaba/engine` already
  exports a `StepView` (`packages/engine/src/trace/view.ts`), a different type.
- `StartRunRequest`: `{ workflowId, inputs?, step?, from?, confirmed? }`; `StartRunResponse`: `{ runId }`.
- `RegistryEntryView`, `RunSummaryView`, `ChangeListView`: the fields the screens of the spec show, defined in the plan.
- The run view model is the existing `RunState` of `@indaba/engine` (with `StepView`, `AttemptView`, `RunnerView`),
  unchanged in behaviour. The page needs its data shape, so the declarations move to core and the engine re-exports them;
  the move is checked at plan time (spec C-04). The earlier name `RunViewModel` named no existing type.

## Workflow schema, CLI (other commands), events and attributes

No change to the workflow schema, the other commands or the events. **One span attribute is added** (task T-20, amended
2026-10-20 in `tasks.md`): `indaba.workflow.structure` on the run's root span, written when the run starts, a JSON list of
`{ id, dependsOn, onFailure?: { action, target?, maxRetries } }` in the order the engine runs the steps. With it,
`RunState` (and so `RunSnapshot`) gains `structure: readonly StepStructure[] | undefined`, and `@indaba/core` gains the
declarations `StepStructure` and `StepFailureRoute`; `@indaba/engine` gains `describeStructure`, `readStructure`,
`WORKFLOW_STRUCTURE_ATTRIBUTE` and `MAX_STRUCTURE_STEPS`. Adding an attribute and a field is a minor; no existing
attribute or field changes.

## Defaults introduced

Loopback only; token required for every API request; `Host` checked, and `Origin` checked on every request that changes
anything. Changing any of these later is a major.
