# Self-review: Terminal UI (`@indaba/tui`)

> **Status**: pending self-review. This change is a specification only; there is no implementation to
> review yet.

Answer all seven when there is something to review. See [`.agents/rules/review.md`](../../.agents/rules/review.md).
Do not write answers for a review that has not happened.

## 1. Boundary and layering

## 2. Determinism and failure isolation

## 3. Public surface and semver

## 4. Security

## 5. Observability and honest numbers

## 6. Dependencies and packaging

## 7. Verification

```
<paste the actual output of: pnpm qa, and node scripts/check-workflow.mjs>
```

## Known gaps

- Specification only; nothing is implemented and nothing was run beyond measuring the candidate dependency.
- The dependency decision (Ink, pinned versions), the event-stream shape and the JSX question (spec
  section 8, questions 1 to 4) are open and block planning.
- Windows behaviour of Ink was not tested.
