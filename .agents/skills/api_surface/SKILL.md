---
name: api_surface
description: Use when adding, renaming or changing an exported type, class, interface, union member, workflow field, guard type, CLI option, event or span attribute, or when deciding whether a change is a patch, a minor or a major. Covers semver classification and the public surface of the npm packages.
---

# Public API & Semver Steward

Everything exported from a package is a promise to strangers. You cannot see who depends on it, and
you cannot fix their code. npm installs whatever the version says.

## What counts as public

- Everything reachable from a package's `exports` map: in practice what `src/index.ts` exports from
  `@indaba/core`, `@indaba/engine`, `@indaba/runners` and `indaba`. A deep import into `dist/` is not
  supported, and the `exports` map blocks it.
- The workflow file schema: field names, guard types, `on_failure` actions, defaults, accepted values.
- The CLI: command names, arguments, options, exit codes, machine-readable output.
- Event classes and their payloads; span names and attribute names (dashboards depend on them).
- Environment variables and configuration keys.

Keep helpers and wiring out of `index.ts`, or mark them `@internal` in their doc comment, so the
surface is the one you intend.

## Classify before you write

| Change | Version |
| :--- | :--- |
| New export, new method, new optional property or parameter with a default | minor |
| New workflow field that is optional, new guard type, new CLI option | minor |
| New required property on an options type, new required method on an interface | **major** |
| Renamed or removed export, changed parameter order or return type | **major** |
| Changed default value (timeout, retries, quorum, tie-break order) | **major** |
| New member of a string-literal union that consumers `switch` on exhaustively | **major** in practice |
| Changed event payload, span name or attribute name | **major** |
| Changed workflow schema meaning of an existing field | **major** |
| Widened accepted input type | minor |
| Narrowed accepted input type or widened return type | **major** |
| Bug fix with no signature or behaviour contract change | patch |

Below 1.0, a major takes the next minor and says so in the changelog.

## Design for a stable surface

- The extension point is an interface (`Runner`, `Guard`, `Plugin`); implementations are classes
  nobody is meant to subclass. Adding a method to an interface that third parties implement is a major;
  prefer a new optional interface (`McpCapable` is the pattern) over widening one.
- Value types are `readonly` interfaces or classes built through a constructor or a factory, so a new
  optional field is an additive change. With `exactOptionalPropertyTypes` on, an optional property
  means absent, not `undefined`: say which.
- Prefer string-literal unions plus a frozen const object (`StepStatus`, `GuardType`) over bare
  strings on public signatures, and type collections as `readonly T[]`. No `any` in a signature.
- A type appearing in a public signature is public and exported. A consumer who cannot name an
  argument's type cannot write a fake.
- The workflow schema is versioned by the file's `version` field; a breaking schema change bumps
  what the parser accepts and is a major.

## Deprecating without breaking

Keep the old export, mark it `@deprecated` in its doc comment with the replacement named, forward it
to the new implementation, remove it only in the next major. A deprecation that still works costs
one line; a removal costs every consumer an afternoon.

## Where it is recorded

`specs/<feature>/api-surface.md` before the code, `CHANGELOG.md` at the change, the pull request
template's classification box at review. `tsc` will not tell you a default changed; this process is
the only thing that does. Package versions move together until a reason to split them is recorded.
