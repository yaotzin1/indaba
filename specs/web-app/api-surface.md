# API surface contract: Web application (React)

> Specification only. Nothing here exists yet; this is the contract implementation will be written
> against, and it changes only through this spec.

## Semver classification

**minor** (below 1.0): adds a new package and, through `specs/run-api`, a new HTTP surface. It changes
no existing PHP class, workflow key or command.

## Public symbols added

None in PHP by this spec. The deliverable is a separate package:

| Name | Kind | Notes |
| :--- | :--- | :--- |
| `web/` | npm workspace, private (not published) | the React application; versioned with the repository |
| `web/openapi-types` | generated | TypeScript types generated from the run API's OpenAPI document |

## Consumed contract (owned by `specs/run-api`, listed here so the dependency is explicit)

| Endpoint | Purpose |
| :--- | :--- |
| `GET /api/v1/workflows` | workflow files under the project root |
| `POST /api/v1/workflows/validate`, `.../plan` | what `bin/indaba validate` and `plan` return, incl. MCP findings |
| `POST /api/v1/runs` | start a run (workflow, task id); returns the run id |
| `GET /api/v1/runs`, `GET /api/v1/runs/{id}` | list and read runs |
| `GET /api/v1/runs/{id}/events` | **SSE** stream of step and span events, resumable with `Last-Event-ID` |
| `GET /api/v1/runs/{id}/artifacts/{name}` | spec, patch, other artifacts (text, size-limited) |
| `POST /api/v1/runs/{id}/cancel` | request cancellation |

Event names the UI relies on come from `specs/observability`: `StepStatusChanged` and span start/end
with the `gen_ai.*` and `indaba.*` attributes (names only for MCP). The contract carries an explicit
`contractVersion`; the UI refuses a newer major.

## Workflow schema, CLI, events and attributes

No change.

## Defaults introduced

Server bind address `127.0.0.1`; token required; these belong to `specs/run-api` and are noted here
because the UI's first-run experience depends on them. Changing them later is a major.
