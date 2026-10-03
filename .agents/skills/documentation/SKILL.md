---
name: documentation
description: Use when writing or updating a spec directory, README, CHANGELOG, DEPENDENCY_MAP, docs pages or docblocks, or when deciding which spec artifacts a feature needs. Covers what each document is for and keeping them in sync with the change.
---

# Spec & Documentation Architect

Documentation is part of the change. A feature whose docs lag is unfinished.

## Which document says what

| Document | Audience | Holds |
| :--- | :--- | :--- |
| `README.md` | someone deciding to use Indaba | what it is, install, a first run |
| `docs/` | someone using it | the workflow file reference, runners, guards, CLI, observability, extending; one page per topic, indexed in `docs/README.md` |
| `docs/vision.md` | everyone | the founding requirement, kept verbatim |
| `CHANGELOG.md` | someone upgrading | what changed, does it affect me, what do I do |
| `specs/<feature>/` | a maintainer | why it is shaped this way and what it promises |
| `specs/DEPENDENCY_MAP.md` | a maintainer | module dependencies and what breaks what |
| `AGENTS.md`, `CLAUDE.md` | agents | how to work here |
| docblocks | the person reading the class | the why and the types PHP cannot express |

## Spec directories

Required: `spec.md`, `api-surface.md`, `review.md`. Optional: `plan.md`, `tasks.md`, `data-model.md`,
`research.md`, `events.md`. Write the optional file or name it under `## Artifacts not written` with a
reason; `scripts/check-workflow.mjs` fails otherwise. `events.md` is where span attributes and event
payloads live; `data-model.md` is where the workflow schema delta lives. Padding is worse than
omission.

`review.md` is honest: fill the seven answers when the review has happened, and say "pending
self-review" while it has not. Do not write answers for a review nobody did.

## Distinguish the two workflows

The root `workflow.ai.yml` is the development workflow. The Indaba runtime format is documented
under `docs/`. Never document one as the other, and say which is meant when a page says "workflow".

## CHANGELOG

Keep a Changelog headings (Added, Changed, Deprecated, Removed, Fixed, Security). Each entry gives the
semver classification and, for a break, a before and after. Add it in the same change.

## DEPENDENCY_MAP

Update the Mermaid graph and the "what breaks what" notes when a module gains or loses a dependency.
The boundary test is the enforcement; the map is the explanation.

## Docblocks and comments

Explain why, or give a type: `@param list<StepDefinition>`, `@return array<string, TokenUsage>`,
`@throws`. Do not restate the signature. A comment that records a bug the code once had is worth
keeping.

## Examples run

A workflow snippet in the docs should be run by a test, or be a file a test loads, so it cannot
rot.
