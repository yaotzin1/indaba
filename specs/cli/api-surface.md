# API surface contract: Command line interface

> Written retroactively. Command names are taken from the classes under `src/Console/`; options and
> exit codes are to be recorded exactly from the code in review.

## Semver classification

**minor**: first public surface (below 1.0).

## Public symbols added

| Name (FQCN) | Kind | Notes |
| :--- | :--- | :--- |
| `Indaba\Console\ValidateCommand` | final class | `validate` |
| `Indaba\Console\PlanCommand` | final class | `plan` |
| `Indaba\Console\RunCommand` | final class | `run` |
| `Indaba\Console\EngineFactory` | final class | the composition root; `@internal` unless embedders are meant to use it |
| `bin/indaba` | executable | the Composer `bin` entry |

The PHP classes in `Console` are not meant as an embedding API: the commands are the contract.
Marking them `@internal` is to be decided in review.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| CLI | `indaba validate <file>`, `indaba plan <file>`, `indaba run <file>` | added |
| CLI | exit codes (0 completed; non-zero otherwise) | added, exact values to be recorded |
| environment | `OPENROUTER_API_KEY` | read through the runner |

## Defaults introduced

To be filled from the code in review: default workflow file path, default project directory, default
output verbosity.

## Checks

- [ ] Commands, arguments, options and exit codes recorded exactly
- [ ] Only this directory and the registry name concrete runners
- [ ] `composer stan` passes without an ignore
