# Self-review: Installing ACP agents on demand

> **Status**: pending self-review. This change is a specification only; there is no implementation to review.

Answer all seven when there is something to review. See [`.agents/rules/review.md`](../../.agents/rules/review.md).

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

- Specification only; nothing is implemented. The registry was analysed from a downloaded copy; no agent was
  downloaded or installed.
- Open decisions: integrity policy for entries without a checksum, unattended installs, how licenses are
  treated, and the zip reader (spec section 8, questions 2 to 5).
