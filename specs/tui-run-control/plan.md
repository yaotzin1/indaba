# Plan: tui-run-control

> Stage 3. The contract is `api-surface.md`; the decisions are `spec.md` section 9 (an Indaba debate).

Pure first, Ink last, the way `tui-home` did.

1. `@indaba/engine`: re-export the wire types (types only).
2. `@indaba/cli`: `createRunControl().detach()`; the age rule of the sweep; `home-control.ts` (the adapter that redacts and satisfies the port); `runHome` passes `runs` and detaches on quit.
3. `@indaba/tui`, pure: `run-flow.ts` (the reducer: every transition returns the next state and the one effect to run), `run-flow-screen.ts` (a `Screen` for each state), the new keys and the new events of `home-state.ts`.
4. `@indaba/tui`, Ink: `home-app.ts` runs the effects (list, start, poll, stop, stopAll), owns the timers and disposes them, and opens the started run as one this screen started.
5. Docs, changelog, dependency map, `review.md`.

## Test layers

| Layer | Where | Covers |
| :--- | :--- | :--- |
| pure | `run-flow.test.ts`, `run-flow-screen.test.ts`, `home-state.test.ts` | every transition, double Enter, filter bound and sanitising, the code-to-screen table, a changed hash, `tooMany`, a start lost, a timeout (polls), stop outcomes |
| fake terminal | `home-run-control.test.ts` | the whole flow with a fake control and fake timers, polling disposed on leaving, Ctrl+C during `starting`, quit asks `d` `c` `n`, `stopAll` throwing, no control means no `n` |
| cli | `run-control-detach.test.ts`, `home-control.test.ts` | `detach` releases and never stops, is idempotent, the sweep age, the adapter redacts, `UiRunControl` satisfies the port |
| layers | `home-layers.test.ts` | the new pure files import neither Ink nor `node:` |

## Risks

- `startStatus` polling needs a clock the tests can drive: the component takes `pollMs` from its props (default 500 ms) and a maximum number of polls.
- Quitting while a start is pending cannot be undone by `detach` (the child may not exist yet), so it is refused, not queued.
