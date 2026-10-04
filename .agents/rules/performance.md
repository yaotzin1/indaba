# Performance Rules

Binding. Indaba spends nearly all of its time waiting on child processes and HTTP streams, so the
costs that matter are memory, process lifetime and trace volume, not CPU in the engine.

## 1. Measure before restructuring

A performance change carries a number, recorded in the feature's `research.md`, from a realistic
case (a 200 KB agent transcript, a 50-step workflow, a 30 minute stream). A change with no number is
a refactor and is classified as one.

## 2. Stream, do not buffer

A runner forwards output as it arrives (`onOutput`, the tracer, listeners) and keeps a bounded tail
for the `RunResult`. Reading a whole transcript into one string before parsing it, or concatenating
an SSE stream in a loop, is how a long reasoning run exhausts memory.

## 3. Processes and worktrees have owners and deadlines

Every spawned child is stopped, with its whole process tree, on timeout, abort and exception
(`try`/`finally`). Every worktree a manager creates is removed by the same manager. A leaked child
or worktree outlives the run and is a defect, however fast the happy path is.

## 4. The DAG is computed once

`DagBuilder.build()` runs when a workflow is loaded. The engine does not re-sort per step, and
nothing in the hot loop re-parses YAML or re-resolves a role.

## 5. Trace volume is a budget

A span per step and per call is the contract. A span per streamed chunk is not: chunks are
aggregated or sampled, and attributes carry sizes, not payloads. A prompt or a diff in an attribute
is a security question before it is a performance one.

## 6. Do not publish state that did not change

Every state change is an event listeners react to, and a console redraws on it. A transition to the
state a step is already in is a no-op that emits nothing.

## 7. Do not block the event loop

Runners and the engine are `async`; a synchronous file or process call in the hot path stalls every
other stream in the same process. Steps still run in sequence, which is a determinism choice, not a
reason to block.

## 8. Say no to the wrong fix

A slow run is usually a slow agent or a prompt that is too large. The answer is a smaller prompt, a
tighter timeout, or a cheaper model in the workflow file, not micro-optimising the loop around it.
