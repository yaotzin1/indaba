# API surface contract: Tracker triggers

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

> **Status**: provisional, written at stage 1. Stage 3 confirms or corrects it.

## Semver classification

**minor** (below 1.0).

Reasoning: new optional contracts and a new command; nothing released changes. Adding a method to `PluginHost` breaks no
plugin (plugins call the host and never implement it); below 1.0 it is a minor named in the changelog, as `registerAdjudicator`
was (dependency map, "what breaks what").

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core` `TriggerSource` | interface | `name: string; poll(cursor: string \| undefined, signal?: AbortSignal): Promise<TriggerPage>; list?(query: TriggerQuery, signal?: AbortSignal): Promise<readonly TriggerEvent[]>` |
| `@indaba/core` `TriggerEvent` | interface | `{ source; id; kind: 'created' \| 'updated' \| 'labelled' \| 'commented' \| 'other'; title; body; labels: readonly string[]; link: string; at: string }` |
| `@indaba/core` `TriggerPage` | interface | `{ events: readonly TriggerEvent[]; cursor: string }` |
| `@indaba/core` `TriggerRule` | interface | `{ kind?: TriggerEvent['kind']; labels?: readonly string[]; title?: string; workflows?: Readonly<Record<string, string>> }` |
| `@indaba/core` `PluginHost.registerTriggerSource` | method | `(source: TriggerSource) => void` |
| `@indaba/engine` `TriggerMatcher`, `HandledStore` | classes | the rule check and the file store of handled ids |

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `PluginHost` | no trigger registration | adds `registerTriggerSource` | only another implementation of `PluginHost` is affected (the CLI's) |
| event union | current members | adds the six `trigger.*` events | exhaustive switches need a case |

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| CLI | `indaba listen`, `indaba triggers list` | new commands; options `--source`, `--match`, `--interval`, `--max-concurrent`, `--max-per-hour`, `--budget` |
| runtime state | `.indaba/triggers/` | new, gitignored |
| events | `trigger.received`, `.matched`, `.started`, `.ignored`, `.refused`, `.error` | new |
| workflow field | none | unchanged; inputs come from `workflow-inputs` |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| poll interval | (none) | 60 s, minimum 15 s |
| concurrent runs from `listen` | (none) | 1 |
| starts per hour | (none) | 6 |
| body bound | (none) | 20,000 characters |
