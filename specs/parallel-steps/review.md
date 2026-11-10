# Self-review: Parallel steps

> **Status**: **slice 1 reviewed** (2026-11-07, by the author of the change, the same model that wrote it; no independent review has been
> run). Slices 2 to 4 are not implemented, so their parts of this review are pending and are written when they are. Slice 1 is the pool,
> the fields, the limit and its configuration: it changes no run.

## Slice 1 (T-01 to T-07)

### 1. Boundary and layering

`admit`, `parallelGroups` and `runsInProject` are pure and live in `@indaba/core` (`workflow/schedule.ts`), importing only the core's own
model and state; `packages/core/test/architecture.test.ts` passes. `StepPool` is in `@indaba/engine` (it uses `AbortController`, which
the domain may not). The command line imports `parallelGroups` and `runsInProject` from core and the limit constants from the engine,
which `packages/cli/test/layers.test.ts` allows. `@indaba/tui` is untouched.

### 2. Determinism and failure isolation

`admit` reads no clock, randomness or environment; the same input gives the same answer (tested). `INDABA_PARALLEL` is read only in the
command line's `run` and `plan`. The only non-deterministic input of the pool is which step settles first, which cannot differ yet: the
cap keeps one step running. A rejection of a step is turned into a result by the pool and rethrown by the engine, which aborts and
awaits every other step before teardown. **Not yet exercised with two steps running:** abort of descendants on a retry (AC-28), halting
with others running (AC-27) and cancellation of several steps (AC-29); the code marks where, and T-09 owns them.

### 3. Public surface and semver

Minor, as `api-surface.md` classifies it, with two additive amendments recorded there during T-05 (`maxParallelSource`,
`PARALLEL_STEP_CAP`). Defaults: the limit is 1, the cap is 1, so no run changes. The one observable difference is two attributes on the
root span (`indaba.workflow.max_parallel`, `.source`): the golden trace of the no-board run differs by exactly those two attributes and
nothing else (diffed before regenerating). The web form lists `max_parallel` and `max_waits` as integer fields because it is
generated from the schema; no web code changed. The pinned message of two config tests now names the `parallel` section.

### 4. Security

No new input reaches a shell or a path. `touches` is read and kept, not used yet. `INDABA_PARALLEL` and `--parallel` are parsed with a
strict digit-only rule. `scripts/security-audit.mjs --source`: no findings.

### 5. Observability and honest numbers

The root span records the limit that runs (after the cap), and the source it came from. A request above the cap is printed as such
(`Steps run one at a time in this version: ...`) instead of the consequences text, so no one is told about a parallelism that does not
happen. **Known inaccuracy:** a `parallel.max_steps` in the file that equals the default (1) is reported as `default`, not `config`,
because `ResolvedParallel` has defaults filled and does not say whether the file set it.

### 6. Dependencies and packaging

No dependency added. `pnpm smoke` passes (6 packages packed and audited).

### 7. Verification

```
pnpm qa: exit 0. Biome: Checked 420 files, no fixes (5 warnings and 1 info, all in files this change does not touch).
         Vitest: 169 files passed, 3064 tests passed, 2 skipped. Coverage: statements 97.01, branches 92.42, functions 96.51, lines 97.26
node scripts/check-workflow.mjs: workflow.ai.yml matches the repository
node scripts/security-audit.mjs --source: no findings
validate-skills, sync-claude-skills --check, sync-agent-docs --check, build-site --check: all clean; node --test scripts/*.test.mjs: 94 pass, 0 fail
pnpm build && pnpm smoke: 6 packages packed and audited; indaba 0.1.0-alpha.5 carries @indaba/tui, boots without @indaba/server, ...
```

**A flaky test found and fixed on the way.** With this change's extra tests in the run, `packages/cli/test/logging-config.test.ts`
("writes the last records of a command interrupted twice") failed twice in the full gate and passed alone and on a clean `main`. It
waited a fixed 100 ms for a plugin to log, a race against machine load. It now waits for a marker file the plugin writes after logging
(a change outside this feature, made because the gate must be green); it passed three runs alone and the full gate after.

### Known gaps (slice 1)

- `indaba ui --parallel` and the limit in the Settings screens of the terminal and the web view (AC-01, AC-04) are not done; they need
  the run control and the Settings screens and are the next change of slice 1.
- `meets`, `mustWait`, intents and negotiation (slice 3), forks and landing (slice 2), resolution and review before landing (slice 4).
- The cap (`PARALLEL_STEP_CAP`) stays through slice 2 (forks work behind `maxParallelCap`) and goes with T-15.

## Slices 2 to 4

Pending. Answer all seven dimensions when each is implemented. See [`.agents/rules/review.md`](../../.agents/rules/review.md).
