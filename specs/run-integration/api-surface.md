# API surface contract: Run integration

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

> **Status**: provisional, written at stage 1. Stage 3 confirms or corrects it.

## Semver classification

**minor** (below 1.0).

Reasoning: a new optional workflow field and CLI options, new optional contracts and events. The default (`off`) changes no
run. Adding event classes and a member to the event union is named in the changelog, as the dependency map's "what breaks
what" says.

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core` `IntegrationSpec` | interface | `{ mode: 'off' \| 'branch' \| 'merge'; target?: string; strategy?: 'squash' \| 'merge'; on_conflict?: 'stop' \| 'resolve' \| 'ask'; resolver?: RunnerRef[]; examiner?: RunnerRef[]; message?: string }` |
| `@indaba/core` `RunIntegrator` | interface | `integrate(request: IntegrationRequest, signal?: AbortSignal): Promise<IntegrationOutcome>` |
| `@indaba/core` `IntegrationOutcome` | union | `merged \| branch \| conflicted \| failed \| skipped`, each with the commits and files it knows |
| `@indaba/core` `PluginHost.registerIntegrator` | method | `(integrator: RunIntegrator) => void` (an addition to `PluginHost`: a minor below 1.0) |
| `@indaba/engine` `GitIntegrator` | class | the built-in `RunIntegrator` for local git |

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `WorkflowDefinition` | no `integrate` | optional `integrate?: IntegrationSpec` | none for existing files |
| event union | current members | adds the five `integration.*` events | exhaustive switches need a case (minor, named in the changelog) |

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow field | `integrate` | new, optional |
| CLI option | `--integrate <off\|branch\|merge>`, `--integrate-target <branch>`, `--yes` (for this prompt only) | new |
| events | `integration.started`, `.merged`, `.conflicted`, `.resolved`, `.failed` | new |
| span attributes | `indaba.integrate.mode`, `.target`, `.outcome`, `.base`, `.result`, `.resolved_by` | new |
| artifact | a second `patch` for a merged result | new |
| `indaba schema`, `indaba catalog` | the `integrate` field and its values | extended |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| `integrate.mode` | (no such option) | `off` |
| `integrate.on_conflict` | (no such option) | `stop` |
| `integrate.strategy` | (no such option) | `squash` |
