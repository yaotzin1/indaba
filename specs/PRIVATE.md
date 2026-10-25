# Specifications that are not in this repository

Some specifications live in a private repository, `yaotzin1/indaba-spec`. This file says which, so that nobody looks for a directory that is not here.

| Specification | What it is | Where |
| :--- | :--- | :--- |
| `voter-arbiter` | an automatic arbiter that scores a failed debate and can settle it before a person | private repository, `specs/voter-arbiter/` |
| `step-variants` | run a step several ways and choose | private repository, `specs/step-variants/` |

Other specifications that are not part of this repository, and drafts that are still being worked out, are in the same repository. What is specified here stays here.

## For agents and people working in this repository

- A feature of this repository is specified and implemented here, in `specs/<name>/`, as `AGENTS.md` says.
- Never write in this repository which features are paid, priced or part of a commercial edition, or plans about them:
  not in a spec, a doc, a comment, a commit message or a pull request. Say only that a feature is not part of this
  repository. Product and pricing decisions live in the private repository.
- A specification listed above, or a name in the dependency map that points to this file, is private. If your work needs it, ask the maintainer for the file or for the part
  that touches your work. Do not recreate it from a guess, and do not copy it into this repository.
- When a public specification refers to one of them, the reference is by name only. What the public code must provide for it (extension points, contracts in
  `@indaba/core`) is described in the public specification that needs it.
- New specification work is started in the private repository and carved out into `specs/<name>/` here when the feature is free and its implementation starts, or
  when the maintainer says it is ready.
