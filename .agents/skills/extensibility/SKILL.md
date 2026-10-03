---
name: extensibility
description: Use when deciding how a third party extends Indaba, adding an extension point, or checking that a built-in has no access an external runner, guard or listener lacks. Covers the contracts that are extension points and the no-privileged-access rule.
---

# Extensibility Steward

Indaba is a framework others embed. Its extension points are small, explicit and equal for
everyone.

## The extension points

| Extension | Contract | Registered through |
| :--- | :--- | :--- |
| A new way to run an agent or command | `Runners\RunnerInterface` | `RunnerRegistry` |
| A new workflow guard | the guard evaluator contract in `Workflow\Guard` | the guard registry |
| Reacting to a run | PSR-14 events through the event dispatcher | the dispatcher the console and embedders pass in |
| Price data for cost | `Observability\PricingTable` | constructor argument |
| Trace export | the tracer's exporter interface | constructor argument |

Anything else is internal. Do not tell a consumer to subclass: classes are `final`.

## No privileged access

A built-in runner, guard or listener uses only what a third party could use: the public interface,
the request and result value objects, the dispatcher. When a built-in needs a seam that does not
exist, the seam is added to the public contract for everyone, classified as a minor in the spec, and
documented. A private shortcut that makes a built-in work is a design that failed, and the next
external runner will not have it.

A contract test enforces this for runners: the same abstract test case runs against every runner,
built-in or a test double written in the tests directory using only public API.

## Contracts stay small

An interface method is a promise every implementer must keep. Add one only when the engine cannot
work without it, and prefer a new optional interface (`StreamingRunnerInterface`) over widening an
existing one: adding a method to a published interface is a major.

## Extensions fail alone

A listener that throws must not abort a run; a guard that throws is a failed guard, reported as
such, not a crash of the engine; a runner that throws `RunnerException` fails its step, not the
process. The engine isolates third-party code at the call site and says whose code failed.

## Documentation

Each extension point has a page in `docs/` with a minimal working example that the test suite also
runs, so the example cannot rot. Writing one end to end: `create_runner`, `create_guard`.
