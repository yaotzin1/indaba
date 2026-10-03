# Testing Rules

Binding.

## 1. No test, no merge

Every feature, fix, refactor and architectural change carries automated coverage, written before or
alongside the code. A change without it is incomplete.

## 2. The layers answer different questions

| Where | Question |
| :--- | :--- |
| `tests/Unit/<Module>` | is the logic right, with fakes at every boundary |
| `tests/Unit/Architecture` | does the code still obey the boundary rules |
| integration tests that use a real temporary git repository or a real `ShellRunner` command (`echo`, `php -r`) | does the infrastructure do what the fake pretended |
| the smoke step in CI (`composer install --no-dev`, then the CLI) | does the installed package start at all |

An integration test is allowed a real git and real child processes; it is not allowed the network or a
real agent CLI.

## 3. Fakes, not mocks of the unit under test

Runners are tested through a scripted fake `RunnerInterface`; time through `Symfony\Component\Clock\MockClock`;
ids through a counter. A test that needs sleeping needs a clock.

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

## 7. Coverage and speed

PHPUnit 11 with `failOnWarning` and `failOnRisky`. Unit tests are fast enough to run on every
commit. Lowering a threshold or marking a test skipped to pass is a change to the rules and belongs
in a spec.

## 8. Before reporting a change complete

```bash
docker compose run --rm php composer qa
```

Report what it actually printed. A summary of a test run is not a test run.
