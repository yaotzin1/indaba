# Contributing

## Setup

PHP 8.4 is not needed on your machine, and is not expected to be there: PHP, Composer and git run in
the Docker image this repository defines. Node 22 is needed for the governance scripts.

```bash
docker compose run --rm php composer install
node scripts/install-hooks.mjs     # once per clone
```

`install-hooks` points `core.hooksPath` at the versioned `.githooks/`, so the gates actually block a
commit instead of merely being documented. The hook runs the Node gates always and the PHP gate
through Docker when Docker is available; if it is not, it says so loudly and CI is the wall.

## The gate

```bash
docker compose run --rm php composer qa      # PHP-CS-Fixer, PHPStan level 9, PHPUnit
docker compose run --rm php composer audit
node scripts/check-workflow.mjs              # plus validate-skills, sync-*, security-audit
node --test scripts/*.test.mjs
```

A change is not finished until these pass end to end. Report what they printed, not a summary.
`composer cs:fix` applies the code style.

## How work is organised

This repository runs a spec-driven workflow. `workflow.ai.yml` at the root is the source of truth for
the tracks, the stages, the skill registry, the gates and the architectural rules; `AGENTS.md` and
`GEMINI.md` are generated from it, and `scripts/check-workflow.mjs` fails when what it says about the
repository stops being true. It is the *development* workflow of Indaba, not the file format Indaba
executes (that is described in `docs/`).

Pick the track first: **feature** (a consumer would notice), **fix** (restores documented behaviour),
**chore** (docs, tooling, CI, tests) or **release**. A feature gets a spec directory:

```bash
cp -r specs/_template specs/<feature-name>
```

`spec.md`, `api-surface.md` and `review.md` are required. Delete whichever of the other five the
feature does not have, and name each under `## Artifacts not written` in `spec.md` with the reason.
`api-surface.md` is the contract written before the code.

Every commit carries a `Track:` trailer (and `Workflow-Change: <why>` when it touches the workflow,
its checks, the hooks, CI or the analyser configuration). See `.agents/skills/branching/SKILL.md`.

## The rules most worth knowing before your first change

**The domain imports no framework.** `src/Core`, `src/Workflow/Model|Graph|State` and `src/Mesh` use
no Symfony class. The architecture test fails otherwise.

**PHPStan level 9 with no ignores.** Fix the type; never silence it.

**The engine is deterministic.** Inject the clock, ids and configuration.

**Untrusted data never reaches a shell, a path or a log.** Argument arrays only. See
`.agents/skills/application_security/SKILL.md`.

**Classify the semver impact before writing the code.** The table is in
`.agents/skills/api_surface/SKILL.md`. A changed default, workflow field, CLI option, event or span
attribute is a major.

**Tests use fakes.** No network, no real agent CLI, no wall clock.

## Skills

Working guidance for each area lives in `.agents/skills/<name>/SKILL.md`. Claude Code reads generated
pointers in `.claude/skills/`, where underscores become hyphens. After editing a skill:

```bash
node scripts/sync-claude-skills.mjs
node scripts/validate-skills.mjs
```

## Pull requests

Fill `.github/PULL_REQUEST_TEMPLATE.md` completely, including the semver classification and the seven
review answers. We use **GitHub flow**: branch from `main` (`feat/`, `fix/`, `chore/`, `docs/`,
`release/`), open a pull request, and squash-merge once the required checks are green. `main` is
protected: no direct pushes, for anyone, administrators included.
