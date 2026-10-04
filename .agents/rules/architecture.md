# Architecture Rules

Binding. Elaborates `workflow.ai.yml`; where the two disagree, the YAML wins.

## 1. The boundary

The **pure domain** is `packages/core/src`. It imports no `node:` module, no third-party package and
no other Indaba package: only its own relative modules. That is what lets `@indaba/core` run in a
browser as well as in Node, and what lets a desktop app, a web app and a CLI share one engine
vocabulary. `packages/core/test/architecture.test.ts` scans every import in the package and fails on
a violation. An exception is not granted: the change belongs in infrastructure, behind an interface
the domain owns.

## 2. Layers, one direction

```
packages/core/src
  errors/          IndabaError and its subclasses
  workflow/        the model types, DagBuilder (topological order, cycle detection, ties by
                   declaration order), StepState and the legal transitions
  mesh/            AgentMessage, Blackboard, ConsensusArbiter, PingPongDetector, RunnerParticipant
  runner/          the Runner contract, RunRequest, RunResult
  extension/       Guard, GuardResult, Plugin, PluginHost, the MCP capability contracts
  observability/   Tracer, Span, TokenUsage, PricingTable, SpanStarted and SpanEnded
  support/         Clock, IdGenerator, EventDispatcher, SimpleEventDispatcher
                   ----- everything above is pure domain -----
packages/engine/src
  parser/          parseWorkflow (yaml in, model out), the validator, the interpolator, ErrorBag
  guard/           GuardRegistry, GitDiffEmptyGuard
  engine/          WorkflowEngine, StepExecutor, PromptBuilder, McpPlanner
  workspace/       Git, GitWorktreeManager, PatchService
  observability/   JsonlSpanExporter, SystemClock, RandomIdGenerator
packages/runners/src   ShellRunner, OpenRouterRunner, SseParser, the agent CLI runners, RunnerRegistry
packages/cli/src       indaba: run, plan, validate, plugin loading, the composition root
```

Imports point one way, toward core: `cli` imports `runners`, `engine` and `core`; `runners` and
`engine` import `core` and never each other; `core` imports nothing. `packages/engine/test/layers.test.ts`
and `packages/runners/test/layers.test.ts` hold engine and runners to it. Only the CLI (the
composition root) names a concrete runner, and it registers the built-ins through the same
`PluginHost` a third party's plugin receives.

## 3. Where a behaviour belongs

1. A rule about what is legal (a transition, a quorum, a cycle) is domain.
2. Anything that touches the outside world (a process, a socket, git, a file, the clock, the
   environment) is infrastructure, reached through an interface the domain or the engine owns.
3. Presentation (tables, colours, argument parsing, exit codes) is `packages/cli`.
4. A contract a third party implements (`Runner`, `Guard`, `Plugin`) is defined in core, so
   extending Indaba never means editing it.

## 4. Engine invariants

- **A step has one state at a time**, and only the transitions in `workflow/state.ts` are legal. An
  illegal transition throws `InvalidTransitionError`; it is never coerced.
- **The DAG is validated before anything runs.** Unknown `depends_on`, a cycle, a missing role or
  runner are `WorkflowValidationError`s at parse time, not failures at step nine.
- **Retries are bounded and isolated** (see `workflow.ai.yml`). A retry carries the last failure
  only.
- **A guard decides, it does not act.** It returns a `GuardResult`; the engine changes state.
- **The engine owns teardown.** Whatever a run created (worktrees, processes) is removed in a
  `finally`, on completion, failure and cancellation alike.
- **Cancellation is cooperative and prompt.** A runner honours the `AbortSignal` and the deadline in
  its `RunRequest` and stops its child; nothing waits forever.

## 5. The clock, randomness and the environment are injected

Decision logic takes a `Clock`, an `IdGenerator` and its configuration as constructor arguments.
Reading `Date.now()`, `Math.random()` or `process.env` under `packages/core/src` or
`packages/engine/src` is a defect, and `scripts/security-audit.mjs` fails it. The engine's edge
files that own those things (`git.ts`, `system.ts`, `jsonl-span-exporter.ts`) are the only
exceptions and are named in the audit.

## 6. Failure is a value where the caller must decide, an exception where it cannot

A runner that ran and failed returns a `RunResult` with a non-zero exit code: data the engine's
`on_failure` consumes. A runner that could not run (binary missing, connection refused) throws
`RunnerError`. Exceptions are not expected control flow, and a result is not for a programming
error.

## 7. Dependencies

The packages' `dependencies` and `optionalDependencies`, apart from links between them, are exactly
`project.runtime_dependencies` and `project.optional_dependencies` in `workflow.ai.yml`
(`yaml`, and optionally `node-pty`). `@indaba/core` has none. Adding one needs a recorded decision in
the feature's spec and a change to that list. The supply-chain checks are in
`.agents/skills/security_guard/SKILL.md`.
