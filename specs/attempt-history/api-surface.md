# API surface contract: the attempts of a step

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**minor**

Reasoning: `StepView` gains a field and a new type is exported. A consumer that reads steps is unaffected; one that
builds a `StepView` by hand must add `history`. `StepView` is produced by `reduceRun`, not supplied by callers, and the
packages are below 1.0. The dashboard and plain views print extra lines for a step that was retried.

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/engine`, `trace/view` | interface | `AttemptView { readonly attempt: number; readonly startedAt: string; readonly endedAt: string \| undefined; readonly outcome: string; readonly reason: string \| undefined }` |
| `@indaba/engine`, `trace/view` | field | `StepView.history: readonly AttemptView[]` |
| `@indaba/engine`, `trace/view` | const | `MAX_ATTEMPTS_KEPT = 20` |

## Public symbols changed

None. `StepView.attempts` and `StepView.reason` keep their meaning.

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| Dashboard (`indaba watch`, `run --tui`) | detail pane of a step with more than one attempt | one row per earlier attempt: `attempt <n>: <state word> after <duration>: <first line of reason>` |
| Plain output (`run`, `watch --plain`) | step block | the same line under the step |
| Events, spans, attributes | none | none |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| none | | |

## Checks

- [x] Every type appearing in a new public signature is itself public
- [x] Implementations are not exported for subclassing; the extension point is an interface
- [x] Collections are typed precisely and read-only where they are not mutated
- [x] `pnpm qa` (Biome, `tsc` strict, Vitest) passes with no suppression comment
