# API surface: Landing recheck

> **Semver impact**: minor (below 1.0). One optional workflow field, one span attribute and one integration end state. A
> workflow without `land_check` behaves as `parallel-steps` specifies today. Classified under
> `.agents/skills/api_surface/SKILL.md`. Provisional until stage 3.
> **Depends on**: `specs/parallel-steps` (implemented) and `specs/run-integration` (not implemented; only AC-07 here).

## `@indaba/core`

```ts
/** The workflow model gains one optional member (AC-01): guards run on the combined result before a step lands. */
export interface WorkflowDefinition {
  // ...existing members unchanged...
  readonly landCheck?: readonly GuardDefinition[];
}
```

`GuardDefinition` is the existing type; nothing is added to it.

## Workflow file

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow | `land_check` | new, optional list of guards (same schema as a step's `guards`); absent means today's landing |

## Span attributes and states

| Surface | Name | Change |
| :--- | :--- | :--- |
| landing span | `indaba.land.check` | new: `passed`, `failed` or `skipped` (AC-08) |
| integration end state | `moved` | new value beside `conflicted` and `failed` (AC-07), after `run-integration` |

## Defaults

None changed. `land_check` is off unless written (C-01).

## Changes to other specs

Made when this one is accepted: `run-integration` AC-06 and its failure table say what a second move of the target does (AC-07
here); `parallel-steps` AC-22 points to this spec for the check before landing.

## Checks

- [ ] Every type in a new public signature is itself public
- [ ] `landCheck` is `readonly`, optional, and reuses `GuardDefinition`
- [ ] `pnpm qa` passes with no suppression comment
