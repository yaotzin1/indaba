# Agent Orchestration Rules

Guidance. No tool in this repository creates these agents, limits them to a scope or makes a
contract read-only: whether work is split, and how, is the orchestrating agent's decision, and the
rules below are what that decision should respect. In Claude Code the natural mechanism is a
subagent per half, each in its own worktree; in Antigravity, one agent per workspace.

(Indaba itself orchestrates agents at run time. That is the product, described in `docs/vision.md`.
This file is about the agents that *develop* Indaba, and the two must not be confused.)

## When to fan out

Parallel subagents earn their cost when the work splits along a real seam with a written contract
between the halves. In this repository the seams are package against package (core against engine
against runners against the CLI), and one runner against another, and the contract is
`api-surface.md` (plus `events.md` when events or span attributes are part of it).

Do not fan out for: a single-file change, an exploratory task where the shape is not yet known, or
work whose halves would both edit the same module (the engine, the `Runner` contract).

## Roles

When work is split, give each agent one of these roles and hold it to the scope.

| Role | Scope | Access |
| :--- | :--- | :--- |
| `research` | anywhere | read-only |
| `doc_architect` | `specs/`, `docs/` | full |
| `domain_developer` | `packages/core/` | full, own branch |
| `infra_developer` | `packages/engine/`, `packages/runners/`, `packages/cli/` | full, own branch |
| `qa_auditor` | `packages/*/test/` | full, own branch |
| `api_auditor`, `security_auditor` | anywhere | read-only |

A subagent stays inside its scope. Work that needs both scopes is coordinated through the contract,
not by widening a scope. Parallel agents work in git worktrees created outside the repository (not
under `.indaba/worktrees/`, which is runtime state for Indaba itself), each with its own
`node_modules` from `pnpm install`, so two installs never share a write.

## Contracts do not change during implementation

Nothing makes `api-surface.md` or `events.md` read-only, so this holds only if agents hold it. An
implementation agent that finds the contract wrong stops and reports. It does not edit the
contract, because the other half of the work is being written against the version it was given.

## Reporting

A subagent reports what it actually ran and what the output actually said. A summary of a test run
is not evidence of a test run, and an agent that reports a green suite it did not execute has done
more damage than one that reports a red one.

## Verification is not delegated to the author

The agent that wrote the implementation is the worst judge of whether its tests are meaningful.
Stage 7 runs the full gate independently of who wrote the code.
