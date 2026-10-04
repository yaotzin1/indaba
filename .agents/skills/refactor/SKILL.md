---
name: refactor
description: Use when restructuring code without changing behaviour, splitting an overgrown class, moving code across the domain boundary, or deprecating a public symbol. Covers keeping tests green at every step and the semver cost of moving things.
---

# Refactoring & Technical Debt Specialist

A refactor changes structure and nothing a consumer can observe. If behaviour changes, it is a fix or
a feature and takes that track.

## Preconditions

- Tests that pin the current behaviour exist and pass. If they do not, write them first (and commit
  them separately, on the chore track).
- `pnpm qa` is green before you start, so every red afterwards is yours.

## Method

Small steps, each ending green: rename, extract, move, inline. Run the tests after each step, not
after ten. Let `tsc` (strict) and Biome carry the mechanical checking; `pnpm lint:fix` settles
formatting and import order.

## What usually needs it

- A class doing parsing and validation and orchestration: split along the seam in
  `.agents/rules/architecture.md`.
- Logic hidden in infrastructure that is really a domain rule: move it into `@indaba/core` behind an
  interface, and the architecture test then guards it.
- Loose objects and string-keyed records: replace with `readonly` interfaces or discriminated unions,
  which also removes the need to narrow `unknown` in five places.
- Duplicated process handling across runners: extract a small collaborator, tested once.

## The public surface is not yours to move

Moving or renaming an export of a package, a workflow field or a span attribute is a **major** (see
`api_surface`). A file moving inside a package is not, as long as `src/index.ts` still exports the
same names. To restructure without breaking:

1. add the new shape;
2. make the old export forward to it and mark it `/** @deprecated use X */`, naming the replacement;
3. migrate internal callers;
4. remove the old export only in the next major.

Anything not re-exported from a package's `index.ts` is free to move.

## Not a refactor

Changing a default, tightening validation, reordering ties, renaming an event. Reclassify.

## Done

Same behaviour (the unchanged tests prove it), cleaner structure, no new public surface, a changelog
entry only if something a consumer sees was deprecated.
