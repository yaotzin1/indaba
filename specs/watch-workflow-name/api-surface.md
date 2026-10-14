# API surface contract: the workflow name in the list of runs

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**minor**

Reasoning: `RunSummary` gains a field, and `summariseRun`'s return type gains one. Both are additive for a consumer
that reads them. A consumer that constructs a `RunSummary` itself must now supply `workflow`; `RunSummary` is a type
the reader returns, not one the packages ask a caller to build, and the packages are below 1.0. The `indaba watch`
list gains a last column.

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/engine`, `trace/trace-reader` | field | `RunSummary.workflow: string \| undefined` |

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `summariseRun` | returns `{ startedAt: string \| undefined; status: RunStatus }` | returns `{ startedAt: string \| undefined; status: RunStatus; workflow: string \| undefined }` | additive |
| `TraceReader.listRuns` | each summary is `{ runId, startedAt, status }` | each summary also has `workflow` | additive |

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| CLI | `indaba watch` (no run id) | prints `<id>  <status>  <started>  <workflow>`; `-` when the name is unknown; the name is printed as plain text on one line and cut at 60 characters with `...` |
| Span attribute | `indaba.workflow.name` | read, not written; already emitted on the root span |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| none | | |

## Checks

- [x] Every type appearing in a new public signature is itself public
- [x] Implementations are not exported for subclassing; the extension point is an interface
- [x] Collections are typed precisely and read-only where they are not mutated
- [x] `pnpm qa` (Biome, `tsc` strict, Vitest) passes with no suppression comment
