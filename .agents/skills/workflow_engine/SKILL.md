---
name: workflow_engine
description: Use when changing the workflow parser, DAG ordering, the step state machine, guards, on_failure and retry handling, or anything that decides what the engine runs next. Covers validation at parse time, determinism and retry-loop isolation.
---

# Workflow Engine Specialist

The engine turns a workflow file into an ordered, observable, repeatable run. It is the part of
Indaba that must never surprise.

## Parse and validate before running

`Workflow\Parser\WorkflowParser` reads YAML with `symfony/yaml` and produces `Workflow\Model`
objects. Everything that can be wrong without running a step is rejected there, as a
`WorkflowValidationException` naming the step and the field:

- unknown `depends_on` target, duplicate step id, a dependency cycle;
- a role that is not declared, a runner the registry does not know, a step with neither role nor
  runner;
- an `on_failure.target` that is not an ancestor of the failing step, a negative `max_retries`;
- an artifact placeholder (`${{ artifacts.x }}`) that does not resolve.

Parse YAML with `Yaml::parse` and no object or constant flags. The file is data, never code.

## The DAG

`Graph\DagBuilder` produces a topological order. Ties (steps that become ready together) break by
declaration order, so two runs of the same file take the same order. Never iterate a hash map to
choose what runs next; PHP arrays are ordered but sets built from keys are an easy way to lose the
intent.

## The state machine

`Workflow\State\StepStatus` has `PENDING, RUNNING, VALIDATING, FAILED, ESCALATED, COMPLETED`.
`StepState` owns the legal transitions and throws `InvalidTransitionException` for the rest.
Sketch of the intent: `PENDING -> RUNNING -> VALIDATING -> COMPLETED`; `RUNNING|VALIDATING ->
FAILED`; `FAILED -> PENDING` (a retry, counted) or `FAILED -> ESCALATED`. `COMPLETED` and
`ESCALATED` are terminal. Write the table in `data-model.md` and test every cell.

## Guards decide, the engine acts

A guard (`git_diff_empty` on `src/` during an RFC step, an exit code, a file that must exist)
returns a verdict with a reason. The engine moves the state. Guards run in `VALIDATING`, after the
step produced its outputs, and a failed guard is a failed step.

## Retry-loop isolation

`on_failure: retry_step` with `target` and `max_retries`. The invariant that matters:

- the next attempt's prompt receives **only the last failure** (the isolated stderr or failing
  assertion), never the history of earlier failures;
- the count is bounded, and exhaustion ends in the declared escalation rather than another loop;
- the previous attempt's workspace is reset or replaced, so a failed attempt's half-applied edits do
  not leak into the next.

Accumulating failure history makes prompts grow until the model drifts, and it makes runs
unrepeatable. This is tested, not trusted.

## Determinism

The engine takes a `Psr\Clock\ClockInterface` and an id generator. No `time()`, no `random_int()`, no
`getenv()` in this module. A run replayed with the same scripted runner outputs produces the same
ordered transitions, and the engine tests assert exactly that.

## Results

`WorkflowResult` is a value object: final status, per-step states and attempts, artifacts, usage.
The console renders it; nothing parses the console's output.
