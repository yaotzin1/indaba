---
name: create_guard
description: Use when adding a workflow guard type, such as a new filesystem boundary check, an exit-code gate or an artifact validator. A procedure: the verdict contract, schema, tests and documentation.
---

# Guard Author's Guide

A procedure. The engine rules it must obey are in `workflow_engine`; the safety rules in
`application_security`; how a plugin delivers it in `extensibility`.

## 1. Spec it

A guard type is public workflow schema, so it is a feature. State what it checks, its parameters,
whether it is pre- or post-step, and what a failure tells the person. Classify it a minor.

## 2. Define the parameters

`GuardDefinition` is `{ type: string; paths: readonly string[] }`, and the `type` is open: the
`GuardType` const lists only the built-ins, so a new type needs no change to core. The parser
validates a workflow's guard type against the `GuardRegistry` it was given, so registering the guard
is what makes the type valid. A guard that needs parameters beyond `paths` is a change to the
workflow schema and to `GuardDefinition`: a feature with its own classification.

## 3. Write the evaluator

Implement core's `Guard` interface. A built-in goes in `packages/engine/src/guard`; a third-party
guard lives in its own package. It receives the definition and the workspace directory, and returns
`GuardResult.pass()` or `GuardResult.fail(message)` with a reason a person can act on. It does not
change state, write files or run agents.

```ts
import { type Guard, type GuardDefinition, GuardResult } from '@indaba/core';

export class TimelineHasClipsGuard implements Guard {
  readonly type = 'timeline_has_clips';

  async check(guard: GuardDefinition, workdir: string): Promise<GuardResult> {
    const missing = await findMissing(workdir, guard.paths); // your own I/O, paths confined to workdir
    return missing.length === 0 ? GuardResult.pass() : GuardResult.fail(`Missing: ${missing.join(', ')}`);
  }
}
```

- **Path guards** (`git_diff_empty` on `["src/", "tests/"]`): resolve every configured path against
  the workspace and reject any that leaves it; compare with git's own output (`git status
  --porcelain`), not by listing files. Fail closed when the state cannot be inspected.
- **Command guards**: run through a `Runner`, never a raw `exec` or a shell string.
- **Artifact guards**: confine artifact paths to the artifact directory.

## 4. Register it

Through a plugin: `host.registerGuard(new TimelineHasClipsGuard())` in `Plugin.register`. The
built-in git-diff guard registers the same way. A later registration of the same type replaces the
earlier one.

## 5. Test it

Passing, failing, the failure message, a configuration that escapes the root, and an absent
workspace, in Vitest under `packages/*/test`. Use a real temporary git repository for git-based
guards. Add a parse test that a workflow using the type is valid only with the guard registered.

## 6. Document and ship

`docs/workflow-format.md` gets the field table and an example; `docs/extending.md` if it is a new
extension pattern; `CHANGELOG.md` records it under Added; `data-model.md` shows the schema delta.
