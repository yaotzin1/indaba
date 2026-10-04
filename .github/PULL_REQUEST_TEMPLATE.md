# What and why

<!-- What a consumer gets from this, in two sentences. Link the spec directory on the feature track. -->

Spec: `specs/<feature-name>/`

## Track

<!-- From workflow.ai.yml. A fix that changes a public signature or a default is a feature. -->

- [ ] feature: stages 1 to 8
- [ ] fix: a test that failed before, then 7 and 8
- [ ] chore: 7 and 8
- [ ] release: 7 and 8, then the `release` skill (`.agents/skills/release/SKILL.md`)

Stages run, and any skipped with the reason:

## Semver classification

<!-- Decided when the change was planned, recorded in api-surface.md. A changed default is a major
     even though nothing fails to type-check. Below 1.0 a major takes the next minor. -->

- [ ] none: nothing a consumer installs changes
- [ ] patch: no change to the public surface
- [ ] minor: additions only
- [ ] major: a signature, a default, a workflow field's meaning, a CLI option, an event or span attribute changed

Exports, workflow fields, CLI options, events and attributes added, changed or removed:

## Verification

<!-- Paste what it printed, not a summary of it. -->

```
pnpm qa
```

- [ ] `pnpm qa` green (Biome, tsc strict with no suppressions, Vitest), and the operating system it ran on named
- [ ] `pnpm audit --audit-level low` clean
- [ ] the node gates green (`validate-skills`, `sync-*`, `check-workflow`, `security-audit`, script tests)
- [ ] `pnpm build && pnpm smoke` passes, if packaging or an exported name changed (the packed install boots)
- [ ] `node scripts/check-workflow.mjs --remote`, if CI job names or the os matrix changed

## Self-review

<!-- The seven dimensions from .agents/rules/review.md. Answer them here; "see the spec" means
     the review has not happened. These cover the architectural rules enforced only by review. -->

1. **Boundary and layering**:
2. **Determinism and failure isolation**:
3. **Public surface and semver**:
4. **Security**:
5. **Observability and honest numbers**:
6. **Dependencies and packaging**:
7. **Verification**:

## Documentation

- [ ] `README.md` updated, or not affected
- [ ] `docs/` updated in this change for any workflow field, guard, runner option, CLI option or default
- [ ] `CHANGELOG.md` entry added under Unreleased, or not needed on this track
- [ ] `specs/DEPENDENCY_MAP.md` updated, or not affected
- [ ] `workflow.ai.yml` edited and the sync scripts re-run, if the tracks, stages, gates or skills changed
