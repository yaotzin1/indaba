---
name: security_guard
description: Use when adding or upgrading a dependency, editing composer.json or composer.lock, changing what the dist archive contains, or touching CI secrets and the release workflow. Covers runtime dependency policy, Composer plugins and scripts, the lockfile and archive contents.
---

# Supply Chain & Publish Safety Specialist

Every dependency is code that runs with a developer's API keys. The policy keeps that list short,
explicit and audited.

## Runtime dependencies are a recorded decision

`composer.json` `require` lists exactly the packages in `project.runtime_dependencies` of
`workflow.ai.yml`; `scripts/check-workflow.mjs` fails otherwise. Symfony components share one
constraint (`project.symfony_constraint`). To add one: a decision in the feature's `spec.md`
(what it does, why the standard library or an existing component cannot, its maintenance and licence),
a change to the YAML list, and a minor classification, because it enters every consumer's tree.

## Audit

`composer audit` is the required CI check "Dependency audit", blocking at any severity. Run it in
Docker before adding or upgrading. A new advisory on an unrelated pull request is fixed by upgrading
or removing the package, not by a waiver.

## Composer behaviour

- No lifecycle scripts (`post-install-cmd`, `post-update-cmd`, `post-autoload-dump`, ...). The
  security audit fails them.
- `allow-plugins` names plugins one by one, as a recorded decision, never `*` or `true`.
- `minimum-stability` stays `stable`; no `dev-` constraints; no plain `http` repositories.
- `composer.lock` is committed for the application and reviewed like code: a lockfile diff that
  touches packages the change did not mention is a question.
- Use `composer install` in CI and Docker images, never `update`, so what runs is what was reviewed.

## The dist archive

What Packagist serves is the tag's `git archive`, shaped by `.gitattributes` `export-ignore`. It
contains `src`, `bin`, `composer.json`, `LICENSE`, `README.md`, `CHANGELOG.md` and nothing about our
development workflow, secrets or runtime state. See `smoke_tests` for the check.

## CI and release secrets

The release workflow needs only `contents: write` to create a GitHub release. No Packagist token is
stored: Packagist is updated by its GitHub webhook. Third-party actions are pinned to a major
version at least, and a new action is a reviewed change to a protected file.

## Docker image

The Dockerfile pins the PHP minor and installs only what the toolchain needs. Treat it as
development infrastructure: it never carries real credentials, and the compose file passes
`OPENROUTER_API_KEY` through from the host environment rather than storing it.
