---
name: release
description: Use when cutting a release, choosing a version number, pushing a tag, or changing what the dist archive contains. Covers the verification gate, the tag that releases, and how Packagist picks up versions.
---

# Release & Packagist Publishing

## How a release happens here

Composer packages have no publish step. **Packagist reads the repository's tags through a GitHub
webhook**, so the version number is the tag. `composer.json` has no `version` field and must not
gain one. `.github/workflows/release.yml` runs on a pushed `v*` tag and creates the GitHub release;
it publishes nothing to Packagist.

A pushed tag is therefore a release decision, and it is the maintainer's. An agent pushes one only
when asked, and says what the push starts. A tag that has been picked up is effectively permanent:
Packagist caches it, and consumers lock it.

## The gate

```bash
docker compose run --rm php composer qa
docker compose run --rm php composer audit
node scripts/check-workflow.mjs --remote
```

Plus the smoke test and the archive audit from `smoke_tests`, and the node gates. `--remote` compares
branch protection with `ci.required_checks`; a required check no job produces blocks every merge.

## Choosing the number

Decided in the spec at stage 3 (see `api_surface`); at release you record it. Below 1.0, a breaking
change takes the next minor, and the changelog says it is breaking. 1.0.0 is a promise of the whole
public surface: the workflow schema, the CLI, events, span attributes and the public classes.

## Procedure

1. On a `release/<version>` branch, move `Unreleased` in `CHANGELOG.md` under `## [x.y.z] - date`, add
   the compare links, leave an empty `Unreleased`.
2. Run the gate. Read the `git archive` listing.
3. Open the pull request (track `release`: it may touch only the changelog and `composer.json`).
   Squash-merge when the required checks pass.
4. Tag the merge commit and push:

```bash
git switch main && git pull --ff-only
git tag -a v<version> -m "v<version>"
git push origin v<version>
```

5. Confirm: the workflow run is green, the GitHub release exists, and Packagist lists the version
   (its page, or `docker compose run --rm php composer show -a indaba/indaba`).

## First publication

The package must be submitted on packagist.org once, by the maintainer, and the GitHub webhook
enabled. Until then tagging only creates a GitHub release. Check, do not assume.

## If something is wrong after tagging

Do not move or delete a published tag. Release a patch, and mark the bad version in the changelog.
If a tag was pushed by mistake before anyone installed it, the maintainer decides whether to delete
it on GitHub and Packagist; an agent does not.
