---
name: create_guard
description: Use when adding a workflow guard type, such as a new filesystem boundary check, an exit-code gate or an artifact validator. A procedure: the verdict contract, schema, tests and documentation.
---

# Guard Author's Guide

A procedure. The engine rules it must obey are in `workflow_engine`; the safety rules in
`application_security`.

## 1. Spec it

A guard type is public workflow schema, so it is a feature. State what it checks, its parameters,
whether it is pre- or post-step, and what a failure tells the person. Classify it a minor.

## 2. Define the parameters

`GuardType` gains a case (an enum change: consumers that `match` exhaustively break, so say so in
the classification), and `GuardDefinition` carries the parameters as typed fields, validated at
parse time. Reject unknown parameters rather than ignoring them.

## 3. Write the evaluator

In `src/Workflow/Guard`, a `final` class implementing the guard contract. It receives the step, the
workspace root and the injected services it needs (a `Git` wrapper, a filesystem boundary), and
returns a verdict with a human reason. It does not change state, write files or run agents.

- **Path guards** (`git_diff_empty` on `["src/", "tests/"]`): resolve every configured path against
  the workspace root and reject any that leaves it; compare with git's own output, not by listing
  files.
- **Command guards**: run through the same runner abstraction as any step, never a raw
  `exec`.
- **Artifact guards**: confine artifact paths to the artifact directory.

## 4. Test it

Passing, failing, the failure message, a configuration that escapes the root, and an absent
workspace. Use a real temporary git repository for git-based guards.

## 5. Document and ship

The workflow reference in `docs/` gets the field table and an example; `CHANGELOG.md` records it
under Added; `data-model.md` shows the schema delta.
