# Agent Execution Standards

## Before changing anything

Read the file you are about to change, in full, including its doc comments and comments. A comment
in this codebase records a bug that already happened once; a change that deletes one usually
reinstates the bug.

## While changing

- TypeScript strict, ESM, `.js` extensions in relative imports. Formatting and import order are
  Biome's (`pnpm lint:fix`), never done by hand.
- No `any`, no `!` non-null assertion, no suppression comment of any tool. Narrow `unknown`.
- `readonly` fields and `readonly` arrays for value objects, string-literal unions (with a frozen
  const object where a runtime list is needed) for closed sets, `interface` for contracts a third
  party implements, no mutable public state. Open a class for extension only when a spec says so.
- Comments say why, not what. If the comment restates the line, delete the comment. Doc comments
  exist to explain a contract the type cannot express, not to repeat the signature.
- Prefer a new module behind an interface over a new option, and an option over a special case.

## One command, any OS

Node 22 and pnpm 9 are the whole toolchain, on Windows, macOS and Linux alike. Every gate is
`pnpm <script>` (or a `node scripts/...` file) run from the repository root. A result from another
Node major, another package manager or a stale `node_modules` is not evidence: run `pnpm install`
first.

## Paths

No absolute paths anywhere in source, tests, configs or fixtures: no `C:\...`, no `/home/...`.
Resolve from `import.meta.url`, the workspace root a caller passes in, or `os.tmpdir()` plus a
unique `mkdtemp` name for test fixtures, and join with `node:path`, so the same suite passes on
every OS in the CI matrix. Tests that need a git repository create one in a temporary directory and
remove it.

## Tests do not touch the network or real agents

A unit test uses a fake `Runner` and a fixed clock. No test calls OpenRouter, starts `claude` or
`cursor`, or reads the real environment's API keys.

## Update the examples and docs with the feature

A feature is not finished when the tests pass. A sample workflow under `examples/` demonstrates it,
and the page under `docs/` that names the field, guard, runner option or CLI flag changes in the
same commit.

## Before reporting complete

Run `pnpm qa` and the node gates, and report their actual output. If a gate failed, say which one
and what it printed. A change reported as done while a gate is red is a false report, and it is
worse than an unfinished change because the next agent builds on it.

## When blocked

State what you tried, what happened, and what you need. Do not silently narrow the task, and do not
mark unfinished work as done with a note buried at the end.
