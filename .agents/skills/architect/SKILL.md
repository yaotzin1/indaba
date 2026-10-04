---
name: architect
description: Use when deciding which package a behaviour belongs in, when a node: import or a dependency is about to appear in the pure domain, or when touching layering and dependency direction. Covers the domain/infrastructure boundary and the engine invariants.
---

# Architecture & Boundary Steward

You own the seam that makes Indaba testable and trustworthy: a deterministic domain that knows
nothing about processes, sockets or the filesystem, and infrastructure that knows nothing about
debate rules.

## The boundary is a contract, not a preference

`@indaba/core` (`packages/core/src`) imports only its own relative modules: no `node:` builtin, no
third-party package, no other Indaba package. `packages/core/test/architecture.test.ts` scans every
import and fails the build. Why it matters:

- The domain has to run in a plain test and in a browser, with no process, no filesystem and no
  network, so the whole state machine and the consensus rules are testable in milliseconds.
- A `node:child_process` or `fetch` import in the domain is the first step to a rule that can only be
  tested by spawning something.
- Determinism needs a controlled edge. The wall clock, randomness and the environment are injected
  there (`Clock`, `IdGenerator`).

If a change appears to need `node:` in the domain, it needs an interface the domain owns and an
implementation at the edge.

## Layers, one direction

```
@indaba/core      model, DAG, step state, mesh, Runner and Guard contracts, Plugin and PluginHost,
                  Tracer and value types, Clock, IdGenerator, EventDispatcher     (no imports)
@indaba/engine    parser (yaml), guards, WorkflowEngine, git worktrees, JSONL exporter  (core, yaml)
@indaba/runners   ShellRunner, OpenRouterRunner, agent CLI runners, registry            (core)
indaba (cli)      commands, plugin loading, composition root                  (core, engine, runners)
```

Imports point toward core. `packages/engine/test/layers.test.ts` and
`packages/runners/test/layers.test.ts` fail when engine or runners reach upward or sideways.

## Where a behaviour belongs

Ask in this order and stop at the first yes.

1. **Is it a rule about what is legal?** A transition, a quorum, a cycle, a message type. `@indaba/core`.
2. **Does it touch the outside world?** A process, git, HTTP, the filesystem, the clock. An interface
   in core (or in the layer that needs it), an implementation in `engine` or `runners`.
3. **Does it decide whether to proceed?** A guard returns a `GuardResult`, the engine acts. The
   contract is in core, built-in guards live in `packages/engine/src/guard`.
4. **Is it presentation or argument parsing?** `indaba` (the CLI).

A behaviour that seems to belong in two is usually two behaviours: a domain rule and the adapter that
feeds it.

## The engine invariants

- One state per step, legal transitions only, illegal ones throw `InvalidTransitionError`.
- The DAG is validated at parse time; ties break by declaration order.
- Retries are bounded and carry only the last failure.
- The engine owns teardown: processes and worktrees die with the run, however it ends.
- Failure is a `RunResult` when the caller must decide, a `RunnerError` when it could not run.

## Before you add an option

Every option is a decision a consumer inherits and a branch the tests have to cover. Prefer a new
module behind an interface; then an optional property with a default on that module's options; then
a workflow field, which is public schema. State the default in the doc comment and record it in
`api-surface.md`.

## Composition

`packages/cli` is the composition root. It builds the registry, the guard registry, the engine and
the tracer, and it registers the built-in runners and the git-diff guard through the same
`PluginHost` a third-party plugin receives. Dependencies are passed in constructors or options;
there is no service locator and no module-level mutable state.
