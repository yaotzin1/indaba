# Self-review: step stalls

# Release 1 (`timeout_seconds`)

> **Status**: complete for release 1. Release 2 (`stall` and its retry) is reviewed in the second part of this file.

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

---

# Self-review: step stalls, release 2 (`stall` and its retry)

> **Status**: complete for release 2, written 2026-11-06 by the author of the change (the same model that wrote it); no
> independent review has been run. Release 1 is above.

## 1. Boundary and layering

`@indaba/core` gained types and constants (`StallPolicy`, `MIN_STALL_SECONDS`, `MAX_STALL_SECONDS`, `MAX_STALL_RETRIES`), two
optional members (`RunRequest.stallSeconds`, `RunResult.stalled`), one optional field on `StepDefinition`, and the interface
`StallCapable` with one guard function. It imports nothing new; `architecture.test.ts` and the `layers.test.ts` files pass inside
`pnpm qa`. The silence timer is in `@indaba/runners` (`process.ts`), in the place that already owns the timeout and the abort. The
attempt loop, the checkpoint and the restore are in `@indaba/engine`; `GitWorktree` reaches git only through the `Git` wrapper. The
engine asks `isStallCapable(runner)` and `isRestorable(workspace)`, never a class, and `ClaudeRunner` uses the same interface a
plugin would; no built-in has access a plugin lacks.

## 2. Determinism and failure isolation

The engine decides on a flag in the outcome (`stalledSeconds`), not on a clock; the only timer is the silence timer in the process
layer, `setTimeout` beside the existing timeout one. Attempts are at most `1 + retries` (3 at most) per execution of a step, counted
in a local of `WorkflowEngine.execute`, so they begin again whenever the step is executed again, and they use none of `on_failure`'s
budget (tested: 4 calls for `retries: 1` with `max_retries: 1`). The next prompt carries only the stall (tested: the first prompt has
no feedback, the second has exactly `Your previous attempt stalled: ... Nothing it did was kept.`). A stalled process is stopped by
`killTree` exactly as a timed-out one is (tested with a real child and grandchild). The restore uses the worktree the engine already
owns and destroys in `finally`. A cancelled run starts no further attempt (tested). **Gap:** a restore that has begun is not
interrupted by the abort signal; the run's teardown removes the worktree anyway.

## 3. Public surface and semver

Minor, as `api-surface.md` says, with three amendments made before the code and recorded there: the floor is 60 seconds, not 30
(`MIN_STALL_SECONDS`); `StallCapable.canReportActivity` is a `boolean`, so `claude-code` can decline in plain mode; and the
restore is a snapshot of the worktree (spec C-06 amended), not a reset to `HEAD`. Added: the core items above; `ProcessSpec.stallSeconds`,
`ProcessOutcome.stalled` and `STALL_EXIT_CODE` in `@indaba/runners`; `RestorableWorkspace`, `WorkspaceCheckpoint`, `isRestorable`,
`checkStalls`, `describeStallFinding`, `StallFinding`, `StallRunners` and `StepOutcome.stalledSeconds` in `@indaba/engine`; the workflow
field `stall`; the `indaba.stall.*` attributes and the `indaba.step.stalled` event. Nothing existing changes meaning: a step without
`stall` sends no `stallSeconds`, records no stall attribute, and moves through the same states (tested, AC-20). `CHANGELOG.md`
records it. Two things worth knowing: the parser has never rejected unknown step keys, so a file that already carries a `stall` key,
ignored until now, will start to apply (the same note as for `timeout_seconds`); and `packages/web/test/workflow-schema.json` was
regenerated with `indaba schema` and holds only the new property (34 added lines, none removed).

## 4. Security

The only new inputs from the workflow are two numbers, checked to be whole numbers in range before anything runs; the error text
carries the step id and fixed words, never file contents (tested with a secret in the `goal`). The checkpoint is two object ids made by
git itself, checked against `^(?:[0-9a-f]{40}|[0-9a-f]{64})$` before they reach a git command, and passed as arguments through the
`Git` wrapper (`shell: false`); refused values are tested (an option, a short hash, upper case, a revision expression, a missing
tree). The restore deletes files: it runs in the step's own worktree, never in the person's project directory, and leaves ignored
files and `.indaba/` alone (tested with real git). The runner reads no stream content to decide activity: any data counts, so nothing
the model prints is parsed, copied or logged by this change. Reasons and event attributes hold numbers and fixed words only.
`security-audit.mjs` found nothing.

