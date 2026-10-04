# Specification: Command line interface

> **Superseded implementation language.** This spec was written for the PHP prototype, which was never
> published. Behaviour is unchanged by the TypeScript port; class, method and field names follow
> [`specs/typescript-port/api-surface.md`](../typescript-port/api-surface.md) (for example
> `RunnerInterface` is `Runner`, `*Exception` is `*Error`, fields are camelCase). Where this text names a
> PHP, Composer, Symfony or Docker detail, read the Node and TypeScript equivalent.

> **Status**: Implemented in the initial commit; specified retroactively. The founding requirement
> names `symfony/console` but does not describe commands, so what follows is taken from the code that
> exists and must be confirmed in review.
> **Stage entry**: 1 (retroactive)
> **Semver impact**: minor (first public surface; below 1.0)

---

## 1. The problem

The engine is a library. A person who wants to validate, inspect and run a workflow file from a
terminal, without writing PHP, needs a command line front end that composes the engine, the runners
and the tracer.

## 2. User stories

- **US-01.** As a workflow author, I run `indaba validate <file>` and see every problem in my file.
- **US-02.** As a workflow author, I run `indaba plan <file>` and see the order the steps would run
  in, without running anything.
- **US-03.** As a person running a workflow, I run `indaba run <file>` and watch steps progress live,
  with the result reflected in the exit code.

## 3. Acceptance criteria

- [ ] `validate`, `plan` and `run` commands exist (`ValidateCommand`, `PlanCommand`, `RunCommand`).
- [ ] The exit code is 0 only when the workflow completed, and non-zero for an invalid file, a failed
      or escalated run.
- [ ] `EngineFactory` is the one composition root: it builds the registry, tracer, event dispatcher
      and engine, and is where concrete runners are named.
- [ ] No secret is printed.
- [ ] `bin/indaba` starts from a production install (`composer install --no-dev`).

## 4. Non-goals

- A TUI or web dashboard. Live output is for the console; richer front ends consume the events.
- Interactive prompts. The CLI is non-interactive so it can run in CI.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the file does not exist or is invalid | every problem is printed; exit code non-zero; nothing runs |
| a step fails or escalates | the summary says which step and why; exit code non-zero |
| interrupted (SIGINT) | the run is cancelled and teardown runs (`pcntl` is installed in the image) |

## 6. Security and data handling

The workflow path is resolved and read as data. Environment secrets stay in the environment. Output
never includes API keys.

## 7. Where it lives

`src/Console/` and `bin/indaba`, infrastructure and composition root.

## 8. Clarifications

Command names, options and exit codes are public contract and are to be recorded exactly from the
code in review.

## Artifacts not written

- `plan.md`: retroactive spec.
- `research.md`: no options were recorded at the time.
- `data-model.md`: no types beyond the commands themselves.
- `events.md`: the CLI emits no event of its own; it listens to the engine's.
- `tasks.md`: the work is done.
