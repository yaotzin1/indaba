# Events and attributes: step stalls

> A contract, like `api-surface.md`. Names follow the OpenTelemetry GenAI conventions where one exists and the `indaba.`
> prefix where none does (`specs/observability`).

## Span attributes

On the **step span** (`step <id>`), set only when the field is set on the step:

| Attribute | Type | When | Meaning |
| :--- | :--- | :--- | :--- |
| `indaba.step.timeout_seconds` | int | the step has `timeout_seconds` | the step's own limit |
| `indaba.stall.after_seconds` | int | the step has `stall` | the silence that stops an attempt |
| `indaba.stall.retries` | int | the step has `stall` | the retries allowed |
| `indaba.stall.count` | int | at least one attempt of this execution stalled | how many attempts stalled |

On the **attempt's `invoke_agent` span**, set only when that attempt stalled:

| Attribute | Type | Meaning |
| :--- | :--- | :--- |
| `indaba.stall.silent_seconds` | int | seconds without activity when the attempt was stopped (at least `after_seconds`) |

## Span event

`indaba.step.stalled` on the step span, once per stalled attempt, in order:

| Attribute | Type | Meaning |
| :--- | :--- | :--- |
| `indaba.stall.attempt` | int | the attempt number within this execution, from 1 |
| `indaba.stall.silent_seconds` | int | as above |
| `indaba.stall.retry` | string | `restored` (the worktree was restored and the step runs again), `exhausted` (no retries left) or `restore_failed` |

## Step status reasons

The `step_status` event's `reason` (and so the dashboard, the web view and `indaba report`) carries the fixed strings:

- `Stalled: no activity for N seconds (retry k of n).` on the move from running back to pending for the retry;
- `Stalled: no activity for N seconds.` when the step then fails;
- `The worktree could not be restored after a stall.` when the restore fails.

A timeout keeps today's `Timed out after N seconds.`.

## Ordering

1. The runner stops the attempt and returns `stalled`.
2. The engine records the attempt span as an error, with `indaba.stall.silent_seconds`.
3. The engine restores the worktree.
4. The engine emits `indaba.step.stalled` and moves the step (`reason` as above).
5. The next attempt starts with a new `invoke_agent` span; its prompt carries the stall as the only feedback.

## What is never in an event or attribute

The prompt, the agent's output or messages, a path, an environment variable, a token or a key (AC-19).

## Metrics

None are added. Token usage of a stalled attempt is reported on its `invoke_agent` span like any other attempt, as
`gen_ai.usage.*` already is; nothing is estimated for a stalled call (no invented numbers).
