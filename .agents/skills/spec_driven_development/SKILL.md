---
name: spec_driven_development
description: Use when starting a change, choosing its track, or running it through the stages: specify, clarify, plan, tasks, analyze, implement, verify, review and ship. Covers the spec directory and what each stage must produce.
---

# Spec-Driven Development

The stages from `workflow.ai.yml`, as a procedure. Which of them a change goes through is its track;
the rules are in [`.agents/rules/spec_pipeline.md`](../../rules/spec_pipeline.md). This is guidance:
nothing runs these stages for you, and nothing fails when one is skipped except the review.

Not to be confused with Indaba's own workflow format: this is how Indaba's *developers* work. Running
these stages with Indaba itself is a future goal, not a current feature.

## Before anything: the track

- `feature`: every stage below.
- `fix`: start at 6 with a test that fails, then 7 and 8.
- `chore`: 7 and 8.
- `release`: 7 and 8, then the `release` skill.

## 1. Specify

Copy the template (`specs/_template`) to `specs/<feature-name>` (on Windows, with your file manager or
`cp -r` in Git Bash), then fill `spec.md`: the problem for the person who runs or embeds Indaba,
stories, acceptance criteria, non-goals, and which package delivers it. Non-goals are load-bearing; an
orchestrator grows into a platform one reasonable addition at a time. No implementation detail: a
sentence that names a file belongs in `plan.md`.

## 2. Clarify

Resolve every ambiguity that would change the public surface: names, defaults, failure behaviour,
which side of the domain boundary a behaviour sits on. Write the resolutions into `spec.md`. Each
default chosen here is inherited by every consumer.

## 3. Plan

Always `api-surface.md`: every export, method, workflow field, CLI option, event and span attribute
added, changed or removed, with TypeScript signatures, defaults and the semver classification. Then
whichever of `plan.md`, `research.md`, `data-model.md`, `events.md` the feature has. Name the ones
that do not apply under `## Artifacts not written` in `spec.md`.

Write `api-surface.md` precisely enough that two agents who never speak produce halves that fit.

## 4. Tasks

When there is more than one step worth tracking, `tasks.md`: `@indaba/core` first, then infrastructure
packages, tests alongside each, the CLI and documentation last. Each task independently checkable.

## 5. Analyze

Audit the plan before code:

- A published signature broken without the right version?
- A `node:` import or I/O in `@indaba/core`?
- A new runtime dependency (a recorded decision)?
- Untrusted data reaching a shell, a path, a URL or a log?
- A wall clock, randomness or environment read in decision logic?
- An unbounded loop, retry or buffer?

A failure returns to Plan. It does not proceed with a note.

## 6. Implement

Test first, against `api-surface.md`. Splitting between agents is described in
[`.agents/rules/agent_orchestration.md`](../../rules/agent_orchestration.md). An agent that finds the
contract wrong stops and reports.

## 7. Verify

See the `verification` skill. Every gate, actual output reported.

## 8. Review and ship

Write `review.md` (or the review answers in the pull request off the feature track) against
[`.agents/rules/review.md`](../../rules/review.md). Update `README.md`, `CHANGELOG.md`, `docs/` and
`specs/DEPENDENCY_MAP.md` where they changed. Open the pull request; it merges when the required
checks in `workflow.ai.yml` are green.
