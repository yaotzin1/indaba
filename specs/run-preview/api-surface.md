# API surface contract: Run preview

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

> **Status**: provisional, written at stage 1. Stage 3 confirms or corrects it.

## Semver classification

**minor** (below 1.0).

Reasoning: a new optional workflow field, new commands, a new optional contract and events. No default changes and nothing
released changes meaning. Adding a method to `PluginHost` is a minor below 1.0, named in the changelog.

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core` `PreviewSpec` | interface | `{ command: readonly string[]; install?: readonly string[]; ready?: { path?: string; text?: string }; port_env?: string; env?: readonly string[]; timeout_seconds?: number; max_minutes?: number }` |
| `@indaba/core` `PreviewHost` | interface | `start(request: PreviewRequest, signal?: AbortSignal): Promise<PreviewHandle>`; `PreviewHandle` has `address`, `output`, `stop(reason)` |
| `@indaba/core` `PluginHost.registerPreviewHost` | method | `(host: PreviewHost) => void` |
| `@indaba/engine` `LocalPreviewHost` | class | the built-in host: a local process on loopback |

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `WorkflowDefinition` | no `preview` | optional `preview?: PreviewSpec` | none for existing files |
| `PluginHost` | no preview registration | adds `registerPreviewHost` | only the CLI's implementation is affected |
| event union | current members | adds the four `preview.*` events | exhaustive switches need a case |

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow field | `preview` | new, optional |
| CLI | `indaba preview`, `indaba previews`; options `--stop`, `--yes`, `--max-previews` | new |
| events | `preview.started`, `.ready`, `.stopped`, `.failed` | new |
| span attributes | `indaba.preview.run`, `.step`, `.port`, `.outcome`, `.seconds` | new |
| `indaba schema`, `indaba catalog` | the `preview` field | extended |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| `preview.timeout_seconds` | (no such option) | 120 |
| `preview.max_minutes` | (no such option) | 30 |
| `--max-previews` | (no such option) | 3 |
