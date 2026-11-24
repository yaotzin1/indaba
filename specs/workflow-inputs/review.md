# Self-review: Workflow inputs

> **Status**: slices 1 and 2 reviewed (below); slice 3 is partly built (T-23, T-28 to T-31 done by the author, not yet independently reviewed); the channel (T-24) and the readiness items are not built. The seven-question self-review is written when the last slice lands

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

## Slice 2: the prompt section, the run record and the command line (independent review, 2026-11-21)

A fresh agent read the uncommitted diff against the spec; each finding was read in the code before it was acted on.

| # | Finding | State |
| :--- | :--- | :--- |
| 1 | `--input constructor=x` (also `__proto__`, `toString`) crashed with "given.push is not a function" and exit 1: the options were collected in a plain object | fixed: a Map; the name is refused as not declared, exit 2 |
| 2 | `run --tui` handed the child what the person typed as `--input` options: visible in the process list, and the 200-option cap was not counted for the answers | the spec's design (AC-17; the exposure is the one section 6 names for `--input`); fixed what could be: the parent counts the answers with the options and refuses before the dashboard. **Open, accepted:** a very long typed text can exceed the command-line limit of Windows (about 32,000 characters) and the child then does not start; the terminal form (slice 3) and `--input-file` are the way around it |
| 3 | The terminal questions read one line for a multiline text, so pasted lines went to the next question | fixed: a multiline text is read until an empty line and joined with line feeds. A line pasted beyond the empty line that finishes an answer is not kept for the next round of questions |
| 4 | The description from the workflow file reached stderr with control characters (`resolve.ts`) | fixed: control and text-direction characters are shown as spaces; a choice with a text-direction character is refused at parse |
| 5 | With a declaration that has problems, `--input x=1` said "this workflow takes no inputs" instead of the real problems | fixed: such a file is left to the parse, which says what is wrong |
| 6 | `validate` printed the usage of `plan` after a bad option | fixed |

Noted, not changed: the 50000-character limit of AC-21 is checked when a step starts, so a later step can fail after earlier work is done, and a retry repeats the same failure. It is a clean step failure (the message names the largest inputs), and checking every step at the start would need the values of all steps before the first runs; the limit is a design choice (C-13) and an author who sees it lowers `max_length`.

No defect was found in: the fence and the section content (longer than any backtick run, only for a step that names the input, kept on a retry, in a debate topic and the intent call), the trace content (counts, the digest, names, types; a text as a length only), that nothing is created before the inputs resolve (run and `run --tui`), the first-`=` split, the cap, `--input-file` confinement and size, `gatherInputs` (it ends, three tries, an option's value is never asked again, the exit codes 2 and 130), or a workflow without inputs.

Verification: `pnpm qa` and `pnpm e2e` on the host before the commit.

## Slice 3, the part built so far: the form of `run --tui`, the example, the documents (author notes, 2026-11-24, pending independent review)

Not an independent review: these are the author's notes on what to look at.

- **What it is.** `@indaba/tui` gains `collectInputs` (an Ink form) over a pure state (`inputs-form.ts`); `TuiModule.collectInputs` is optional in the CLI, so an older `@indaba/tui` keeps the plain questions. `run --tui` uses it only when a person is at the terminal and nothing else supplied the questions.
- **Values.** The form checks only "an answer was given"; the run checks every value with the functions every other way of giving one goes through, and a refused answer is asked again (tested through the form). A typed value is in no log line (a test types a marker and scans the records); the logger gets the count of inputs and whether it ended answered.
- **Terminal text.** What a workflow file says (name, description, choices) is cut to one line with control characters removed, and 7-bit under `INDABA_ASCII=1`. A typed or pasted chunk has control characters removed; a pasted chunk that holds a line break is one chunk to Ink, so the break is dropped and the person presses Enter: noted, not fixed.
- **Layering.** Only `ink/adapter.ts` imports `ink` and `react`; the tui layers test is green.
- **Semver.** Minor: new exports and an optional member of an interface the CLI owns. No default changes.
- **Not done.** T-24 and the readiness items (AC-03 of `run-readiness`) and the start dialogs of Home and the web page (`tui-run-inputs`). The docs say so.
- **A test that had to change.** Four tests that parse every shipped example without placeholders now parse with them, as `validate` does, because `examples/review-specs.workflow.ai.yml` asks for inputs and needs no values to be checked.
