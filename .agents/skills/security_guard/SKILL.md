---
name: security_guard
description: Use when adding or upgrading a dependency, editing a package.json or pnpm-lock.yaml, changing what an npm package publishes, or touching CI secrets and the release workflow. Covers runtime dependency policy, install scripts, the lockfile and published files.
---

# Supply Chain & Publish Safety Specialist

Every dependency is code that runs with a developer's API keys. The policy keeps that list short,
explicit and audited. `@indaba/core` has no dependencies at all.

## Runtime dependencies are a recorded decision

The `dependencies` and `optionalDependencies` of the packages (links between them aside) are exactly
`project.runtime_dependencies` (`yaml`) and `project.optional_dependencies` (`node-pty`) in
`workflow.ai.yml`; `scripts/check-workflow.mjs` fails otherwise. To add one: a decision in the
feature's `spec.md` (what it does, why Node's standard library or an existing dependency cannot, its
maintenance and licence), a change to the YAML list, and a minor classification, because it enters
every consumer's tree. Ranges are released and bounded (`^1.2.3`), never `*`, `latest`, a git URL or a
file path; the security audit fails them.

## Audit

`pnpm audit --audit-level low` is the required CI check "Dependency audit", blocking at any severity,
dev tooling included. Run it before adding or upgrading. A new advisory on an unrelated pull request
is fixed by upgrading or removing the package, not by a waiver.

## Install behaviour

- No lifecycle scripts in any `package.json` (`preinstall`, `install`, `postinstall`, `prepare`, ...).
  The security audit fails them; they run code on every consumer's machine.
- `node-pty` is optional and builds or downloads a native binary: that is why it is optional, and why
  the code must work without it.
- `pnpm-lock.yaml` is committed and reviewed like code: a lockfile diff that touches packages the
  change did not mention is a question.
- CI and the release workflow use `pnpm install --frozen-lockfile`, never a plain install, so what
  runs is what was reviewed.

## What each package publishes

Each package's `files` is `["dist"]`; npm adds `package.json`, `README` and `LICENSE`. Tests, specs,
`.agents`, `.indaba`, `scripts` and source maps' sources are not published. Check with `pnpm pack` (see
`smoke_tests`) before every release, and after any change to `files`, `exports` or `bin`.

## CI and release secrets

The release workflow needs `contents: write` (the GitHub release) and `id-token: write` (provenance
and npm trusted publishing). Publishing uses npm trusted publishing, so there is no `NPM_TOKEN` or other publish
credential in the repository or its secrets; adding one is a reviewed change to a protected file.
Provenance is on (`NPM_CONFIG_PROVENANCE`). Third-party actions are pinned
to a major version at least, and a new action is a reviewed change to a protected file. Nothing in the
repository holds a credential; `OPENROUTER_API_KEY` reaches a process from the environment only.
