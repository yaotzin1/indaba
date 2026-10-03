# Events and telemetry contract: <feature name>

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it.

## Events added

| Event class | Payload | Dispatched when |
| :--- | :--- | :--- |

## Events changed

<!-- Changing a payload is a major version: listeners destructure these. -->

| Event | Before | After |
| :--- | :--- | :--- |

## Spans and attributes

<!-- GenAI conventions where they exist (gen_ai.*), indaba.* for ours. Never a secret or a payload. -->

| Span | Parent | Attributes |
| :--- | :--- | :--- |

## Ordering guarantees

<!-- What is guaranteed to be true by the time a listener runs. State it, because consumers will
     depend on it whether or not it is written down. -->

## Teardown

<!-- What each new process, stream, listener or worktree releases, and when. -->
