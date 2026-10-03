# Self-Review Checklist

Before declaring any change complete, answer all seven: in `specs/<feature>/review.md` on the feature
track, in the pull request on every other track. Several architectural rules in `workflow.ai.yml`
are enforced by nothing but these answers; an answer of "n/a" says why.

## 1. Boundary and layering

Does anything under `src/Core`, `src/Workflow/Model|Graph|State` or `src/Mesh` now import Symfony or
infrastructure? Do imports still point one way? Did a rule about what is legal end up in the engine
or a runner instead of the domain? Does anything outside the composition root name a concrete runner?

## 2. Determinism and failure isolation

Does decision logic read a clock, randomness or the environment instead of taking it by injection?
Are ties broken by declaration order? Is a retry bounded, and does the next attempt receive only the
last failure? Does every started process and created worktree have an owner that removes it on
success, failure and cancellation? Does the runner honour the deadline in its `RunRequest`?

## 3. Public surface and semver

What did the public surface gain, lose or change: classes, workflow fields, CLI, events, span
attributes, defaults? Is the classification recorded in `api-surface.md` and `CHANGELOG.md`? Does a
new type appear in a public signature without being public?

## 4. Security

Can anything derived from a workflow file, a model's output, a branch or file name reach a shell, a
path, a URL or a log? Are paths confined to their root? Are secrets absent from traces, events,
exceptions, artifacts and prompts? Does a new HTTP call go through the shared client with a timeout,
and could its URL be steered at an internal address?

## 5. Observability and honest numbers

Do the new spans and attributes follow the GenAI conventions and the recorded attribute set? Is any
token count or cost shown that was neither measured nor labelled an estimate? Is unknown reported as
unknown rather than as zero? Does a failure surface a sentence a person can act on?

## 6. Dependencies and packaging

Any new runtime dependency (a recorded decision, and `project.runtime_dependencies` updated)? Does
`composer audit` pass? Would anything new reach the dist archive that should not (tests, specs,
`.agents`, `.indaba`)?

## 7. Verification

Did `docker compose run --rm php composer qa` and the node gates pass end to end, and are you
reporting their actual output? Is there a test that would have caught this change's absence, and one
that would catch its regression?
