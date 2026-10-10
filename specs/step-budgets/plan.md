# Plan: Budgets

Where each piece goes, and the design points that are easy to get wrong. The contract is in
[`api-surface.md`](api-surface.md); the telemetry in [`events.md`](events.md); the resume file in
[`data-model.md`](data-model.md).

## Files

| Package | Files | Change |
| :--- | :--- | :--- |
| `@indaba/core` | `src/workflow/model.ts` | `budget`, `meteringPolicy` on `StepDefinition`; `budget`, `defaultBudget`, `defaultMeteringPolicy` on `WorkflowDefinition`; `BudgetLimit`, `MeteringPolicy` |
| `@indaba/core` | `src/workflow/budget.ts` (new) | `Budget`, `UsageObservation`, `BudgetVerdict`, `BudgetGrant`, `BudgetMeter`, `CallMeter`, `BudgetTotals`; no `node:` import |
| `@indaba/core` | `src/workflow/state.ts` | `StepState.restore` |
| `@indaba/core` | `src/metering/index.ts` (new) | `Metering`, `MeteringReport`, `UsageReporter`, `isMetering`, `MeteringNotDeclaredError` |
| `@indaba/core` | `src/runner/index.ts` | `RunRequest.onUsage`; `Runner.metering` required; `RunResult.metering` always set (derived) |
| `@indaba/core` | `src/extension/index.ts` | `Adjudicator`, `Guard`, listener options carry `metering`; `PluginHost.registerBudgetResolver`, `usage`; `BudgetResolver`, `BudgetQuestion`, `BudgetDecision`, `MAX_RESUMES_PER_STEP` |
| `@indaba/core` | `src/observability/index.ts`, `src/index.ts`, `src/testing.ts` (new) | `BudgetExceeded`, `BudgetResolved`; exports; `checkMeteringContract` behind an `exports` subpath |
| `@indaba/engine` | `src/parser/parser.ts`, `src/parser/validator.ts` | read and validate `budget` (top, `defaults`, step) and `metering_policy`; shell-step error; `warnings(workflow, meteringOf?)` and `meteringErrors` |
| `@indaba/engine` | `src/engine/budget-gate.ts` (new) | `BudgetGate`: owns the `BudgetMeter`, the resolver, resume counts and the one-call grants; `before`, `observe`, `settle` |
| `@indaba/engine` | `src/engine/step-executor.ts` | `invoke` consults the gate; own `AbortController`; repeats the call on a resume; reports unmetered, estimated and gap sources |
| `@indaba/engine` | `src/engine/workflow-engine.ts`, `src/engine/outcome.ts` | build the gate from the workflow and `runBudget`; spend attributes; `WorkflowResult.spend` and `.resume`; a stop that keeps work skips teardown and writes the resume file; the resume start |
| `@indaba/engine` | `src/engine/resume.ts` (new), `src/workspace/*` | `ResumeStore`, `definitionDigest`, `WorkspaceManager.adopt` and `keep` |
| `@indaba/runners` | every runner, `src/acp-runner.ts`, `src/openrouter-runner.ts` | declare `metering`; ACP and OpenAI-compatible call `onUsage`; the CLI runners declare `unmetered` |
| `indaba` | `src/main.ts`, `src/engine-factory.ts`, `src/plugin-host.ts`, `src/printable.ts`, `src/prompt.ts` | `--max-cost`, `--max-tokens`, `--resume`; `RegistryPluginHost` refuses undeclared extensions; the terminal resolver beside the arbiter's; the spend and resume report |
| docs | `docs/workflow-format.md`, `docs/extending.md`, `docs/using-the-alpha.md`, `docs/getting-started.md`, `README.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`, `examples/*.yml` | fields, policy, the obligation and how to meet it, migration, breaking heading |

## Design points

**1. A stop is neither a cancel nor a failure.** Today a failed outcome becomes `cancelled` when
`options.signal.aborted` is true. A budget stop must abort the in-flight call without making the user's signal
look aborted. `invoke` creates its own `AbortController` per call, linked to the caller's signal (a listener
that aborts it, removed when the call ends), and hands that signal to the runner. A tripped cap aborts the
controller, never the caller's signal. If the caller's signal was aborted too, the cancel wins.

