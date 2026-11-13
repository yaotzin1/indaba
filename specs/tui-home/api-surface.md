# API surface: tui-home

> **Status**: stage 3, the contract implementation is written against (design settled by an Indaba debate, `spec.md` section 9).

## Semver classification

**Minor below 1.0, labelled as a changed default; a major from 1.0.** No export changes incompatibly. What changes is the behaviour of the
command `indaba` with no arguments **on a terminal**: today a usage error (stderr, exit 2), after this a full-screen application.
`AGENTS.md` section 4 classes a changed default or CLI behaviour as a major, and below 1.0 a major takes the next minor and says so.
Without a terminal, or with `INDABA_NO_TUI=1`, the behaviour is byte-for-byte unchanged and `main.test.ts` and `basics.e2e.test.ts` stay as they are.

## Surface

| Surface | Name | Change |
| :--- | :--- | :--- |
| CLI | bare `indaba` | opens the application on a terminal |
| Environment | `INDABA_NO_TUI=1` | keeps today's behaviour (the exact value `1` only) |
| Environment | `INDABA_ASCII=1` | ASCII glyphs in bare `indaba` (no option parser); `NO_COLOR` already applies |
| `@indaba/tui` | `run(options: HomeOptions): Promise<HomeResult>` | new export |
| `@indaba/tui` | `HomeOptions`, `HomeResult`, `HomeRunSource`, `KEYS`, `shippedKeys`, `HomeState`, `reduceHome`, `initialHome`, `buildHomeScreen` | new exports |
| `indaba` (internal) | `TuiModule.run?`, `TuiHomeOptions`, `TuiHomeResult` in `tui-loader.ts` | new, **optional**; the loader never requires `run` |
| `scripts/check-workflow.mjs` | `checkParity` | new (protected file) |

## `@indaba/tui`

```ts
/** The records a run's dashboard follows. Ends when `signal` aborts. */
export interface HomeRunSource {
  readonly source: AsyncIterable<RunRecord>;
  readonly board?: AsyncIterable<BoardFileRecord>;
}

export interface HomeOptions {
  /** The runs of the project, newest first, as `indaba watch` lists them. May reject: Home shows one line and `r` retries. */
  readonly listRuns: () => Promise<readonly RunSummary[]>;
  /** The source of one run; `signal` aborts when the person leaves it. Without it, `Enter` does nothing (and is absent from `?`). */
  readonly openRun?: (runId: string, signal: AbortSignal) => HomeRunSource;
  /** The screen started a run, so quitting asks what to do with it. Default false. */
  readonly attached?: boolean;
  readonly ascii: boolean;
  readonly color: boolean;
  readonly stdout: NodeJS.WritableStream;
  readonly stdin: NodeJS.ReadableStream;
  readonly signal?: AbortSignal;
  readonly logger?: Logger;
}

export interface HomeResult {
  readonly quit: 'close' | 'detach' | 'cancel';
  /** 0 for close and detach, 130 for cancel and for an abort. */
  readonly code: number;
}

export function run(options: HomeOptions): Promise<HomeResult>;
```

Pure parts (no Ink, no `node:`):

```ts
export interface KeyDef {
  readonly id: 'up' | 'down' | 'open' | 'refresh' | 'help' | 'quit';
  readonly keys: string;      // as shown: "j k", "Enter", "r", "?", "q"
  readonly label: string;
  readonly needs?: 'openRun'; // present only when the option is given
}
export const KEYS: readonly KeyDef[];
export function shippedKeys(available: { readonly openRun: boolean }): readonly KeyDef[];

export interface HomeState {
  readonly runs: readonly RunSummary[];
  readonly selected: number;
  readonly loading: boolean;      // a list is being fetched
  readonly generation: number;    // the refresh the next list must belong to
  readonly error: string | undefined;
  readonly help: boolean;
  readonly confirmQuit: boolean;
  readonly open: string | undefined;  // a run the person asked to open
  readonly quit: 'none' | 'close' | 'detach' | 'cancel';
}
export type HomeEvent =
  | { readonly press: KeyName }
  | { readonly runs: readonly RunSummary[]; readonly generation: number }
  | { readonly failed: string; readonly generation: number }
  | { readonly left: true };       // came back from an opened run
export interface HomeContext { readonly attached: boolean; readonly canOpen: boolean; readonly pageSize: number }
export function initialHome(): HomeState;
export function reduceHome(state: HomeState, event: HomeEvent, context: HomeContext): HomeState;
export function buildHomeScreen(state: HomeState, layout: Layout, options: { ascii: boolean; canOpen: boolean }): Screen;
```

`computeLayout` is unchanged: Home uses its `split` (list and the selected run's details), `stacked` (list only) and `too-small` modes.

## `indaba` (the composition root)

`tui-loader.ts` gains, optional: `TuiModule.run?(options: TuiHomeOptions): Promise<TuiHomeResult>`. `loadTui` is unchanged: it requires `watch` only.
New `packages/cli/src/home.ts`: `openHome(io, options): Promise<number | undefined>`; `undefined` means "fall through to the usage error".
`main()` calls it only when `command === undefined`.

Gate order (spec section 9): no terminal or `INDABA_NO_TUI` is `1` returns `undefined`; no `setRawMode` writes the AC-08 line and returns 1;
`loadTui` missing writes one line and returns `undefined`; no `run` returns `undefined`; otherwise `run` is awaited under `logged('home')`
and its `code` returned. A thrown error is redacted, logged, written as one line, and returns 1.

## Checks

- [x] An older installed `@indaba/tui` without `run` leaves bare `indaba` as today
- [x] Every type in a new public signature is public or marked `@internal`
- [x] `@indaba/tui` imports only itself and `@indaba/engine` (`RunSummary`, `RunRecord` and `BoardFileRecord` are already re-exported by it)
