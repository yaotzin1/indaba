---
name: branching
description: Use when naming a branch, writing a commit message, opening or merging a pull request, or touching what protects main. Covers conventional commits, track trailers, squash merging and branch protection.
---

# Branching, Commits and Merging

## GitHub flow

`main` is always releasable and is never committed to directly.

1. Branch from an up-to-date `main` using the naming below.
2. Commit in small steps; every commit carries its `Track:` trailer.
3. Push the branch and open a pull request early (a draft is fine). CI runs on it.
4. Get the required checks green and the PR template answered; resolve every conversation.
5. Squash-merge. The branch is deleted automatically; `git switch main && git pull --ff-only`.
6. A release is a `release/<version>` pull request, then a tag on the merged commit (see `release`).

A hotfix is an ordinary `fix/` branch from `main`, merged the same way, then released.

## Naming

```
feat/<feature-name>      feature track; matches the specs/<feature-name> directory
fix/<short-description>  fix track
chore/<short-description>
docs/<short-description> chore track
release/<version>        release track
```

The feature branch and the spec directory share a name, so a reviewer can find one from the other.

## Commits

Conventional commits, because the changelog is derived from them:

```
feat(mesh): quorum rule for named roles
fix(runners): kill the process group on timeout
docs(specs): record the semver impact of the retry default
chore(ci): add the PHP 8.5 job
```

A `!` after the scope, or a `BREAKING CHANGE:` footer, marks a major.

Every commit also declares its track in a trailer, and the diff has to look like that track's work.
`.githooks/commit-msg` and the CI job "Track and deliverables" both run `scripts/check-track.mjs`:

```
fix(runners): kill the process group on timeout

Track: fix
```

- `chore` touches no source (`src/`, `bin/`). A change a consumer can notice is a fix or a feature.
- `release` touches only `CHANGELOG.md` and `composer.json`.
- A pull request is held to the heaviest track any commit declares. A `fix` that changed source
  needs a test and a CHANGELOG entry in the range; a `feature` needs a complete `specs/<name>/`
  directory and a CHANGELOG entry.
- A commit that touches `workflow.ai.yml`, the checks, the hooks, the CI workflows, `phpstan.neon`,
  the CS or PHPUnit config or the architecture test also carries `Workflow-Change: <why>`, so
  weakening a check shows in the history.
- Merge commits are exempt. `--no-verify` skips the hook and fails in CI instead.
- Commit trailers go in the last paragraph, with a blank line before them.

## Before opening a pull request

```bash
docker compose run --rm php composer qa
node scripts/check-workflow.mjs
```

Then fill `.github/PULL_REQUEST_TEMPLATE.md` completely, including the semver classification and the
seven review answers. A pull request that says "see the spec" for the review has not had one.

## Merging

Squash. The branch's intermediate commits are working notes; the trunk's history is the changelog's
raw material. The squashed message keeps the heaviest track's trailer.

## `main` is protected

Enforced by the repository, not by convention:

- **No direct pushes.** Every change arrives through a pull request, including a typo fix.
- **The required checks must pass**: exactly `ci.required_checks` in `workflow.ai.yml`. Changing a CI
  job name or the PHP matrix changes what GitHub must require. `scripts/check-workflow.mjs` fails when
  the YAML and the CI file disagree, and `node scripts/check-workflow.mjs --remote` when GitHub's
  settings do. A required check that no job produces blocks every merge silently.
- **The branch must be up to date** with `main` before merging.
- **No force pushes and no deletion**, for anyone.
- **Stale approvals are dismissed** when new commits arrive, and conversations must be resolved.
- **Administrators are bound too** (`enforce_admins`), so the maintainer has no push-to-main escape
  hatch either. A solo maintainer needs no approving review (the count is 0) but still needs the PR
  and the green checks.
- **Linear history, squash merge only**; merged branches are deleted automatically.


## Worktrees for agents

Parallel agents use `git worktree add ../indaba-<name> <branch>` outside the repository. Never under
`.indaba/worktrees/`: that directory belongs to Indaba's runtime.
