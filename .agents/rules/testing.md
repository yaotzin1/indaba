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
| `packages/cli/e2e/*.e2e.test.ts`, run with `pnpm e2e` (builds first, then spawns the built `indaba` binary in temporary git repositories) | does the CLI work the way a user runs it: arguments, exit codes, plugins, traces, cancellation, secrets |
| `scripts/smoke-pack.mjs` in CI (pack, install the tarballs in a clean directory, run `indaba --version`) | does the installed package start at all |
| StrykerJS mutation testing, `pnpm mutation` (`stryker.config.json`, `vitest.mutation.config.ts`) | would the tests notice a bug: a mutant that survives is a missing or weak assertion |

## 2b. The numbers

- **Coverage** is at least 85% on statements, branches, functions and lines. `pnpm qa` enforces it
  through the thresholds in `vitest.config.ts`, and `scripts/check-workflow.mjs` fails if they drop
  below `project.coverage_threshold`. The floor is raised, never lowered. An exclusion from coverage
  carries its reason next to it in the config (today: `packages/cli/src/bin.ts`, covered by the
  end-to-end tests and the smoke test).
- **End-to-end tests** run in CI on all three operating systems. A new CLI option, exit code or
  plugin behaviour gets an end-to-end test as well as a unit test.
- **Mutation score** is measured with Stryker over `packages/*/src`. It takes tens of minutes, so it
  runs on a schedule and on demand (`.github/workflows/mutation.yml`), not in `pnpm qa`. A surviving
  mutant is fixed with a test that kills it. Stryker's Vitest runner is pinned to the Vitest 4 line
  because it does not apply mutants under Vitest 5.0.3 (checked: a 1.8% score on a suite with 95%
  branch coverage); revisit the pin when a compatible runner is released.

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
