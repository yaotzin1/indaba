# Self-review: step stalls, release 1 (`timeout_seconds`)

> **Status**: complete for release 1. Release 2 (`stall` and its retry) is not implemented and not reviewed here.

## 1. Boundary and layering

`@indaba/core` gained one optional field on `StepDefinition`, one constant (`MAX_TIMEOUT_SECONDS`) and one optional option
on `RunnerParticipant`; it imports nothing new (`architecture.test.ts` passes inside `pnpm qa`). The range check is in the
engine parser, the precedence rule (step, then `--timeout`, then 900) is one expression in `StepExecutor`, and no runner
changed: each already honours `RunRequest.timeoutSeconds`. A plugin runner gets the same limit as a built-in. No built-in
has access a plugin lacks.

## 2. Determinism and failure isolation

No clock, randomness or environment read was added. Nothing is retried by this change, so no retry bound or isolation
changes. The limit is passed to the runner, which owns the deadline and the `AbortSignal` as before.

## 3. Public surface and semver

Minor, as `api-surface.md` says (R1 surface): a new optional workflow field, a new optional `StepDefinition` member, a new
core constant, a new optional `RunnerParticipantOptions` member and one span attribute; nothing existing changes meaning.
`CHANGELOG.md` records it. Two things worth knowing: the parser has never rejected unknown step keys, so a file that
already carries `timeout_seconds` on a step starts to apply it (stated in the CHANGELOG); and a debate step still ignores
`--timeout`, only its own `timeout_seconds` binds it (spec section 11). `packages/web/test/workflow-schema.json`, the
schema the web form is tested against, was regenerated and holds only the new property.

## 4. Security

The only new input is one number from the workflow file, checked to be a whole number from 1 to 86400 before anything
runs; the error text carries the step id and fixed words, no file contents. Nothing derived from it reaches a shell, a
path, a URL or a log beyond the attribute value. No dependency or HTTP call was added.

## 5. Observability and honest numbers

`indaba.step.timeout_seconds` is set on the step span only when the step sets it; the contract is `events.md` (R1). No
token count or cost is touched. A timeout keeps the runner's existing `Timed out after N seconds.` sentence, now with the
step's number.

## 6. Dependencies and packaging

None added. No file reaches a package that did not before. The packed-install smoke test and the dependency audit run in
CI, not here.

## 7. Verification

Run on Windows 11 with Node 22 on 2026-11-05; macOS and Linux only in CI.

```
pnpm qa: exit 0. Test Files 154 passed (154); Tests 2821 passed | 2 skipped (2823).
Coverage, all files: statements 96.94, branches 92.27, functions 96.47, lines 97.19 (floor 85).
node scripts/validate-skills.mjs: All 23 skills validated successfully! (0 Security Threats / 0 Syntax Errors)
node scripts/sync-claude-skills.mjs --check: .claude/skills is in sync (23 skills)
node scripts/sync-agent-docs.mjs --check: AGENTS.md, GEMINI.md and the cycle file are in sync
node scripts/check-workflow.mjs: workflow.ai.yml matches the repository
node scripts/security-audit.mjs --source: security audit: no findings
node scripts/build-site.mjs --check: site: every page of docs/ is on the site (21 in the navigation)
node --test scripts/*.test.mjs: pass 94, fail 0
```

Tests that would catch a regression: `packages/engine/test/step-timeout.test.ts` (parser range and message, precedence,
shell commands, debate participants, absent-not-undefined, the timed-out sentence, the span attribute),
`packages/core/test/mesh.test.ts` (participant), `schema.test.ts` (schema and parser agree), `board-plan.test.ts` (`plan`).
`pnpm qa` failed intermittently once during this work in `run-control.test.ts` and passed on retry with the same code; the
cause is not found (known, see the machine notes).

## Known gaps

- AC-03's sentence is produced by the runners, not by this change; the test uses a fake runner that prints it. The real
  runners' timeouts are covered by their own tests.
- `pnpm mutation` was not run.
- Release 2 (AC-04 to AC-13, AC-15 to AC-19, AC-21) and the "last activity" signal question in spec section 11 remain open.
