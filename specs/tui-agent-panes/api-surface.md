# API surface: tui-agent-panes (slice 3a)

> **Status**: stage 3, the contract implementation is written against (`spec.md` section 8). Slice 3b is not specified here.
> **Semver impact**: minor below 1.0. Additions to `@indaba/tui`; no default changes: with no running step and without the new keys, the dashboard draws what it drew.

## Surface

| Surface | Name | Change |
| :--- | :--- | :--- |
| `@indaba/tui` | `panesFor`, `paneBlockRows`, `runningIds`, `stepCost`, `PaneSpec` | new exports (pure) |
| `@indaba/tui` | `paneRowsFor`, `PANE_ROWS` | new exports of `layout.ts` |
| `@indaba/tui` | `UiState.panel`, `.reasoningScroll`, `.pane`, `.paneOffset`, `.enlarged`, `.notice` | new members of an exported interface |
| `@indaba/tui` | `UiContext.reasoningLines`, `.panes` | new members (optional, so a caller that builds a context keeps compiling) |
| `@indaba/tui` | `Layout.paneRows`, `Layout.paneCap`; `computeLayout(..., { panes })` | new member, new option with a default of 0 |
| `@indaba/tui` | `Screen.panes`, `Screen.reasoningLines` | new **optional** members (other screens build a `Screen` too) |
| `@indaba/tui` | keys `r` `o` `[` `]` `z` `Enter` in the dashboard | new keys |
| `@indaba/tui` | `reasoningLinesOf`, `shownStep` | new exports of `screen.ts` |

## Types

```ts
export interface PaneSpec {
  readonly stepId: string;
  readonly glyph: string;        // from stepMark, ASCII under ascii
  readonly word: string;         // "running"
  readonly tone: Tone;
  readonly title: string;        // "● running  build  attempt 2  $0.12+"
  readonly tail: readonly string[]; // sanitised, wrapped, at most 3 rows; "(no data yet)" when empty
  readonly focused: boolean;
}

/** One line of cost for a step: `$0.1234`, `$0.1234+` when only some agents were priced, `cost unknown` when none was; empty when the step ran no agent. */
export function stepCost(step: StepView): string;
/** In `layout.ts`. Rows the block of panes takes: min(floor(detailRows / 3), running * 4) in whole panes of four, and 0 when that is under 4. */
export function paneRowsFor(detailRows: number, running: number): number;
/** The panes that fit, in run order, from `offset`; `hidden` counts those that did not. */
export function panesFor(run: RunState, input: { rows: number; width: number; focus: string | undefined; offset: number; ascii: boolean }): { panes: readonly PaneSpec[]; hidden: number; running: number };

export interface UiState {
  // existing members unchanged, plus:
  readonly panel: 'output' | 'reasoning';
  readonly reasoningScroll: number;
  /** The id of the focused pane's step. */
  readonly pane: string | undefined;
  readonly paneOffset: number;
  readonly enlarged: boolean;
  /** One fixed line of news (the enlarged step is no longer running); it goes with the next key. */
  readonly notice: string | undefined;
}
```

## Checks

- [x] No change in `@indaba/core` or `@indaba/engine` (the view model has everything: `thoughts`, `consensus`, `runners[].costUsd`)
- [x] `initialUi()` gives the same behaviour as before for every existing key
- [x] Every type in a new public signature is public or marked `@internal`
