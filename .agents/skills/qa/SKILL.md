---
name: qa
description: Use when writing or changing Vitest tests, choosing what to assert, building fakes for runners, the clock or git, or when a test is flaky. Covers contract-first and deterministic testing for Indaba.
---

# Vitest Test Specialist

Vitest, run from the repository root on any OS: `pnpm test` for everything, or one file or one test
with `pnpm vitest run packages/core/test/mesh.test.ts` and `-t "consensus"`. `pnpm qa` runs Biome and
`tsc` first, so a test that does not typecheck fails before it runs.

## Contract first, then tests, then code

`api-surface.md` names the exports and signatures. Write the test against that signature, watch it
fail for the right reason, then implement. A test written after the code usually asserts what the
code does rather than what the contract says.

## What to assert

- **Behaviour, not structure.** Assert verdicts, ordered transitions, produced artifacts, emitted
  events, the argument vector a runner built. Do not assert private state or call counts unless the
  count is the contract.
- **The whole sequence for the engine.** With a fixed workflow, a scripted runner and a fixed clock,
  assert the complete ordered list of `(step, from, to)` transitions. This is what catches a
  reordering.
- **Both sides of every seam.** Pass and fail for each guard; success, exhaustion and prompt
  isolation for a retry; each `ConsensusArbiter` outcome.
- **Hostile input.** See `application_security`: traversal, option-looking names, metacharacters, a
  planted secret that must not surface.

## Doubles

| Boundary | Use |
| :--- | :--- |
| `Runner` | a scripted fake (see `packages/engine/test/support.ts`) that returns queued `RunResult`s and records requests |
| time | a fake `Clock` whose `now()` the test advances |
| ids | a counter `IdGenerator` |
| process | a fake `ProcessSpawner` injected into the runner, never a real agent CLI |
| HTTP | a stub `fetch` returning a `ReadableStream` of SSE bytes split at awkward boundaries |
| git | a real repository in a directory from `mkdtemp(join(tmpdir(), ...))`, removed in `afterEach` |
| filesystem | a unique temp directory per test, never a fixed path |

Prefer a hand-written fake over `vi.fn()` chains for a boundary used in many tests; a fake documents
the contract and fails to compile when the contract changes.

## Structure

`packages/<name>/test/<topic>.test.ts`, mirroring `src/` by topic. `describe` per unit, `it` with a
sentence that states the behaviour, `it.each` with named cases for tables. One reason to fail per
test. Tests are TypeScript under the same strict flags as source: no `any`, no `!`, no suppression
comments. The boundary tests (`packages/core/test/architecture.test.ts`, `packages/*/test/layers.test.ts`)
are part of the suite and must keep passing.

## No timers, no network, no real agents

Never `setTimeout` to wait for something; inject the clock or await the promise. Tests run on
Windows, macOS and Linux in CI: no hard-coded `/` separators in expectations, no reliance on `sh`
being present except where `ShellRunner` is the subject. A test that needs a real `claude` or an API
key does not belong in the suite, and a unit test never depends on a PTY.

## Flaky tests

A flaky engine test is a determinism bug: find the clock, ordering or shared state that varies, and
fix the code or the fixture. Do not add retries, and do not use `it.skip` or `it.todo` to hide one.

## Done means

`pnpm qa` green with its output reported, a test that fails without the change, and no skipped test
left behind.
