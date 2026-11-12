# Self-review: Parallel steps

> **Status**: **all slices reviewed** (slice 1 on 2026-11-07, slices 2 to 4 on 2026-11-12), by the author of the change, the same model that wrote it; no independent review has been
> run. One acceptance criterion is open: review before landing (AC-21) waits for `step-verdicts`. Slices 2 to 4 are reviewed after the known gaps.

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

### Known gaps (slice 3, T-12)

- The spans of the intent call and the negotiation hang from the root span, not from the step (see the amendment of `api-surface.md`); the landing has no span of its own yet (`indaba.land.sequence`, AC-22, AC-31).
- The structured log records of AC-33 (admission, intent, put back, negotiation outcome, landing) are not written: the engine has no logger.
- A negotiation that reaches consensus without a valid proposal goes to the decider, not to the arbiter (AC-14 reads it as "not reached").
- Steps in one batch that meet are grouped by chains of `meets`, so two steps that do not meet each other but both meet a third negotiate together.
- A step admitted while another batch is still declaring is not compared with it (it is not yet "working"): landing and resolution catch what the check missed (C-10).
- ~~Steps put back to wait are shown as `PENDING`~~ done in T-13: they carry `waitingFor` and say which step they wait for.

### Known gaps (slice 3, T-13)

- The web view has no run board, so intents and contracts are shown only in the dashboard's board pane (T-11); the web view shows the waits. They arrive in the web view with a board view, which is a separate feature.
- The wait span records the blocker the step first waited for in its start record, which is what a live view reads; if the step is put back again for another blocker, the final blocker and count appear on the span's end record only. A live view therefore shows the first blocker until the wait ends.
- A step put back to wait gets no `step` span, so it has no `startedAt`; its wait is shown from the wait span only.

### Known gaps (slice 1)

- `indaba ui --parallel` and the limit in the Settings screens of the terminal and the web view (AC-01, AC-04) are not done; they need
  the run control and the Settings screens and are the next change of slice 1.
- `meets`, `mustWait`, intents and negotiation (slice 3), forks and landing (slice 2), resolution and review before landing (slice 4).
- The cap (`PARALLEL_STEP_CAP`) is removed at T-15.

### Release (slice 4, T-15)

- **The cap is removed.** A limit above 1 now runs steps at the same time; the notice at the start of a run and in `indaba plan` shows the consequences (AC-04a) instead of "steps run one at a time in this version".
- **Review before landing (AC-21) is pending, not done.** `step-verdicts` and `review-gate` are specified and not implemented, so there is no review to wire. A step lands after its guards and, when it conflicts, after the resolution of T-14. When either spec ships, its review runs between the guards and the landing, on the step's own diff; the seam is `land` in `workflow-engine.ts`. Until then a person who sets a limit above 1 gets guards and resolution only.

### Known gaps (slice 4, T-14)

- The board notes of the step whose change was met are not in the resolution prompt, only its goal, intent and contract: the resolution call runs without the board so that it leaves no entries pending. AC-24 asks for the notes too.
- The step it met is the last step that landed a change to one of the conflicting paths, from the paths of each landed diff. A conflict with a change that was not landed by a step of this run (an earlier sequential step) has no step to ask: the guards are then the only check, as for a shell step.
- A step with no role, or a met step with no role or a shell step, has no debate (the guards are enough, AC-24 last line). A step that is itself a shell or debate step cannot be resolved and fails as before, with the reason.
- With no terminal, a debate that the examiner does not settle ends without an accept, so the step fails (AC-25); there is no question to the person here.
- `land_failed` and `conflicts_again` (the resolved change cannot be applied after all) are not exercised: with the landing lock held nothing can change the run worktree, so they are defensive.
- The resolution's calls are not counted separately in the step budgets (`step-budgets` is not implemented).

## Slices 2 to 4 (T-08 to T-16)

### 1. Boundary and layering

