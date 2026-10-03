# Agent Execution Standards

## Before changing anything

Read the file you are about to change, in full, including its docblocks and comments. A comment in
this codebase records a bug that already happened once; a change that deletes one usually
reinstates the bug.

## While changing

- `declare(strict_types=1);` in every PHP file. PER-CS 2.0 formatting, applied by PHP-CS-Fixer
  (`composer cs:fix`), never by hand.
- `final` by default, `readonly` for value objects, native enums for closed sets, constructor
  promotion, no public mutable properties. Open a class for extension only when a spec says so.
- Comments say why, not what. If the comment restates the line, delete the comment. Docblocks exist
  to give PHPStan a type the language cannot express (`list<StepDefinition>`,
  `array<string, string>`), not to repeat the signature.
- Prefer a new class behind an interface over a new option, and an option over a special case.

## Run PHP in Docker, and only there

The host has no PHP 8.4. Every PHP command is
`docker compose run --rm php composer <script>` (or `vendor/bin/<tool>` inside the container). A
result from any other interpreter is not evidence. The Node scripts (`node scripts/...`) run on the
host.

## Paths

No absolute paths anywhere in source, tests, configs or fixtures: no `C:\...`, no `/home/...`.
Resolve from `__DIR__`, the workspace root a caller passes in, or `sys_get_temp_dir()` plus a unique
name for test fixtures, so the same suite passes on Windows checkouts, in the container and on CI.
Tests that need a git repository create one in a temporary directory and remove it.

## Tests do not touch the network or real agents

A unit test uses a fake `RunnerInterface` and a fixed clock. No test calls OpenRouter, starts
`claude` or `cursor`, or reads the real environment's API keys.

## Update the examples and docs with the feature

A feature is not finished when the tests pass. A sample workflow under `docs/` (or an `examples/`
directory once one exists) demonstrates it, and the docs page that names the field, guard, runner
option or CLI flag changes in the same commit.

## Before reporting complete

Run `docker compose run --rm php composer qa` and the node gates, and report their actual output. If
a gate failed, say which one and what it printed. A change reported as done while a gate is red is a
false report, and it is worse than an unfinished change because the next agent builds on it.

## When blocked

State what you tried, what happened, and what you need. Do not silently narrow the task, and do not
mark unfinished work as done with a note buried at the end.
