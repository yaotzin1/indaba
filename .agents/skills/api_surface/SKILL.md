---
name: api_surface
description: Use when adding, renaming or changing a public class, interface, enum, workflow field, guard type, CLI option, event or span attribute, or when deciding whether a change is a patch, a minor or a major. Covers semver classification and the PHP public surface.
---

# Public API & Semver Steward

Everything public in `src/` is a promise to strangers. You cannot see who depends on it, and you
cannot fix their code. Packagist installs whatever the tag says.

## What counts as public

- Every `public` or `protected` member of a class, interface or enum not marked `@internal`.
- The workflow file schema: field names, guard types, `on_failure` actions, defaults, enum values.
- The CLI: command names, arguments, options, exit codes, machine-readable output.
- Event classes and their payloads; span names and attribute names (dashboards depend on them).
- Environment variables and configuration keys.

Mark wiring, helpers and parsers' internals `@internal` so the surface is the one you intend.

## Classify before you write

| Change | Version |
| :--- | :--- |
| New class, new method, new optional constructor argument with a default | minor |
| New workflow field that is optional, new guard type, new CLI option | minor |
| New required constructor argument, new abstract method on an interface | **major** |
| Renamed or removed public symbol, changed parameter order or return type | **major** |
| Changed default value (timeout, retries, quorum, tie-break order) | **major** |
| New enum case that consumers `match` exhaustively | **major** in practice |
| Changed event payload, span name or attribute name | **major** |
| Changed workflow schema meaning of an existing field | **major** |
| Widened accepted input type | minor |
| Narrowed accepted input type or return type widened | **major** |
| Bug fix with no signature or behaviour contract change | patch |

Below 1.0, a major takes the next minor and says so in the changelog.

## Design for a stable surface

- Implementations are `final`; the extension point is an interface (`RunnerInterface`). Adding a
  method to a `final` class is a minor, to a non-final one it can break subclassers.
- Value objects are `final readonly`, built through a constructor or a named constructor, so a new
  optional field is an additive change.
- Prefer enums and value objects over strings and arrays on public signatures, and annotate every
  array precisely (`list<string>`, `array<string, mixed>`) so PHPStan level 9 and the consumer's
  analyser see the shape.
- A type appearing in a public signature is public. A consumer who cannot name an argument's type
  cannot write a fake.
- The workflow schema is versioned by the file's `version` field; a breaking schema change bumps
  what the parser accepts and is a major.

## Deprecating without breaking

Keep the old symbol, mark it `@deprecated` with the replacement named, forward it to the new
implementation, remove it only in the next major. A deprecation that still works costs one line; a
removal costs every consumer an afternoon.

## Where it is recorded

`specs/<feature>/api-surface.md` before the code, `CHANGELOG.md` at the change, the pull request
template's classification box at review. PHPStan will not tell you a default changed; this process is
the only thing that does.
