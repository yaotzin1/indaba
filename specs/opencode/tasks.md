# Tasks: <feature name>

Ordered by dependency. Domain first, infrastructure second, console and documentation last. Each
task independently checkable.

## Domain

- [ ] **T-01**
- [ ] **T-02**

## Infrastructure

- [ ] **T-03**

## Console

- [ ] **T-04**

## Tests

- [ ] **T-05** Unit coverage for the new behaviour, success and failure paths
- [ ] **T-06** Hostile-input tests for any untrusted data
- [ ] **T-07** Architecture test still green

## Documentation

- [ ] **T-08** README and docs/
- [ ] **T-09** CHANGELOG entry under Unreleased
- [ ] **T-10** specs/DEPENDENCY_MAP.md

## Stage 7: Verification

- [ ] `pnpm qa` and the node gates (`node scripts/check-workflow.mjs`) green end to end, output recorded in review.md
