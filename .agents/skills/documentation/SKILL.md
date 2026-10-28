---
name: documentation
description: Use when writing or updating a spec directory, README, CHANGELOG, DEPENDENCY_MAP, docs pages or doc comments, or when deciding which spec artifacts a feature needs. Covers what each document is for and keeping them in sync with the change.
---

# Spec & Documentation Architect

Documentation is part of the change. A feature whose docs lag is unfinished.

## Which document says what

| Document | Audience | Holds |
| :--- | :--- | :--- |
| `README.md` | someone deciding to use Indaba | what it is, `npx indaba`, the packages, a first run |
| `docs/` | someone using it | getting started, the workflow file reference, extending, runners, guards, CLI, observability; one page per topic, indexed in `docs/README.md` |
| `docs/vision.md` | everyone | the founding requirement, describing the TypeScript implementation; it moves with the design like any other page |
| `CHANGELOG.md` | someone upgrading | what changed, does it affect me, what do I do |
| `specs/<feature>/` | a maintainer | why it is shaped this way and what it promises |
| `specs/DEPENDENCY_MAP.md` | a maintainer | package dependencies and what breaks what |
| `AGENTS.md`, `CLAUDE.md` | agents | how to work here |
| doc comments (TSDoc) | the person reading the code | the why, and what the types cannot express |

## The documentation site (a must)

docs/ is the site GitHub Pages serves: `scripts/build-site.mjs` renders it with the landing page, template,
styles and animated illustration in `site/`, and `.github/workflows/pages.yml` publishes it from main.
Whenever code changes, update the site in the same pull request:

- every page under docs/ that describes what changed (a command, an option, a default, a workflow field,
  an install step, a screen) says what the code now does; never leave a page describing removed behaviour;
- a new page under docs/ goes into `PAGES` in `scripts/build-site.mjs` (`--check` fails the commit otherwise);
- `docs/getting-started.md` keeps "What is on npm" true: the version under `latest` and `next`, and which
  commands only a checkout of main has. Check with `npm view indaba dist-tags`;
- if the landing page (`site/index.html`) or the illustration (`site/hero.svg`) states something the change
  makes untrue, fix it too;
- run `pnpm site` and open `_site/index.html` for anything visual; say in the report which pages changed, or why
  none needed to.

## Nothing about paid plans

This repository is public. Never write which features are paid, priced or part of a commercial edition, or plans
about them, in any file, commit message or pull request; say only that a feature is not part of this repository
(see `specs/PRIVATE.md`).

## Spec directories

Required: `spec.md`, `api-surface.md`, `review.md`. Optional: `plan.md`, `tasks.md`, `data-model.md`,
`research.md`, `events.md`. Write the optional file or name it under `## Artifacts not written` with a
reason; `scripts/check-workflow.mjs` fails otherwise. `events.md` is where span attributes and event
payloads live; `data-model.md` is where the workflow schema delta lives. Padding is worse than
omission.

`review.md` is honest: fill the seven answers when the review has happened, and say "pending
self-review" while it has not. Do not write answers for a review nobody did.

## Distinguish the two workflows

The root `workflow.ai.yml` is the development workflow. The Indaba runtime format is documented in
`docs/workflow-format.md`. Never document one as the other, and say which is meant when a page says
"workflow".

## CHANGELOG

Keep a Changelog headings (Added, Changed, Deprecated, Removed, Fixed, Security). Each entry gives the
semver classification and, for a break, a before and after. Add it in the same change. Never claim
a version is published until it is.

## DEPENDENCY_MAP

Update the Mermaid graph and the "what breaks what" notes when a package gains or loses a dependency.
The architecture and layers tests are the enforcement; the map is the explanation.

## Doc comments

Explain why, or state what the type cannot: units, defaults, what `undefined` means, what is thrown.
Do not restate the signature or repeat the types in `@param`. A comment that records a bug the code
once had is worth keeping.

## Examples run

A workflow snippet in the docs should be run by a test, or be a file a test loads (the files under
`examples/`), so it cannot rot.
