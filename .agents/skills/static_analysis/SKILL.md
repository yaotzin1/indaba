---
name: static_analysis
description: Use when tsc or Biome fails, when typing unknown data, generics or callbacks, when tempted to suppress a compiler or lint error, or when changing tsconfig.base.json or biome.json. Covers strict TypeScript with no escape hatch.
---

# Static Analysis Specialist

`pnpm typecheck` runs `tsc` over every package's `src` and `test` with the flags in
`tsconfig.base.json`. `pnpm lint` runs Biome (`pnpm lint:fix` applies its fixes and import order).
Both are part of `pnpm qa`, on any OS.

## The flags that stand in for "level 9"

`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`,
`noImplicitOverride`, `noFallthroughCasesInSwitch`, `isolatedModules`. `scripts/security-audit.mjs`
and `scripts/check-workflow.mjs` fail when one is switched off, and when `allowJs` or `checkJs` appear.

## The rule: no escape hatch

No `any`, no `!` non-null assertion, and no suppression comment of any tool: `@ts-ignore`,
`@ts-expect-error`, `@ts-nocheck`, `biome-ignore`, `eslint-disable`. Biome has `noExplicitAny`,
`noTsIgnore` and `noNonNullAssertion` at `error`, and `biome.json` has no rule turned off to make a
file pass. An error is information: the type is wrong, or the compiler cannot see it and you can help
it see.

## Fix it properly

| The compiler says | Do this |
| :--- | :--- |
| `unknown` from `yaml`, `JSON.parse` or `fetch` | validate at the boundary into a typed object, throwing `WorkflowValidationError` (or a `RunnerError`) on a bad shape; narrow once, trust after |
| `possibly undefined` from an index or `Map.get` | handle the absent case (early return, default, a thrown error naming the key), not `!` |
| an optional property rejected under `exactOptionalPropertyTypes` | omit the key (`...(x !== undefined ? { x } : {})`) instead of assigning `undefined` |
| a callback shape | a named function type or a small interface, e.g. `type Listener<E> = (event: E) => Promise<void>` |
| a union you must handle fully | a `switch` over the discriminant ending in a `never` assertion helper |
| a type used only as a type | `import type`, as `verbatimModuleSyntax` and Biome require |
| dead code | delete it |
| `child_process` or `fetch` results | wrap in a small typed class so the rest of the code is typed |

Type predicates (`value is Foo`) and `instanceof` checks are fine at a boundary where data enters.
`as` casts are not a fix: a cast that widens or asserts a shape you did not check is a suppression in
disguise; the audit flags `as any`.

## Style

Biome decides formatting (2 spaces, single quotes, semicolons, trailing commas, 110 columns, LF); do
not argue with it by hand. Prefer `readonly` properties and interfaces, `const` objects with a union
type over `enum`, `Error` subclasses with `cause`, relative imports with a `.js` extension, and no
default exports.

## When a rule is genuinely wrong

Change the configuration in a reviewed commit that carries `Workflow-Change: <why>` (the files are
protected) and update this skill. Switching a strictness flag off is never that.

## Upgrading the toolchain

A major TypeScript or Biome upgrade can add findings. Fix them in the upgrade change, on the chore
track when no behaviour changes, and update `project.toolchain` in `workflow.ai.yml` (the checker
compares the majors with the root `package.json`).
