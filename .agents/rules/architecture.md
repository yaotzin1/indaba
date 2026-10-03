# Architecture Rules

Binding. Elaborates `workflow.ai.yml`; where the two disagree, the YAML wins.

## 1. The boundary

The **pure domain** is `src/Core`, `src/Workflow/Model`, `src/Workflow/Graph`, `src/Workflow/State`
and `src/Mesh`. It imports no Symfony class and no class from infrastructure. It may use the PHP
standard library, `Psr\Clock\ClockInterface` and its own namespaces. `tests/Unit/Architecture/`
scans the tokens of those directories and fails on a violation. An exception is not granted: the
change belongs in infrastructure, behind an interface the domain owns.

## 2. Layers, one direction

```
src/Core                exceptions, small shared types, interfaces the rest depend on
src/Workflow/Model      WorkflowDefinition, StepDefinition, RoleDefinition, GuardDefinition, OnFailure
src/Workflow/Graph      DagBuilder: topological order, cycle detection, tie-breaking
src/Workflow/State      StepStatus, StepState, the legal transitions
src/Mesh                AgentMessage, MessageType, Blackboard, ConsensusArbiter, PingPongDetector
                        ----- everything above is pure domain -----
src/Workflow/Parser     WorkflowParser (symfony/yaml in, Model out)
src/Workflow/Guard      guard evaluators (git diff, command exit code, file checks)
src/Workflow/Engine     WorkflowEngine, WorkflowResult: the loop that ties the rest together
src/Runners             RunnerInterface and its implementations, RunnerRegistry, SseParser
src/Workspace           Git, GitWorktreeManager
src/Observability       Tracer, Span, TokenUsage, PricingTable, event bridge
src/Console             Symfony Console commands, the composition root
```

Imports point one way, toward the domain. `src/Core` importing from `src/Runners` is a defect, not a
shortcut. Only `src/Console` (the composition root) and `RunnerRegistry` may name a concrete runner.

## 3. Where a behaviour belongs

1. A rule about what is legal (a transition, a quorum, a cycle) is domain.
2. Anything that touches the outside world (a process, a socket, git, a file, the clock, the
   environment) is infrastructure, reached through an interface the domain or the engine owns.
3. Presentation (tables, colours, SSE framing for a terminal) is `src/Console`.

## 4. Engine invariants

- **A step has one state at a time**, and only the transitions in `Workflow/State` are legal. An
  illegal transition throws `InvalidTransitionException`; it is never coerced.
- **The DAG is validated before anything runs.** Unknown `depends_on`, a cycle, a missing role or
  runner are `WorkflowValidationException`s at parse time, not failures at step nine.
- **Retries are bounded and isolated** (see `workflow.ai.yml`). A retry carries the last failure
  only.
- **A guard decides, it does not act.** It returns a verdict; the engine changes state.
- **The engine owns teardown.** Whatever a run created (worktrees, processes) is removed on
  completion, failure and cancellation alike.
- **Cancellation is cooperative and prompt.** A runner checks its `RunRequest` deadline and stops
  its child; nothing waits forever.

## 5. The clock, randomness and the environment are injected

Decision logic takes a `Psr\Clock\ClockInterface` (`symfony/clock` provides one, and a `MockClock`
for tests), an id generator and its configuration as constructor arguments. Reading `time()`,
`random_int()` or `getenv()` there is a defect, and `scripts/security-audit.mjs` fails it.

## 6. Failure is a value where the caller must decide, an exception where it cannot

A runner that ran and failed returns a `RunResult` with a non-zero exit code: data the engine's
`on_failure` consumes. A runner that could not run (binary missing, connection refused) throws
`RunnerException`. Exceptions are not expected control flow, and a result is not for a programming
error.

## 7. Dependencies

`composer.json` `require` lists exactly `project.runtime_dependencies` in `workflow.ai.yml`. Adding
one needs a recorded decision in the feature's spec and a change to that list; a Symfony component
joins the others on one constraint. The supply-chain checks are in
`.agents/skills/security_guard/SKILL.md`.
