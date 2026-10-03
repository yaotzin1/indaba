# Public API Rules

Binding.

## 1. What the public surface is

Everything a consumer can depend on. A consumer here is a PHP application that requires
`indaba/indaba`, a person who runs `bin/indaba`, or the author of a workflow file:

- every `public` and `protected` member of a class, interface or enum under `src/` not marked
  `@internal`;
- the **workflow file schema** (fields, guard types, `on_failure` actions, defaults);
- the **CLI** (commands, arguments, options, exit codes, machine-readable output);
- **emitted events** and **span and attribute names** (dashboards and alerts are built on them);
- configuration keys and environment variables.

A class marked `@internal` in its docblock is outside the contract. Mark wiring and helpers that way
rather than leaving a consumer to guess.

## 2. Classify before implementing

The semver impact of a change is decided at stage 3 and written into
`specs/<feature>/api-surface.md`. At release time it is recorded, not discovered. The table lives
in `.agents/skills/api_surface/SKILL.md`.

## 3. A changed default is a breaking change

Nothing fails to type-check, and every consumer's runs behave differently: a retry count, a timeout,
a quorum rule, the order ties are broken in. This is the change most often misclassified.

## 4. Everything reachable must be nameable

A type appearing in a public signature is itself public. A consumer who cannot name the type of an
argument cannot write a wrapper, a fake runner or a test double.

## 5. Contracts are interfaces; implementations are `final`

`RunnerInterface` is the extension point and is public. Concrete runners, the engine and value
objects are `final`: extension is by composition, and `final` makes adding a method a minor instead
of a break for subclassers.

## 6. Removal waits for a major

Deprecate with `@deprecated` naming the replacement, forward the implementation, and remove in the
next major. Trigger `E_USER_DEPRECATED` only where a consumer's call, not their configuration, is
the thing that is wrong.

## 7. Below 1.0

Consumers install `^0.x` and expect `0.x.y` not to break them. A breaking change takes the next
minor, is labelled as breaking in `CHANGELOG.md`, and carries a before and after.
