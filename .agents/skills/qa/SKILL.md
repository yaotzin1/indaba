---
name: qa
description: Use when writing or changing PHPUnit tests, choosing what to assert, building fakes for runners, the clock or git, or when a test is flaky. Covers contract-first and deterministic testing for Indaba.
---

# PHPUnit Test Specialist

PHPUnit 11, run only in Docker: `docker compose run --rm php composer test`, or a single file with
`docker compose run --rm php vendor/bin/phpunit tests/Unit/Mesh/ConsensusArbiterTest.php`.

## Contract first, then tests, then code

`api-surface.md` names the classes and signatures. Write the test against that signature, watch it
fail for the right reason, then implement. A test written after the code usually asserts what the
code does rather than what the contract says.

## What to assert

- **Behaviour, not structure.** Assert verdicts, ordered transitions, produced artifacts, emitted
  events, the argv a runner built. Do not assert private state or call counts unless the count is the
  contract.
- **The whole sequence for the engine.** With a fixed workflow, a scripted runner and a `MockClock`,
  assert the complete ordered list of `(step, from, to)` transitions. This is what catches a
  reordering.
- **Both sides of every seam.** Pass and fail for each guard; success, exhaustion and prompt
  isolation for a retry; each `ConsensusArbiter` verdict.
- **Hostile input.** See `application_security`: traversal, option-looking names, metacharacters, a
  planted secret that must not surface.

## Doubles

| Boundary | Use |
| :--- | :--- |
| `RunnerInterface` | a scripted fake in `tests/Fixtures` that returns queued `RunResult`s and records requests |
| time | `Symfony\Component\Clock\MockClock` |
| ids | a counter generator |
| HTTP | `Symfony\Component\HttpClient\MockHttpClient` with SSE bodies split at awkward boundaries |
| git | a real repository in `sys_get_temp_dir()`, removed in `tearDown` |
| filesystem | a unique temp directory per test, never a fixed path |

Prefer a hand-written fake over a generated mock for a boundary used in many tests; a fake documents
the contract and fails when the contract changes.

## Structure

`tests/Unit/<Module>/<Class>Test.php` mirroring `src/`. `final` test classes, data providers with
named cases (`yield 'cycle of two' => [...]`), `#[DataProvider]` and `#[Test]` attributes as the
project already uses. One reason to fail per test.

## No timers, no network, no real agents

Never `sleep`; advance the mock clock. A test that needs a real `claude` or an API key does not
belong in `tests/Unit`.

## Flaky tests

A flaky engine test is a determinism bug: find the clock, ordering or shared state that varies,
and fix the code or the fixture. Do not add retries, and do not skip.

## Done means

`composer qa` green with its output reported, a test that fails without the change, and no skipped
or risky test left behind.
