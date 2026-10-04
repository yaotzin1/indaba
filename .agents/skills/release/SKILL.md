---
name: release
description: Use when cutting a release, choosing a version number, pushing a tag, or changing what an npm package publishes. Covers the verification gate, the tag that releases, and how the release workflow publishes to npm with provenance.
---

# Release & npm Publishing

## How a release happens here

The version is in the `package.json` of every package under `packages/` (and the root manifest, which
is private). `.github/workflows/release.yml` runs on a pushed `v*` tag, and only then. It checks that
`CHANGELOG.md` has a section for the version and that every package is at that version, runs the full
gate (`check-workflow`, `pnpm qa`, `pnpm build`, the packed-install smoke test, `pnpm audit`),
publishes the packed packages with `npm publish` through npm trusted publishing (OIDC) with provenance, and creates the GitHub
release from the changelog section.

A pushed tag is therefore a release decision, and it is the maintainer's. An agent pushes one only
when asked, never runs `npm publish` or `pnpm publish` by hand, and says what the push starts. A
published npm version cannot be replaced; it can only be deprecated.

**State today:** `0.1.0-alpha.0` of all four packages was published by hand to reserve the names. Later
releases go through the release workflow with npm trusted publishing: each package must have the
trusted publisher (repository `yaotzin1/indaba`, workflow `release.yml`) configured on npmjs.com by the
maintainer. Check the registry (`npm view <name> dist-tags`) rather than assuming a version exists.

## The gate

```bash
pnpm qa
pnpm build
pnpm smoke
pnpm audit --audit-level low
node scripts/check-workflow.mjs --remote
```

Plus the other node gates, and the published-files audit from `smoke_tests`. `--remote` compares
branch protection with `ci.required_checks`; a required check no job produces blocks every merge.

## Choosing the number

Decided in the spec at stage 3 (see `api_surface`); at release you record it. Below 1.0, a breaking
change takes the next minor, and the changelog says it is breaking. 1.0.0 is a promise of the whole
public surface: the workflow schema, the CLI, events, span attributes and the exported API of every
package. All four packages move together.

## Procedure

1. On a `release/<version>` branch, set `version` in each `packages/*/package.json`, move `Unreleased`
   in `CHANGELOG.md` under `## [x.y.z] - date`, add the compare links, leave an empty `Unreleased`.
2. Run the gate. Read what `pnpm pack` would publish for each package.
3. Open the pull request (track `release`: it may touch only the changelog and the package
   manifests). Squash-merge when the required checks pass.
4. Tag the merge commit and push:

```bash
git switch main && git pull --ff-only
git tag -a v<version> -m "v<version>"
git push origin v<version>
```

5. Confirm: the workflow run is green, the GitHub release exists, and `npm view indaba version` and
   `npm view @indaba/core version` show the new version with provenance.

## If something is wrong after tagging

Do not move or delete a pushed tag. Release a patch, mark the bad version in the changelog, and let
the maintainer run `npm deprecate` on it. If the publish step failed halfway, the maintainer decides
how to complete it; an agent does not republish.
