---
name: performance
description: Use when a run is slow or uses too much memory, when handling long agent output or streams, when spawning processes or worktrees, or when adding spans. Covers measuring first and the real costs in an orchestrator.
---

# Performance & Resource Specialist

An orchestrator is mostly waiting. The costs that hurt are memory on long streams, leaked processes
and worktrees, and telemetry volume. Rules are in `.agents/rules/performance.md`.

## Measure first

Reproduce with realistic input: a 200 KB transcript, a 50-step workflow, a 30 minute SSE stream.
Record numbers in `research.md`: peak memory (`process.memoryUsage().rss`, or `--heap-prof` for the
heap), wall time (`performance.now()` in a script, never in decision logic), process and worktree
counts at the end. A change with no number is a refactor.

Run it where it will run, and say which OS: process spawning, tree kill and filesystem speed differ
between Windows, macOS and Linux, and CI runs all three.

## Where the cost usually is

1. **A slow or verbose agent.** The answer is a smaller prompt, a stricter timeout or a cheaper model
   in the workflow, not engine tuning.
2. **Buffering.** Reading all output into one string, concatenating SSE chunks, copying a large diff
   through several layers. Stream, keep a bounded tail, hand around a path or a stream. `string +=`
   in a hot loop over a long stream is quadratic in the worst case; collect chunks and join once, and
   only where the full text is needed.
3. **Leaks.** A child process not killed on an exception, timeout or abort path, a worktree left
   after a failed run, a listener or timer never cleared. Count processes and worktrees after a
   deliberately failed run. On Windows the whole tree needs `taskkill /T`, not only the child.
4. **Git.** `git worktree add` on a large repository is the heaviest routine operation; do not create
   one per step when one per task variant is the contract.
5. **Telemetry.** A span or attribute per chunk. Aggregate.
6. **The event loop.** Synchronous file or crypto work in the middle of a stream stalls every other
   run in the same process.

## Not here

The DAG sort and state machine are microseconds. Do not optimise them. Do not add caching without a
measured need; a cache is shared mutable state in a deterministic engine. Do not parallelise steps:
sequential, declaration-ordered execution is the determinism contract.

## Backpressure and bounds

Every loop has a bound: retries, debate rounds, messages, output bytes retained, stream duration.
Every bound is configuration with a default stated in `api-surface.md`.

## Reporting

State the case, the numbers before and after, and the method. "Feels faster" is not a result.
