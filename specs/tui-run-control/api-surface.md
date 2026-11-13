# API surface: tui-run-control

> **Status**: stage 3, the contract implementation is written against (design settled by an Indaba debate, `spec.md` section 9).
> **Semver impact**: minor below 1.0. Everything is new and optional; without a control Home is exactly what `tui-home` shipped.

## Surface

| Surface | Name | Change |
| :--- | :--- | :--- |
| `@indaba/engine` | re-exports of the wire types `WorkflowSummary`, `WorkflowListResponse`, `StartRunRequest`, `StartRunResponse`, `StartStatusResponse`, `StopRunResponse`, `RunSummaryOfUse`, `FullAccessStep` | new (types only; the logging precedent) |
| `@indaba/tui` | `HomeOptions.runs?: RunControlPort` | new, optional |
| `@indaba/tui` | `RunControlPort`, `FlowState`, `reduceFlow`, `buildFlowScreen`, `isRunControlError` and their types | new exports |
| `indaba` (internal) | `UiRunControl.detach?()`, `TuiHomeOptions.runs?` | new, optional |
| `indaba` (internal) | `createRunControl(...).detach()` | new method: releases live children, stops none |
| `indaba` (internal) | the sweep of `.indaba/run-inputs` | changed: removes only copies older than `RUN_INPUT_MAX_AGE_MS` (default: more than the start timeout) |

## `@indaba/tui`

```ts
export interface RunControlPort {
  list(): Promise<WorkflowListResponse>;
  start(request: StartRunRequest): Promise<StartRunResponse>;
  startStatus(startId: string): StartStatusResponse | undefined;
  stop(runId: string): StopRunResponse | undefined;
  isAlive(runId: string): boolean;
  /** Lets every live run carry on without this screen; stops none. Idempotent. */
  detach(): void;
  /** Stops every live run and waits for them. May reject. */
  stopAll(): Promise<void>;
}

/** A refusal of the control: an Error named RunControlError with a string `code` and optional `detail`. */
export function isRunControlError(error: unknown): error is Error & { code: string; detail?: Readonly<Record<string, unknown>> };

export type FlowState =
  | { kind: 'picking'; loading: boolean; workflows: readonly WorkflowSummary[]; truncated: boolean; error: string | undefined;
      filter: string; editing: boolean; showHidden: boolean; selected: number }
  | { kind: 'requesting'; workflowId: string; name: string }
  | { kind: 'confirming'; workflowId: string; name: string; hash: string; use: RunSummaryOfUse; changed: boolean }
  | { kind: 'fullAccess'; workflowId: string; name: string; hash: string; steps: readonly FullAccessStep[]; changed: boolean }
  | { kind: 'starting'; startId: string; name: string; polls: number }
  | { kind: 'failed'; message: string }
  | { kind: 'stopConfirm'; runId: string }
  | { kind: 'stopping'; runId: string; polls: number };
// each state also carries `seq` and `effect` (what the component must do next, once per `seq`)

export function reduceFlow(state: FlowState, event: FlowEvent, context: FlowContext): FlowStep;
export function buildFlowScreen(state: FlowState, layout: Layout, options: { ascii: boolean }): Screen;
```

`HomeState` gains `flow: FlowState | undefined`, `owned: readonly string[]` (runs started here), `notice: string | undefined`;
`HomeEvent` gains the flow's events and `{ quitFailed: string }`. `KEYS` gains `n` (new run, only with `runs`) and `s` (stop, only with `runs`).

## `indaba`

`runHome` builds the control with `uiBackendsFor(...).runControl([io.cwd])` when `io.startRun` exists, wraps it in an adapter that replaces
credentials in every string it returns or throws, and passes it as `runs`. After `run` returns, a quit of kind `detach` or `close` calls
`detach()` (idempotent); a quit of kind `cancel` has already awaited `stopAll()`.

## Checks

- [x] Without `runs`, `n` and `s` are absent from the key line and from `?`
- [x] `@indaba/tui` imports no CLI module, and `RunControlPort` stays structurally satisfiable by `UiRunControl` plus `detach` (a CLI test assigns one to the other)
- [x] Every type in a new public signature is public or marked `@internal`
