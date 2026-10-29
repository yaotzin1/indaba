# @indaba/engine

The engine of [Indaba](https://github.com/yaotzin1/indaba): it parses and validates workflow files, orders their steps as a graph, runs them with
guards, retries and debates, isolates steps in git worktrees, and writes the trace of each run.

```bash
npm install @indaba/engine@next
```

## What is in it

- **Parsing and validation:** a workflow file becomes a checked model, with errors that point at the field
  (`$.steps[1].isolation "copy" is not supported`). `workflowJsonSchema` and `catalogOf` serve editors.
- **Running:** `WorkflowEngine` runs the steps in order and decides what runs next, deterministically. It retries a
  step with only the last failure, and runs a debate until the agents agree or an arbiter rules.
- **Guards:** `GitDiffEmptyGuard` and `DiffWithinScopeGuard`, in a `GuardRegistry` plugins can add to.
- **Workspaces:** one git worktree per task, with its changes kept as a patch and the worktree always removed.
- **Tracing and logs:** OpenTelemetry GenAI spans with tokens and cost, written as JSON lines, and a file log sink.

## Most people want `indaba` instead

The [`indaba`](https://www.npmjs.com/package/indaba) package wires this engine to the runners and plugins for you,
on the command line or with `createEngine` in code. Use this package directly when you compose your own.

The format the engine runs is in [Workflow format](https://yaotzin1.github.io/indaba/workflow-format.html).

## Links

- Documentation: https://yaotzin1.github.io/indaba/
- Source, issues and changelog: https://github.com/yaotzin1/indaba

## Built by

Built by [APSW Labs](https://apswlabs.com) — creators of [Gridwright](https://github.com/yaotzin1/apsw-gridwright) (React data grid).

## Licence

MIT
