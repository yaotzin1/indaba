# Self-review: Agent permissions

> **Status**: specification reviewed twice by independent reviewers (round 1: 14 findings, round 2: 13), all answered in the text. Nothing is implemented, so the answers below are about the design; the
> implementation review is repeated when code exists.

See [`.agents/rules/review.md`](../../.agents/rules/review.md).

## 1. Boundary and layering

Core gets only pure functions and types (`resolvePermissions`, `effectiveLevel`, `lowerLevel`, `applyBound`, `unsupportedBy`, `describeEnforcement`, the `PermissionCapable` contract); none imports `node:`.
`describeEnforcement` returns structure and note ids, no English (C-10). The checks that need runners live in the engine (`checkPermissions`), the arguments in each runner, the prompt in the CLI.
Round 2 found that resolution had no stated home: it now happens once per agent step and is handed to every reader of `step.permissions` (api-surface, T-05).

## 2. Determinism and failure isolation

Resolution and the bound are pure. A refused permission becomes a step failure with a fixed reason under defined conditions (AC-11), evaluated per attempt for the runner that ran it. A model's text never
changes a level. The acknowledgement of `full` never carries over to a second run.

## 3. Public surface and semver

Minor: an optional `level`, `permissions` on roles and `defaults`, a new optional contract, new options and attributes. The removal of the two hard-coded runner defaults is deliberately not here (C-01). One
behaviour change is named: a `permissions` block a file already carries on a role or in `defaults` was inert and now applies (CHANGELOG). The catalog member is optional and additive, so `catalog` stays `1`
(C-11, to be confirmed by the maintainer).

## 4. Security

Round 2 found that a run bound could raise a level, that the scope guard was credited with more than it holds, that MCP servers bypass every level, that `extraArgs` after the level flags could widen it, and that
the page could not pass the `full` acknowledgement. Answers: a bound only lowers a written level (AC-12); the guard is described as seeing only git-visible paths of the working tree and `read` is refused for
runners that cannot stop a command (AC-07, C-03); a `read` step with `mcp` is an error (AC-18); the level arguments come last (AC-07); the acknowledgement is tied to a content hash with a `409` (AC-05).
Still true and stated: for a command-line runner the scope is checked after the step, so the agent may have acted before it; `isolation: git_worktree` and `acp` are the stronger options.

## 5. Observability and honest numbers

Three span attributes and one on the task span; no path, command or agent message is recorded (AC-15, test T-15). The only number, 4096 characters read for a refusal, is a named design choice (C-07).

## 6. Dependencies and packaging

None added.

## 7. Verification

A specification only: no code. The gates for this change are `node scripts/check-workflow.mjs` and `pnpm qa`; their output is in the pull request. The flags marked *confirm* in C-03 are checked at implementation, and a
level whose argument cannot be confirmed is `unsupported`.

## Known gaps

- `codex` and `cursor` are not installed on the author's machine: their flags are unverified (C-03).
- The meaning of `claude --permission-mode plan` and `agy --mode plan` as read-only was not tested.
- `ask` is deferred (C-05); AC-06 depends on `agent-conversation` and `review-gate` being implemented.
- A debate's participants keep today's behaviour (AC-19) until the release that removes the defaults.

## The page and the editor (T-14)

- **Where the capability data comes from.** `RunnerRegistry.describe()` reads each runner through `permissionMapOf` (core), `catalogOf` keeps the map and rebuilds it from known words only (a plugin's mode, scope
  or note is not trusted), and the page reads it from the catalog. A test in `packages/web/test/layers.test.ts` fails if a TypeScript file of the page names a built-in runner (AC-16).
- **`full` is asked every time.** `POST /runs` refuses with `409 full_access_required` when the file has a step at `full` and `fullAccessConfirmedHash` is not the file's hash, also for a file confirmed before; only
  a matching hash starts the child with `--allow-full-access=page`. The hash is validated as a hash and nothing else of the body reaches the child's arguments (AC-05).
- **Older peers.** A server that sends no `fullAccessSteps` reads as no step at `full` on the page, and a catalog without a map makes the form refuse nothing. Both are stated in `client.ts`.
- **Not done in this slice:** the real-browser check of the new dialog and the form (no browser was driven; the tests run under happy-dom), and the `getting-started.md` runner table.