## 5. Observability and honest numbers

The attributes and the event are those of `events.md`, set only for a step that has `stall`; none holds a prompt or output (tested).
**One honest detail:** `indaba.stall.silent_seconds` is the limit that elapsed (`after_seconds`), not a measured silence, because the
runner reports that the limit was reached and not for how long; `events.md` now says so. A stalled attempt's tokens are reported on
its `invoke_agent` span like any attempt's when the runner reports them, and nothing is estimated. Every failure gives a sentence a person
can act on (`Stalled: no activity for N seconds.`, `The worktree could not be restored after a stall.`, or a validation message
naming the step and the runner).

## 6. Dependencies and packaging

None added. `pnpm build && pnpm smoke`: `smoke-pack: 6 packages packed and audited; indaba 0.1.0-alpha.5 boots without @indaba/tui and
@indaba/server, and the installed server finds its page`. `pnpm audit --audit-level low`: `No known vulnerabilities found`.

## 7. Verification

Run on Windows 11 with Node 22 on 2026-11-06; macOS and Linux only in CI.

```
pnpm qa, run 1: exit 1. lint and typecheck passed; the coverage run reported 1 unhandled rejection (ENOENT reading
  .indaba/run-inputs/web-...yml) from packages/cli/test/run-control.test.ts, a file this change does not touch.
pnpm vitest run packages/cli/test/run-control.test.ts, six times alone: Tests 36 passed (36) every time.
pnpm qa, run 2: exit 0. Test Files 161 passed (161); Tests 2939 passed | 2 skipped (2941).
pnpm qa, run 3: exit 0. Test Files 161 passed (161); Tests 2939 passed | 2 skipped (2941).
Coverage, all files (run 3): statements 96.97, branches 92.36, functions 96.46, lines 97.23 (floor 85).
node scripts/validate-skills.mjs: All 23 skills validated successfully! (0 Security Threats / 0 Syntax Errors)
node scripts/sync-claude-skills.mjs --check: .claude/skills is in sync (23 skills)
node scripts/sync-agent-docs.mjs --check: AGENTS.md, GEMINI.md and the cycle file are in sync
node scripts/check-workflow.mjs: workflow.ai.yml matches the repository
node scripts/security-audit.mjs --source: security audit: no findings (source, manifests, tsconfig, biome.json)
node scripts/build-site.mjs --check: site: every page of docs/ is on the site (22 in the navigation)
node --test scripts/*.test.mjs: pass 94, fail 0
pnpm e2e: Test Files 13 passed | 1 skipped (14); Tests 37 passed | 1 skipped (38)
```

`pnpm qa` failed once in `run-control.test.ts` and passed on two reruns with the same code, as it did during release 1; the cause is
not found. It reads a run's input file after the test's folder is removed, which looks like a race under load, but that is a guess.

Tests that would catch a regression: `packages/core/test/stall.test.ts`; `packages/runners/test/process-stall.test.ts` (the
timer on a fake terminal with fake timers, and on pipes with a real child, its grandchild killed, either stream restarting the
clock, a timeout winning, no limit changing nothing), `claude-stall.test.ts`; `packages/engine/test/step-stall-parser.test.ts`,
`worktree-restore.test.ts` (real git), `step-stall-engine.test.ts` (the whole contract through the real engine and a real worktree),
`schema.test.ts` (schema and parser agree); `packages/cli/test/stall.test.ts`. The key behaviour was checked to be able to fail:
with the restore replaced by a no-op, "runs the step again, with nothing the stalled attempt did" fails and the other 17 pass.

## Known gaps

- **No real stall has been seen.** The retry has been exercised with fake runners, a real git worktree, and real child processes
  that go quiet, but never against a real hung `claude` call; no such hang has been observed (research.md).
- **The 60-second floor rests on five calls on one machine** and one long tool call. A test run that is silent for minutes inside
  the agent was not measured; the docs tell authors to set `after_seconds` well above it.
- **The pseudo-terminal path** of the silence timer is tested only with a fake terminal.
- **`.indaba/` and ignored files are not restored**, by design; an attempt that wrote under `.indaba/` leaves that file.
- **`pnpm mutation` was not run.** The cookbooks do not use `stall` yet (the spec lets them adopt it once it ships).
- The flake in `run-control.test.ts` above.
