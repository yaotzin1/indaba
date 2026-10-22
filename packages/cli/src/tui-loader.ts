import type { Logger, LoggingSettings, SinkSettings } from '@indaba/core';

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

export interface TuiModule {
  watch(options: TuiWatchOptions): Promise<TuiWatchResult>;
  /** The Settings screen of logging; absent in a version of @indaba/tui older than it. */
  editLoggingSettings?(options: TuiSettingsOptions): Promise<{ readonly saved: boolean }>;
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