**2. Ask inside the call.** `invoke` is a loop: `before()` → run the call → `observe` → on a verdict `exceeded`,
abort, `await gate.settle(...)`. A `resume` repeats the same call with the fixed note appended to the prompt;
the debate's blackboard, the retry map in `WorkflowEngine.run` and any verdict iteration are untouched because
nothing above `invoke` ever sees the stop. `stop` and `unanswered` throw a `BudgetStop` (an `IndabaError`) that
`StepExecutor.run` turns into `StepOutcome.escalated(reason)` carrying `keep: true | false`. Because the outcome
is `escalated`, `retry_step` never retries it. The step stays `RUNNING` throughout, so `StepState` needs no new
transition; only a later `--resume` needs `StepState.restore`.

**3. Keep or tear down.** `WorkflowEngine.run` tears the workspace down in its `finally`. A `keep` outcome sets
a flag that makes it call `workspaces.keep(workspace)` instead of `destroy()`, record the relative path in the
result and write the `ResumeFile`; every other ending is unchanged. `adopt` is the inverse: it checks, with the
same confinement as `resolvePath` (realpath, no symlink out), that the directory is a worktree of this
repository under `.indaba/worktrees/<taskId>`, and hands the engine a `Workspace` it will tear down normally at
the end of the resumed run.

**4. Resume start.** With `options.resume`, the engine builds its `StepState`s from the file (`restore`),
the meter from `budget` (`restore`), the retry map from `counters`, `isolated` from the file, then enters the
loop at `stoppedStepId`. Finished steps are not run again. The stopped step's first `before()` finds its cap
still reached and asks the question. Nothing is trusted from the file without a check: version, digest, step ids
and paths (data-model.md).

**5. The metering obligation lives at registration.** `RegistryPluginHost` validates `metering` with
`isMetering` and throws `MeteringNotDeclaredError` per registration; the plugin loader reports it against the
plugin and carries on. Built-ins register through the same calls, so a test that wires a host that refuses
undeclared extensions proves none of them is exempt. `RunResult`'s constructor derives a report when none is
given, so a runner that does not know the new member still produces a valid result; only the *declaration* is
mandatory.

**6. One meter, many sources.** A call's report (`RunResult.metering`, `Ruling.metering`, `GuardResult.metering`,
or `UsageReporter.report`) goes through `CallMeter.end` or `meter.report`, so a cap sees every source. Sources
are named (the runner's name, the adjudicator's, the guard's, the listener's) and carried into `SpendReport`.

**7. The question channel.** `registerBudgetResolver` is called once by the CLI composition root with the terminal
resolver (the same prompt code as the human arbiter) or, after `specs/ruling-channel`, the file resolver, chosen
by `--rulings`; `none` registers nothing. The engine knows only the `BudgetResolver` contract.

## Metering rules in one place

- One `BudgetMeter` per `WorkflowEngine.run`, so a retry keeps the step total and the run total spans everything.
- A call's cost is read after `tracer.recordUsage` and the reported-cost fallback, from the call span's
  `indaba.cost.usd`, so the budget can never disagree with the trace.
- `onUsage` figures are cumulative for the call. `CallMeter` keeps the highest value seen per figure and adds the
  difference, so a final report that repeats the last streamed figure adds nothing twice.
- Variants: the executor passes `share = 1 / N` and the meter scales the step cap for that call only.
- A free source (`shell`, a human arbiter) is never checked against a cap.

## What the plan checks (stage 5)

- No `node:` import in core: the meter, the declarations and the conformance check are arithmetic and checks over
  plain values. The digest (`node:crypto`) and the files are in the engine, where the ledger already is.
- No clock, randomness or environment in decision logic: the resume file's timestamp comes from the injected
  clock, ids from the injected generator, flags in the CLI composition root only.
- No unbounded loop or buffer: at most `MAX_RESUMES_PER_STEP` resumes per step; the meter keeps a fixed set of
  numbers per step and per call; sources are keyed by name and reason.
- Untrusted data: runner and plugin figures filtered in `observe`; reasons cleaned and cut; the answer parsed and
  range-checked; the resume file's paths resolved and confined before use; the `taskId` validated before any path.
- Secrets: the question, the events and the resume file carry numbers and ids; feedback is redacted.
- A new runtime dependency: none.
- The one deliberate break with "torn down however the run ends" is flagged in `events.md` and the review.
- The metering obligation is breaking; `api-surface.md` classifies it and records the alternative.
