---
name: extensibility
description: Use when deciding how a third party extends Indaba, adding an extension point, or checking that a built-in has no access an external runner, guard or listener lacks. Covers the contracts that are extension points and the no-privileged-access rule.
---

# Extensibility Steward

Indaba is a framework others embed. Its extension points are small, explicit, owned by
`@indaba/core`, and equal for everyone.

## The extension points

A plugin default-exports a `Plugin` (`{ name, register(host) }`) and receives a `PluginHost`, the only
thing it is given:

| Extension | Contract (in `@indaba/core`) | Registered through |
| :--- | :--- | :--- |
| A new way to run an agent or command | `Runner` | `host.registerRunner(runner)` |
| A new workflow guard type | `Guard` and `GuardResult` | `host.registerGuard(guard)` |
| Reacting to a run | event classes (`StepStatusChanged`, `SpanStarted`, `SpanEnded`) | `host.addListener(EventClass, listener)` |
| Price data for cost | `PricingTable` | constructor argument of the `Tracer` |
| Trace export | a listener on `SpanEnded` (the JSONL exporter is one) | `host.addListener` |

```ts
import { type Plugin, SpanEnded } from '@indaba/core';

const plugin: Plugin = {
  name: 'my-plugin',
  register(host) {
    host.addListener(SpanEnded, (event) => {
      process.stderr.write(`${event.span.name}\n`);
    });
  },
};
export default plugin;
```

The CLI loads plugins with `--plugin <module-specifier-or-path>` and `createEngine({ plugins })`.
Anything else is internal. Core owns the contracts so that adding an extension never edits core,
engine or runners.

## No privileged access

A built-in runner, guard or listener uses only what a third party could use: the public interface,
the request and result types, the host. The built-in runners and the git-diff guard register through
the same `PluginHost`. When a built-in needs a seam that does not exist, the seam is added to the
public contract for everyone, classified as a minor in the spec, and documented. A private shortcut
that makes a built-in work is a design that failed, and the next external runner will not have it.

Tests enforce it: `packages/core/test/extension.test.ts` registers a runner, a guard type and a
listener from outside the packages, and the `layers.test.ts` files stop engine and runners from
reaching upward.

## Contracts stay small

An interface member is a promise every implementer must keep. Add one only when the engine cannot
work without it, and prefer a new optional interface (`McpCapable` next to `Runner`) over widening an
existing one: adding a required member to a published interface is a major.

## Extensions fail alone

A listener that throws must not abort a run (the dispatcher reports the error and carries on); a
guard that throws is a failed guard, reported as such, not a crash of the engine; a runner that
throws `RunnerError` fails its step, not the process. The engine isolates third-party code at the
call site and says whose code failed.

## Documentation

Each extension point has a page in `docs/extending.md` with a minimal working example that the test
suite also runs, so the example cannot rot. Writing one end to end: `create_runner`, `create_guard`.
