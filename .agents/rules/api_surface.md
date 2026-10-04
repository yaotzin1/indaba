# Public API Rules

Binding.

## 1. What the public surface is

Everything a consumer can depend on. A consumer here is a program that imports `@indaba/core`,
`@indaba/engine` or `@indaba/runners`, a person who runs `indaba`, or the author of a workflow file
or a plugin:

- every name exported from a package's `index.ts` (the `exports` map in `package.json` allows no
  deep import), and every member of an exported class or interface not marked `@internal` in its
  doc comment;
- the **workflow file schema** (fields, guard types, `on_failure` actions, defaults);
- the **CLI** (commands, arguments, options, exit codes, machine-readable output);
- **emitted events** and **span and attribute names** (dashboards and alerts are built on them);
- configuration keys and environment variables.

A symbol marked `@internal` is outside the contract, and is not exported from `index.ts`. Keep
wiring and helpers out of the index rather than leaving a consumer to guess.

## 2. Classify before implementing

The semver impact of a change is decided at stage 3 and written into
`specs/<feature>/api-surface.md`. At release time it is recorded, not discovered. The table lives
in `.agents/skills/api_surface/SKILL.md`.

## 3. A changed default is a breaking change

Nothing fails to type-check, and every consumer's runs behave differently: a retry count, a timeout,
a quorum rule, the order ties are broken in. This is the change most often misclassified.

## 4. Everything reachable must be nameable

A type appearing in a public signature is itself exported. A consumer who cannot name the type of an
argument cannot write a wrapper, a fake runner or a test double. Adding a member to a union (a new
`StepStatus`) is a break for anyone who switches over it exhaustively.

## 5. Contracts are interfaces; implementations are not meant to be subclassed

`Runner`, `Guard`, `Plugin` and `PluginHost` are the extension points, are defined in
`@indaba/core`, and are interfaces. Concrete runners, the engine and value objects are classes
whose fields are `readonly`: extension is by composition, and not documenting a subclassing contract
makes adding a method a minor instead of a break.

## 6. Removal waits for a major

Deprecate with a `@deprecated` doc comment naming the replacement, forward the implementation, and
remove in the next major. A runtime warning is for a consumer's call, not their configuration, being
the thing that is wrong.

## 7. Below 1.0

Consumers install `^0.x` and expect `0.x.y` not to break them. A breaking change takes the next
minor, is labelled as breaking in `CHANGELOG.md`, and carries a before and after.