Intents, contracts, `meets`, `mustWait` and the negotiation decider contract are pure and live in `@indaba/core`; the forks, the landing lock, the intent call, the negotiation and the resolution are in `@indaba/engine` (`engine/coordination.ts`, `engine/resolution.ts`, `workflow-engine.ts`). The views read spans through the reducer (`view.ts`); the TUI and web render what the contract carries (`StepView.waitingFor`). A plugin supplies the decider through `PluginHost`, with no privileged path for the built-in one. `architecture.test.ts` and the three `layers.test.ts` files pass inside `pnpm qa`.

### 2. Determinism and failure isolation

The decisions (`admit`, `meets`, `mustWait`, the default decider) are pure and tested with fixed inputs. What is not reproducible is which step finishes first; landings follow the order the pool observes (C-04) and the tests use fake runners whose order they control. A step's failure aborts and awaits the others before teardown (AC-27); a retry aborts the running descendants it resets (AC-28); a cancel aborts every step (AC-29): each has a test with two steps running. The resolution keeps the retry budget isolated: it does not use `max_retries`, and its prompt carries only the conflict and the two steps' goals, intents and contracts.

### 3. Public surface and semver

Minor, as classified in `api-surface.md` and its amendments. Additive: `Intent`, `Contract`, `NegotiationDecider`, `PluginHost.registerNegotiationDecider`, `StepExecutor.intent`, `StepView.waitingFor`, the span owner kind `wait`. **Breaking, labelled in the changelog:** `PluginHost` gains a method (hosts written elsewhere must add it) and `BoardKind` gains two members. New spans: `indaba.step.wait`, `indaba.resolution`. The default limit is 1, so a run without the option takes the same path as before, with one more pair of root attributes. `PARALLEL_STEP_CAP` and `maxParallelCap` were added and removed within the unreleased series.

### 4. Security

Agent text that becomes data is bounded, cleaned and confined to relative paths before use (`parseIntent`, `parseContract`); the landing applies a diff with an argument array under the workspace lock; the resolution prompt marks every foreign line with `| ` as untrusted data and the paths read from a diff skip quoted and `..` forms. No shell string, no process built from agent text. `node scripts/security-audit.mjs --source`: no findings (it did stop one commit, over a `RegExp.exec` read as process execution; the call was replaced).

### 5. Observability and honest numbers

Admission, wait, resolution and landing leave spans (`indaba.step.wait`, `indaba.resolution` with its outcome), and the root span carries the limit and where it came from. The views show running and waiting steps. Gaps, not hidden: the structured log records of AC-33 are not written (the engine has no logger), the landing has no span of its own, and the intent and negotiation spans hang from the root, not the step. Cost of the extra calls is counted in the usual span usage; the resolution's calls are not separate in budgets (`step-budgets` does not exist).

### 6. Dependencies and packaging

No dependency added in slices 2 to 4. `pnpm build` and `pnpm smoke`: 6 packages packed and audited; `indaba 0.1.0-alpha.5` carries `@indaba/tui`, boots without `@indaba/server`, and the installed server finds its page.

### 7. Verification

```
pnpm qa: exit 0. Biome: Checked 429 files, no fixes. Vitest: 175 files passed, 3158 tests passed, 2 skipped.
         Coverage: statements 96.78, branches 92.05, functions 96.56, lines 97.02
node scripts/check-workflow.mjs, security-audit --source, validate-skills, sync-claude-skills --check, sync-agent-docs --check, build-site --check: all exit 0
pnpm build, pnpm smoke: exit 0 (see section 6)
pnpm e2e: 13 files passed, 1 skipped; 37 tests passed, 1 skipped
```

**Not verified.** No live run with a real agent CLI and steps that collide: every test of forks, negotiation and resolution uses a real temporary git repository and fake runners, so the prompts have never been answered by a model here. The effect of a real agent's habits (long intents, ignoring the line format) is unknown. AC-21 (review before landing) is not implemented. The web view has no run board. `indaba ui --parallel` and the Settings screens (AC-01, AC-04) are not done.
