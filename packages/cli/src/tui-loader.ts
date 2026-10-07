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
}

export interface TuiWatchResult {
  readonly quit: 'close' | 'detach' | 'cancel';
  readonly code: number;
}

export interface TuiModule {
  watch(options: TuiWatchOptions): Promise<TuiWatchResult>;
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
