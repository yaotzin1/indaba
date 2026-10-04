# Testing Rules

Binding.

## 1. No test, no merge

Every feature, fix, refactor and architectural change carries automated coverage, written before or
alongside the code. A change without it is incomplete.

## 2. The layers answer different questions

| Where | Question |
| :--- | :--- |
| `packages/<name>/test/*.test.ts` | is the logic right, with fakes at every boundary |
| `packages/core/test/architecture.test.ts`, `packages/*/test/layers.test.ts` | does the code still obey the boundary rules |
| integration tests that use a real temporary git repository or a real `ShellRunner` command (`node -e`, `git`) | does the infrastructure do what the fake pretended |
| `scripts/smoke-pack.mjs` in CI (pack, install the tarballs in a clean directory, run `indaba --version`) | does the installed package start at all |

An integration test is allowed a real git and real child processes; it is not allowed the network or a
real agent CLI. A test that spawns a child uses `process.execPath` (Node itself), never `sh`, `echo`
or another program that is missing on one of the three CI operating systems.

## 3. Fakes, not mocks of the unit under test

Runners are tested through a scripted fake `Runner`; time through a fixed `Clock`; ids through a
counting `IdGenerator`. A test that needs sleeping needs a clock (or Vitest's fake timers).

## 4. Deterministic engine tests

For a fixed workflow, scripted runner outputs and a fixed clock, assert the full ordered list of
step transitions, not just the end state. A flaky engine test is a determinism bug in the engine.

## 5. Both sides of a seam

A runner contract test runs against every runner that can run offline. A guard is tested passing and
failing. A retry is tested for success on attempt two, exhaustion, and that the second prompt holds
only the last failure.

## 6. Hostile inputs are first-class

Path traversal in an artifact name, a branch name that looks like an option, a model output that
contains shell metacharacters, a secret in an environment variable that must not reach a trace: each
has a test that fails if the defence is removed. Build hostile strings from fragments so the test
file itself stays clean of the scanner's patterns.

## 7. Runs everywhere, runs fast

The suite passes on Windows, macOS and Linux (the CI matrix): no hard-coded separators, no shell
builtins, no assumptions about line endings. Unit tests are fast enough to run on every commit.
Skipping a test with `it.skip`, or lowering an assertion, to pass is a change to the rules and
belongs in a spec.

## 8. Before reporting a change complete

```bash
pnpm qa
```

Report what it actually printed. A summary of a test run is not a test run.
