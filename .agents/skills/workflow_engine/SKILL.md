---
name: workflow_engine
description: Use when changing the workflow parser, DAG ordering, the step state machine, guards, on_failure and retry handling, or anything that decides what the engine runs next. Covers validation at parse time, determinism and retry-loop isolation.
---

# Workflow Engine Specialist

The engine turns a workflow file into an ordered, observable, repeatable run. It is the part of
Indaba that must never surprise. The model, DAG and state machine are pure domain in
`@indaba/core`; the parser, guards and engine loop are in `@indaba/engine`.

## Parse and validate before running

`WorkflowParser` and `parseWorkflow` (packages/engine/src/parser) read YAML with the `yaml` package
and produce the `WorkflowDefinition` model from core. Everything that can be wrong without running a
step is rejected there, as one `WorkflowValidationError` whose `problems` list every issue, naming the
step and the field (the messages are those of the original `ErrorBag`):

- unknown `depends_on` target, duplicate step id, a dependency cycle;
- a role that is not declared, a runner the registry does not know, a step with neither role nor
  runner;
- a guard `type` the `GuardRegistry` it was given does not know (a plugin's type is valid once
  registered);
- an `on_failure.target` that is not an ancestor of the failing step, a negative `max_retries`;
- an artifact placeholder (`${{ artifacts.x }}`) that does not resolve.

Parse with the `core` schema, one document, unique keys, and treat a warning (an unknown tag) as
fatal. The file is data, never code.

## The DAG

`DagBuilder.build(def)` produces a topological order. Ties (steps that become ready together) break
by declaration order, so two runs of the same file take the same order. Never iterate a `Set` or an
object's keys to choose what runs next without a defined order.

## The state machine

`StepStatus` is a const object with `PENDING, RUNNING, VALIDATING, FAILED, ESCALATED, COMPLETED`.
`StepState` owns the legal transitions (`canTransition`) and throws `InvalidTransitionError` for the
rest: `PENDING -> RUNNING -> VALIDATING -> COMPLETED`; `RUNNING|VALIDATING -> FAILED|ESCALATED`;
`FAILED -> PENDING` (a retry, counted) or `FAILED -> ESCALATED`; `COMPLETED -> PENDING` only when an
upstream retry re-runs it. `ESCALATED` is terminal. Test every cell of the table.

## Guards decide, the engine acts

A guard (`git_diff_empty` on `src/` during an RFC step, a plugin's own check) implements core's
`Guard`: `check(def, workdir): Promise<GuardResult>` returning `GuardResult.pass()` or
`GuardResult.fail(message)`. The engine moves the state. Guards run in `VALIDATING`, after the step
produced its outputs, and a failed guard is a failed step. A guard's paths are confined to the
workspace root.

## Retry-loop isolation

`on_failure: retry_step` with `target` and `max_retries`. The invariant that matters:

- the next attempt's prompt receives **only the last failure** (the isolated stderr or failing
  assertion), never the history of earlier failures (`PromptBuilder` takes one failure, not a list);
- the count is bounded, and exhaustion ends in the declared escalation rather than another loop;
- the previous attempt's workspace is reset or replaced, so a failed attempt's half-applied edits do
  not leak into the next.

Accumulating failure history makes prompts grow until the model drifts, and it makes runs
unrepeatable. This is tested, not trusted.

## Determinism

The engine takes a `Clock` and an `IdGenerator`. No `Date.now()`, `Math.random()` or `process.env` in
`packages/core/src` or `packages/engine/src`, apart from the three edge files (`git.ts`, `system.ts`,
`jsonl-span-exporter.ts`); `scripts/security-audit.mjs` and `packages/engine/test/layers.test.ts`
fail it. A run replayed with the same scripted runner outputs produces the same ordered transitions,
and the engine tests assert exactly that. Everything is `await`ed in sequence: no parallel steps.

## Cancellation and teardown

`WorkflowEngine.run(def, { signal })` passes the `AbortSignal` to runners. Worktrees and processes the
run created are removed in `finally` on completion, failure and cancellation alike.

## Results

`WorkflowResult` is a plain value: final status, per-step outcomes and attempts, artifacts, usage. The
CLI renders it; nothing parses the CLI's output.
