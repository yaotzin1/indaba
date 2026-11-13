import { type Logger, noopLogger, type RunSummary } from '@indaba/engine';
import { h, type RenderOptions, render } from './ink/adapter.js';
import { HomeApp, type RunFeed } from './ink/home-app.js';

export type { RunFeed as HomeRunSource } from './ink/home-app.js';

export interface HomeOptions {
  /** The runs of the project, newest first, as `indaba watch` lists them. May reject: Home shows one line and `r` retries. */
  readonly listRuns: () => Promise<readonly RunSummary[]>;
  /** The records of one run; `signal` aborts when the person leaves it. Without it, `Enter` does nothing and `?` does not name it. */
  readonly openRun?: (runId: string, signal: AbortSignal) => RunFeed;
  /** The screen started a run, so quitting asks what to do with it. Default false. */
  readonly attached?: boolean;
  readonly ascii: boolean;
  readonly color: boolean;
  readonly stdout: NodeJS.WritableStream;
  readonly stdin: NodeJS.ReadableStream;
  readonly signal?: AbortSignal;
  /** Records when Home opens and closes. Nothing at `warn`: that is printed over the screen. */
  readonly logger?: Logger;
}

export interface HomeResult {
  readonly quit: 'close' | 'detach' | 'cancel';
  /** 0 for close and detach; 130 for cancel and for an abort. */
  readonly code: number;
}

/**
 * Home: the application a person gets from bare `indaba` on a terminal (specs/tui-home). Always gives the terminal back
 * (raw mode off, cursor shown) before it returns or throws, and never starts or stops a run by itself.
 */
export async function run(options: HomeOptions): Promise<HomeResult> {
  const logger = options.logger ?? noopLogger;
  let quit: HomeResult['quit'] | undefined;
  const renderOptions: RenderOptions = {
    stdout: options.stdout,
    stdin: options.stdin,
    // Ctrl+C is a key of Home's own, and the console is left alone
    exitOnCtrlC: false,
    patchConsole: false,
    // The caller only gets here with a terminal; Ink's own guess treats a variable named CI as "no screen"
    interactive: true,
  };
  logger.info('tui.home', 'home opened');
  const instance = render(
    h(HomeApp, {
      listRuns: options.listRuns,
      ...(options.openRun === undefined ? {} : { openRun: options.openRun }),
      attached: options.attached === true,
      ascii: options.ascii,
      color: options.color,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      onFinish: (chosen) => {
        quit = chosen;
      },
    }),
    renderOptions,
  );
  const onAbort = (): void => {
    quit ??= 'cancel';
    instance.unmount();
  };
  if (options.signal?.aborted === true) {
    onAbort();
  }
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await instance.waitUntilExit();
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    instance.unmount();
  }
  // Ink ended without Home saying why (the terminal went away): that is a plain close
  const result = quit ?? 'close';
  const code = result === 'cancel' ? 130 : 0;
  logger.info('tui.home', 'home closed', { quit: result, code });
  return { quit: result, code };
}
