---
name: smoke_tests
description: Use when verifying the installed package rather than the source tree, changing .gitattributes export-ignore, the bin entry, autoloading or composer.json packaging fields. Covers the production install smoke test and the dist archive audit.
---

# Built-Artifact Verification Specialist

A green unit suite proves the source works with the development tree around it. It says nothing
about what a consumer receives: the autoloader, the `bin` entry, the files in the archive and the
runtime dependencies without `require-dev`.

## What the artifact is

A Composer package: the `git archive` of a tag (what Packagist serves) plus `composer install
--no-dev`. Indaba has no build step and no phar yet; if one is added, this skill gains its checks.

## The smoke test

CI runs it as a step of the verify job, and you can run it locally in Docker:

```bash
docker compose run --rm php sh -c 'rm -rf /tmp/smoke && mkdir /tmp/smoke && git archive HEAD | tar -x -C /tmp/smoke && cd /tmp/smoke && composer install --no-dev --no-interaction && php bin/indaba list'
```

It proves: the archive contains what the autoloader needs, `composer.lock` and `composer.json`
agree, no dev-only class is required at runtime, and the CLI boots. Extend it with a tiny workflow
run through `ShellRunner` once the CLI has a `run` command.

## The archive audit

`.gitattributes` marks everything a consumer does not need `export-ignore`: `tests`, `specs`, `.agents`,
`.claude`, `.github`, `.githooks`, `scripts`, `docs` as decided, Docker files, `phpunit.xml.dist`,
`phpstan.neon`, `.php-cs-fixer.dist.php`, `workflow.ai.yml`. Check the list with
`git archive HEAD | tar -t` and read it. A stray `.env`, `.indaba/` content or `vendor/` is a leak.

`src/`, `bin/`, `composer.json`, `LICENSE`, `README.md` and `CHANGELOG.md` must be present.

## When to run it

Any change to `composer.json`, `.gitattributes`, `bin/`, autoload configuration, or a new runtime
dependency; and before every release.

## Known limit

A git archive needs a commit. Before the first commit exists, this cannot run; CI runs it from the
first pushed commit on.
