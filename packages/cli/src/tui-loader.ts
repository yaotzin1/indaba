import type { Logger, LoggingSettings, SinkSettings } from '@indaba/core';
import type { BoardFileRecord, RunRecord, RunSummary } from '@indaba/engine';
import type { UiRunControl } from './server-loader.js';

/** What the command line needs of `@indaba/tui`. The package is optional, so its types are not imported. */
export interface TuiWatchOptions {
  readonly directory: string;
  readonly runId: string;
  readonly replay: boolean;
  readonly speed: 1 | 10;
  readonly attached: boolean;
  readonly ascii: boolean;
  readonly color: boolean;
  readonly stdout: NodeJS.WritableStream;
  readonly stdin: NodeJS.ReadableStream;
  readonly signal?: AbortSignal;
  readonly logger?: Logger;
}

export interface TuiWatchResult {
  readonly quit: 'close' | 'detach' | 'cancel';
  readonly code: number;
}

export interface TuiSettingsOptions {
  readonly settings: LoggingSettings;
  readonly path: string;
  readonly actions: {
    save(settings: LoggingSettings): Promise<string>;
    test(sink: SinkSettings): Promise<{ readonly ok: boolean; readonly text: string }>;
    isVariableSet(name: string): boolean;
  };
  readonly ascii: boolean;
  readonly color: boolean;
  readonly stdout: NodeJS.WritableStream;
  readonly stdin: NodeJS.ReadableStream;
  readonly logger?: Logger;
}

/** What bare `indaba` needs of Home in `@indaba/tui` (specs/tui-home). */
/** What Home may do with runs: the control `indaba ui` uses, plus letting go of the runs started here. */
export type HomeRunControl = UiRunControl & { detach(): void };

export interface TuiHomeOptions {
  readonly listRuns: () => Promise<readonly RunSummary[]>;
  readonly openRun?: (
    runId: string,
    signal: AbortSignal,
  ) => { readonly source: AsyncIterable<RunRecord>; readonly board?: AsyncIterable<BoardFileRecord> };
  readonly runs?: HomeRunControl;
  readonly pollMs?: number;
  readonly attached?: boolean;
  readonly ascii: boolean;
  readonly color: boolean;
  readonly stdout: NodeJS.WritableStream;
  readonly stdin: NodeJS.ReadableStream;
  readonly signal?: AbortSignal;
  readonly logger?: Logger;
}

export interface TuiHomeResult {
  readonly quit: 'close' | 'detach' | 'cancel';
  readonly code: number;
}

export interface TuiModule {
  watch(options: TuiWatchOptions): Promise<TuiWatchResult>;
  /** The Settings screen of logging; absent in a version of @indaba/tui older than it. */
  editLoggingSettings?(options: TuiSettingsOptions): Promise<{ readonly saved: boolean }>;
  /** Home, the application of bare `indaba`; absent in a version of @indaba/tui older than it. */
  run?(options: TuiHomeOptions): Promise<TuiHomeResult>;
}

export type TuiLoad = { readonly tui: TuiModule } | { readonly missing: string };

const TUI_PACKAGE = '@indaba/tui';

/**
 * Loads the terminal view if it is installed. A package that is absent, or one that fails to load, is not an error of
 * the command: the caller falls back to plain output and says why.
 */
export async function loadTui(
  importer: (name: string) => Promise<unknown> = (name) => import(name),
): Promise<TuiLoad> {
  let loaded: unknown;
  try {
    loaded = await importer(TUI_PACKAGE);
  } catch (error) {
    return { missing: error instanceof Error ? error.message : String(error) };
  }
  const candidate = loaded as { watch?: unknown };
  if (typeof candidate.watch !== 'function') {
    return { missing: `${TUI_PACKAGE} does not export a watch function` };
  }
  return { tui: candidate as TuiModule };
}
