# API surface contract: Running one step

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**A major in practice, shipped as the next minor below 1.0, with the changelog saying so; the rest is additive.**

| Change | Class |
| :--- | :--- |
| `StepState` gains the member `SKIPPED` | **major in practice**: a consumer that switches on it exhaustively stops compiling |
| `RunOptions` gains the optional `only` | minor |
| new CLI options `--step`, `--from`, `--workspace-from`, `--plan` | minor |
| new root-span attributes | minor |
| a full run (no `only`) | no change in behaviour |

## Public symbols added

### `@indaba/core` (pure)

```ts
// StepState gains: Skipped: 'SKIPPED'

export type InputSource =
  | { readonly kind: 'given' }
  | { readonly kind: 'folder'; readonly path: string }          // relative to the project
  | { readonly kind: 'run'; readonly runId: string; readonly finishedAt: string; readonly olderWorkflow: boolean }
  | { readonly kind: 'missing'; readonly producedBy?: string };   // the step id that makes it

export interface SingleStepPlan {
  readonly step: string;
  readonly inputs: readonly { readonly name: string; readonly source: InputSource }[];
  readonly workspace: 'fresh' | { readonly fromRun: string };
  readonly missing: readonly string[];
}

export interface RunOptions {
  // ... existing members unchanged
  readonly only?: { readonly step: string; readonly from?: string; readonly workspaceFrom?: string };
}
```

### `@indaba/engine`

- `planSingleStep(workflow, options, runStore, folder): Promise<SingleStepPlan>` (reads, writes nothing).
- `WorkflowEngine.run` honors `only`.

### `indaba` (CLI)

`indaba run <workflow> --step <id> [--from <runId>] [--workspace-from <runId>] [--input name=value] [--plan]`.

## Span attributes

| Name | Value |
| :--- | :--- |
| `indaba.run.mode` | `full` or `step` |
| `indaba.run.step` | the step id (only in `step` mode) |
| `indaba.run.inputs_from` | run ids joined by comma; never contents |

## Workflow schema

No change.
