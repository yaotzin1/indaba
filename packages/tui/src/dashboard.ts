import { emptyRun, type RunRecord } from '@indaba/engine';
import { h, type RenderOptions, render } from './ink/adapter.js';
import { App, type AppResult } from './ink/app.js';

export interface DashboardOptions {
  readonly source: AsyncIterable<RunRecord>;
  /** The screen started the run, so quitting asks what to do with it. */
  readonly attached: boolean;
  readonly ascii: boolean;
  readonly color: boolean;
  readonly stdout: NodeJS.WritableStream;
  readonly stdin: NodeJS.ReadableStream;
  readonly flushMs?: number;
}

/**
 * Draws the dashboard until the person quits. Always gives the terminal back (raw mode off, cursor shown) before it
 * returns or throws, so a failure in the screen never leaves the person with a broken terminal, and never touches
 * the run it is showing.
 */
export async function runDashboard(options: DashboardOptions): Promise<AppResult> {
  let result: AppResult | undefined;
  const renderOptions: RenderOptions = {
    stdout: options.stdout,
    stdin: options.stdin,
    // Ctrl+C is a key of the screen's own (it asks what to do with a run it started), and the console is left alone
    exitOnCtrlC: false,
    patchConsole: false,
    // The caller only gets here with a terminal to draw on. Ink's own guess treats a variable named CI as "no screen" and
    // would then write only the last frame, even to a person sitting at a TTY in a container or a CI shell.
    interactive: true,
  };
  const instance = render(
    h(App, {
      source: options.source,
      attached: options.attached,
      ascii: options.ascii,
      color: options.color,
      ...(options.flushMs === undefined ? {} : { flushMs: options.flushMs }),
      onFinish: (finished) => {
        result = finished;
      },
    }),
    renderOptions,
  );
  try {
    await instance.waitUntilExit();
  } finally {
    instance.unmount();
  }
  // Ink ended without the app saying why (the terminal went away, say): that is a plain close of an empty screen
  return result ?? { quit: 'close', run: emptyRun() };
}
