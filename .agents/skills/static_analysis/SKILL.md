---
name: static_analysis
description: Use when PHPStan or PHP-CS-Fixer fails, when typing arrays, generics or callbacks, when tempted to ignore an analyser error, or when changing phpstan.neon. Covers level 9 with no ignoreErrors and PER-CS 2.0.
---

# Static Analysis Specialist

`composer stan` runs PHPStan at **level 9 over `src` and `tests`**. `composer cs` checks
PHP-CS-Fixer with the PER-CS 2.0 ruleset; `composer cs:fix` applies it. Both in Docker.

## The rule: no ignoring

`phpstan.neon` has no `ignoreErrors`, no baseline include and no `reportUnmatchedIgnoredErrors: false`,
and source has no `@phpstan-ignore`. `scripts/security-audit.mjs` fails the commit if any appears.
An error is information: the type is wrong, or the analyser cannot see it and you can help it see.

## Fix it properly

| Analyser says | Do this |
| :--- | :--- |
| `array` with no value type | `list<Step>`, `array<string, string>`, or a value object |
| mixed from `Yaml::parse` or `json_decode` | validate at the boundary into a typed object, throwing `WorkflowValidationException` on a bad shape; assert once, trust after |
| a nullable you know is set | restructure so it cannot be null (constructor, early return), not `assert()` sprinkled around |
| callable shape | `callable(string): int` in the docblock, or a small interface |
| generic collections | `@template` and `@param Collection<T>` in the docblock |
| dead code | delete it |
| `Process::getOutput()` etc. | wrap in a small typed class so the rest of the code is typed |

`assert()` and `instanceof` checks are fine at a boundary where data enters. `@var` overrides are not:
they are an ignore in disguise.

## Style

`declare(strict_types=1);`, `final` classes, `readonly` where possible, constructor promotion, native
enums, `match` over `switch`, no `else` after `return`, trailing commas in multiline lists. The fixer
decides formatting; do not argue with it by hand.

## When a rule is genuinely wrong

Change the configuration in a reviewed commit that carries `Workflow-Change: <why>` (the file is
protected) and update this skill. Lowering the level is never that.

## Upgrading PHPStan

A major PHPStan upgrade can add findings. Fix them in the upgrade change, on the chore track when no
behaviour changes, and update `project.toolchain` in `workflow.ai.yml`.
