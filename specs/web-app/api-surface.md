# API surface contract: The local web view

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**Minor (below 1.0).** Two new packages, one new CLI command, a new local HTTP surface. No existing class, workflow key
or command changes.

## Public symbols added

| Name | Kind | Notes |
| :--- | :--- | :--- |
| `@indaba/server` | npm package | `startServer(options): Promise<ServerHandle>`, `ApiContract` types, `HealthReport` builder |
| `@indaba/web` | npm package | the static bundle served by the server; exports no API of its own |
| `indaba ui [--port <n>] [--no-open] [--root <dir>...]` | CLI command | starts the server; ends with the command |

```ts
// @indaba/server
export interface ServerOptions {
  readonly roots: readonly string[];       // project roots the registry scans and the server may touch
  readonly port?: number;                  // default: a free port
  readonly host?: '127.0.0.1';             // the only accepted value in this version
  readonly open?: boolean;                 // default true
}
export interface ServerHandle {
  readonly url: string;                    // includes the token in the fragment
  close(): Promise<void>;
}
export const CONTRACT_VERSION = '1.0.0';

export type HealthState = 'ok' | 'warning' | 'missing' | 'unreachable' | 'denied';
export interface HealthItem {
  readonly target: 'runner' | 'agent' | 'key' | 'server' | 'sandbox' | 'folder';
  readonly name: string;
  readonly state: HealthState;
  readonly reason: string;                 // plain words; never a value
  readonly nextAction?: string;            // the one thing to do
}
export interface HealthReport { readonly checkedAt: string; readonly items: readonly HealthItem[]; }
```

## HTTP API (under `/api/v1`; every request carries `Authorization: Bearer <token>`)

| Endpoint | Purpose |
| :--- | :--- |
| `GET /contract` | `{ contractVersion }`; the page refuses a newer major |
| `GET /workflows` | the registry entries with last result and state (`specs/workflow-registry`) |
| `POST /workflows/scan` | rescan the roots; `POST /workflows/import` adds a root the person confirmed |
| `GET /workflows/{id}` | the workflow as a `WorkflowView`: steps, edges, every attribute with its source |
| `POST /workflows/{id}/validate`, `.../plan` | what `indaba validate` and `plan` return |
| `POST /workflows/{id}/copy` | a copy for another project, as a draft for the editor |
| `PUT /workflows/{id}` | save an edit (phase 3 of C-09) |
| `GET /health`, `GET /workflows/{id}/health` | `HealthReport` |
| `POST /runs` | `{ workflowId, inputs? , step? , from? }` starts a run or a single step (`specs/single-step-run`) |
| `GET /runs`, `GET /runs/{id}` | list and read runs (the `RunViewModel` of `specs/tui`) |
| `GET /runs/{id}/events` | **SSE**, resumable with `Last-Event-ID` |
| `GET /runs/{id}/board` | the board entries (`specs/run-blackboard`) |
| `GET /runs/{id}/changes` | the change list of a workspace; `POST .../apply`, `.../keep`, `.../discard` |
| `POST /runs/{id}/stop`, `POST /runs/{id}/resume` | stop; resume after a budget stop |
| `POST /runs/{id}/messages`, `POST /runs/{id}/answers` | a message to an agent; an answer to a question |

Every response is JSON except the stream. Errors are `{ code, message, nextAction? }` with a plain-words `message`.
Identifiers are opaque ids from the registry and the run store; a path never appears in a request.

## Types the page relies on

`WorkflowView` (new, in `@indaba/server`): `{ id, name, project, steps: StepView[], edges: [from, to][], defaults }`,
where each `StepView` carries `attributes: { name, value, source: 'step' | 'workflow' | 'default' }[]` and the resolved
runner chain, budget, workspace kind and sandbox. `RunViewModel` is the existing type of `@indaba/engine`, unchanged.

## Workflow schema, CLI (other commands), events and attributes

No change.

## Defaults introduced

Loopback only; token required; `Host` and `Origin` checked. Changing any of these later is a major.
