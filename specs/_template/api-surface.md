# API surface contract: <feature name>

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**patch | minor | major**

Reasoning:

## Public symbols added

| Name (FQCN) | Kind | Signature |
| :--- | :--- | :--- |

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |

## Removed or deprecated

| Name | Replacement | Removed in |
| :--- | :--- | :--- |

## Workflow schema, CLI, events and attributes

<!-- Fields, guard types, commands and options, event classes, span and attribute names. -->

| Surface | Name | Change |
| :--- | :--- | :--- |

## Defaults introduced or changed

<!-- A changed default breaks consumers without breaking their type-check. List every one. -->

| Option | Old default | New default |
| :--- | :--- | :--- |

## Checks

- [ ] Every type appearing in a new public signature is itself public (or deliberately `@internal`)
- [ ] Implementations are `final`; the extension point is an interface
- [ ] Arrays are typed precisely (`list<...>`, `array<string, ...>`)
- [ ] `composer stan` passes without an ignore
