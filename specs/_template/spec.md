# Specification: <feature name>

> **Status**: Draft
> **Stage entry**: 1
> **Semver impact**: patch | minor | major (provisional; confirmed in api-surface.md)

---

## 1. The problem

<!-- What a person who runs Indaba or embeds it cannot do today, or has to write themselves.
     Concrete, not aspirational. If the answer is "it would be nice if", this is not ready. -->

## 2. User stories

<!-- The users: a developer embedding Indaba, a person running `bin/indaba`, the author of a
     workflow file. -->

- **US-01.** As a workflow author, I ...
- **US-02.** As a developer embedding the engine, I ...

## 3. Acceptance criteria

<!-- Checkable statements. Each one becomes at least one test. -->

- [ ] AC-01
- [ ] AC-02

## 4. Non-goals

<!-- Load-bearing. An orchestrator grows into a platform one reasonable addition at a time, and
     this is where that is refused in writing. -->

-

## 5. Behaviour on failure

<!-- What happens when the agent fails, times out, is cancelled, returns garbage, or the process
     dies midway. What is torn down, what is reported, what state each step ends in. -->

| Situation | Expected behaviour |
| :--- | :--- |
| the runner exits non-zero | |
| the timeout elapses | |
| the run is cancelled | |

## 6. Security and data handling

<!-- Which inputs are untrusted, which paths and processes are touched, which secrets are in play. -->

## 7. Where it lives

<!-- Which module delivers this, whether it is pure domain or infrastructure, and what interface
     joins them. -->

## 8. Clarifications

<!-- Stage 2. Every ambiguity resolved, with the resolution. Each default chosen here is inherited
     by every consumer. -->

## Artifacts not written

<!-- One bullet per optional artifact you deleted from this directory, with the reason it does not
     apply. Delete this section when all of them are written.

- `events.md`: the feature emits no event and adds no span.
-->

