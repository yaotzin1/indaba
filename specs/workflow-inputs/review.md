# Self-review: Workflow inputs

> **Status**: slice 1 of 3 reviewed (below); the seven-question self-review is written when the last slice lands

Answer all seven. See [`.agents/rules/review.md`](../../.agents/rules/review.md). Do not write
answers for a review that has not happened: leave the status above and the sections empty until it
has.

## 1. Boundary and layering

## 2. Determinism and failure isolation

## 3. Public surface and semver

## 4. Security

## 5. Observability and honest numbers

## 6. Dependencies and packaging

## 7. Verification

```
<paste the actual output of: pnpm qa>
```

## Slice 1: core, the parse side and `resolveInputs` (independent review, 2026-11-20)

A fresh agent read the uncommitted diff against the spec and the contract. Each finding was read in the code before it was acted on.

| # | Finding | State |
| :--- | :--- | :--- |
| 1 | With `must_exist: false` a path that did not exist was accepted without looking where it led: `link/new.txt` through a link to outside passed (AC-18, section 6) | fixed: the nearest folder that exists is resolved and confined; tests with a fake link, and a failing look. **Open, accepted:** a dangling link that points out cannot be told from a name nobody made yet without an `lstat`, which the file-system port does not have; the check runs once at the start and the step's permissions and isolation are what hold afterwards |
| 2 | `extensions` was not checked on a path that does not exist | fixed: checked on the name |
| 3 | A tab was accepted in a path (AC-18 has no tab exception; AC-19's is for text) | fixed |
| 4 | A numeral that loses precision (`9007199254740993`, a long fraction for a whole number) or is written with an exponent (`1e21`, `0.0000001`) was accepted | fixed: at most 15 significant digits and no exponent when written back; a default is held to the same rule |
| 5 | A numeric default such as `0.0000001` was refused with a confusing message | fixed by the same rule (it is a number the format does not write); the message is the common one |
| 6 | Text-direction controls were echoed back in a message (`quoteValue`) | fixed: shown as spaces |

No defect was found in: lexical path handling (UNC, device, drive-relative, mixed separators, `..`, case), the interpolator (no input reaches `commands` or another field, `__proto__` and `constructor` are safe, the pattern is linear, a list expands only as a whole entry), the digest and the canonical text, or a workflow without inputs (its definition is the same; the only change is the literal `${{ inputs.x }}` of C-14). Not refused, because the spec does not list them: U+2028, U+200E, U+FEFF.

Verification: `pnpm qa` and `pnpm e2e` on the host before the commit.
