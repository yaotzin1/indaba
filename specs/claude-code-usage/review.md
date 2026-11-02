# Self-review: Token usage and cost from the claude-code runner

> **Status**: reviewed (by the author, and by an Indaba review debate between Claude Code and Antigravity, whose six findings were fixed)

## 1. Boundary and layering

The change is in `@indaba/runners` only: `claude-runner.ts` and a new pure `claude-stream.ts`. `@indaba/core` and
`@indaba/engine` are untouched (`RunResult.usage`, `reportedCostUsd` and `model` existed, and the step executor already
records them). The only edit outside the runner is making `spawner` and `usePty` of `AbstractCliRunner` `protected`, so a
subclass can run the process itself. `packages/runners/test/layers.test.ts` passes.

## 2. Determinism and failure isolation

No clock, randomness or environment read. A parse failure never throws: a line that is not a JSON object is skipped, and
a missing or malformed field leaves `usage`, `reportedCostUsd` or `model` absent. Timeout and abort keep their codes
(124, 130) and the partial answer. Temporary MCP files are removed in `finally` on the new path too (the existing MCP
tests run through it, including the process that cannot start).

## 3. Public surface and semver

Minor, below 1.0: one optional `ClaudeRunnerOptions.reportUsage`. The default call line changes (`--output-format
stream-json --verbose`), the process runs on pipes, and spans that had no tokens or cost now have them. No workflow field,
CLI option, event or span attribute is added; `api-surface.md` lists the changed behaviour. The relation to the
unimplemented `specs/step-stalls` (same stream mode) is recorded in both specs.

## 4. Security

The CLI output is untrusted. It is split into lines and each is `JSON.parse`d in a `try`; only named fields are read, each
type-checked, through `Object.hasOwn`; the parsed object is never spread or passed on. Token counts must be safe
integers whose sum is one, the cost a finite non-negative number, and the model name matches a short pattern, so nothing
unbounded or odd reaches a span attribute. A `__proto__` key in the output is tested to pollute nothing. The prompt stays
an element of the argument vector. When no line is a JSON object, the stdout is shown as before, so an error is not
hidden; when the stream is cut before an answer, the `init` event (working folder, tool list) is not shown. The security
audit reports no findings.

## 5. Observability and honest numbers

Tokens are the prompt size (fresh plus cache writes plus cache reads) and the output tokens, as the CLI printed them. The
cost is `total_cost_usd` from the CLI, recorded as the runner-reported cost; it is never computed here, and the engine
keeps a cost it worked out from a price table over it. When the CLI gave nothing usable the call shows "unknown", not zero.
Checked on the real CLI: a one-step workflow showed `27756 in / 4 out, $0.0465`, and the trace held
`gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` and `indaba.cost.usd`. The review debate of this change itself
showed `$0.6655` for its Claude Code calls and `unknown` for its Antigravity calls.

## 6. Dependencies and packaging

No dependency added. No package file or export changed (`claude-stream.ts` is not exported from the index).

## 7. Verification

```
pnpm qa
Checked 396 files in 278ms. No fixes applied.
 Test Files  150 passed (150)
      Tests  2724 passed | 2 skipped (2726)
All files          |   96.94 |    92.25 |   96.45 |    97.2 |
  claude-runner.ts |   97.43 |      100 |    90.9 |   97.36 | 108

pnpm e2e (before the review fixes; they touch only the parser and unit tests)
 Test Files  13 passed | 1 skipped (14)
      Tests  37 passed | 1 skipped (38)

node scripts/check-workflow.mjs
workflow.ai.yml matches the repository
```

Not run here: `pnpm smoke` (no packaging or export changed), `pnpm audit` (no dependency changed), and the Windows and macOS
matrix (CI).

## Known gaps

- **The other CLI runners** (`codex`, `cursor`, `antigravity`, `opencode`) still report nothing: each needs its own check of
  what its CLI prints. Follow-up T-27 stays open for them.
- **Live output.** The answer reaches `onOutput` once, as the plain call did, not as the events arrive. `specs/step-stalls`
  needs the events as activity and will change that path.
- **`permission_denials`** in the result event could feed the silent-refusal check of `specs/agent-permissions`; not done.
- **Cache pricing.** The input figure includes cache reads and writes, which are priced differently. The reported cost is the
  CLI's own, so it is right, but a cost computed from a price table over these tokens would be too high.
- **Cookbook paragraph.** `docs/cookbook-spec-first.md` (PR #109, not on `main`) still says the runs show unknown cost; it is
  updated after that PR merges.
- **A CLI version without `stream-json`** fails the call (the CLI rejects the flag); `reportUsage: false` is the way back. Not
  tried on an older CLI.
- **AC-12** is covered by the existing engine tests of a runner-reported cost (`step-executor.test.ts`), not by a new one.
- **The review debate did not settle** formally (Claude Code still raised items in round 4, so it escalated), although both
  reviewers accepted the same final six findings; all six were fixed and tested.
