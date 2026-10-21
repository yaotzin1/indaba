import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Logger, noopLogger } from '@indaba/core';
import { LOG_OPTIONS_USAGE } from './log.js';
import type { Io } from './main.js';
import { loadServer, type ServerLoad, type UiSettingsBackend } from './server-loader.js';

export const UI_USAGE = `Usage: indaba ui [options]

Open the web view of the runs on this machine. It reads what runs write under .indaba/traces; it starts nothing.
Its Settings screen changes the logging section of indaba.config of the first --root (or the current folder).

Options:
      --root <dir>    A project whose runs to show; repeatable (default: the current folder)
      --discussion-dir <dir>
                      Another folder with the kept messages of debates; repeatable (default: .indaba/discussions)
      --port <n>      The port to listen on (default: a free one)
      --no-open       Print the address and do not open the browser

The address carries a token and works only on this machine. Keep it to yourself. Stop with Ctrl+C.
`;

export interface UiDeps {
  readonly loadServer?: () => Promise<ServerLoad>;
  /** The command's logger, handed on to the server. Default: one that records nothing. */
  readonly logger?: Logger;
  /**
   * The logging settings of a project, for the page's Settings screen; given the first root, it answers for that
   * project. Without it the page has no Settings screen and the server stays read-only.
   */
  readonly loggingSettings?: (root: string) => UiSettingsBackend;
}

class UiUsageError extends Error {}

interface UiOptions {
  readonly roots: readonly string[];
  readonly discussionDirs: readonly string[];
  readonly port: number | undefined;
  readonly open: boolean;
  readonly help: boolean;
}

function parseUi(args: readonly string[], cwd: string): UiOptions {
  let parsed: ReturnType<typeof parseWith>;
  try {
    parsed = parseWith(args);
  } catch (error) {
    throw new UiUsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (positionals.length > 0) {
    throw new UiUsageError(`Unexpected argument: ${positionals[0]}. Name a project with --root.`);
  }
  let port: number | undefined;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (values.port.trim() === '' || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new UiUsageError(`--port must be a port number from 1 to 65535, got "${values.port}"`);
    }
  }
  const roots = (values.root ?? []).map((root) => resolve(cwd, root));
  return {
    roots: roots.length === 0 ? [resolve(cwd)] : roots,
    discussionDirs: (values['discussion-dir'] ?? []).map((dir) => resolve(cwd, dir)),
    port,
    open: values['no-open'] !== true,
    help: values.help === true,
  };
}

function parseWith(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      root: { type: 'string', multiple: true },
      port: { type: 'string' },
      'discussion-dir': { type: 'string', multiple: true },
      'no-open': { type: 'boolean' },
    },
  });
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Resolves when the command is asked to end, or at once when it was given no way to be asked. */
function untilStopped(signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined || signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((done) => signal.addEventListener('abort', () => done(), { once: true }));
}

/**
 * `indaba ui`: starts the local server over the runs of one or more projects, prints the address (with its token),
 * opens the browser unless told not to, and serves until the command is stopped. Returns the exit code.
 */
export async function ui(args: readonly string[], io: Io, deps: UiDeps = {}): Promise<number> {
  const log = deps.logger ?? noopLogger;
  let options: UiOptions;
  try {
    options = parseUi(args, io.cwd);
  } catch (error) {
    if (error instanceof UiUsageError) {
      io.stderr.write(`${error.message}\n\n${UI_USAGE}`);
      return 2;
    }
    throw error;
  }
  if (options.help) {
    io.stdout.write(`${UI_USAGE}\n${LOG_OPTIONS_USAGE}`);
    return 0;
  }

  for (const root of options.roots) {
    if (!(await isDirectory(root))) {
      io.stdout.write(`The folder ${root} does not exist.\n`);
      return 1;
    }
  }

  const loaded = await (deps.loadServer ?? loadServer)();
  if ('missing' in loaded) {
    log.warn('cli.ui', 'the local server could not be loaded', { reason: loaded.missing });
    io.stdout.write(
      `indaba ui needs the package @indaba/server, which could not be loaded (${loaded.missing}).\n` +
        'Install it next to indaba, then try again: npm install -g @indaba/server\n',
    );
    return 1;
  }
  const staticDir = loaded.server.defaultPageDirectory();
  if (staticDir === undefined) {
    log.warn('cli.ui', 'the page has not been built');
    io.stdout.write(
      'The page of indaba ui has not been built. In a checkout of Indaba, run: pnpm build\n' +
        'A published install carries the page with @indaba/server; reinstall it if this is one.\n',
    );
    return 1;
  }

  const handle = await loaded.server.startServer({
    roots: options.roots,
    staticDir,
    ...(options.discussionDirs.length === 0 ? {} : { discussionDirectories: options.discussionDirs }),
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(deps.loggingSettings === undefined || options.roots[0] === undefined
      ? {}
      : { loggingSettings: deps.loggingSettings(options.roots[0]) }),
    logger: log,
  });
  // The server records its own address, without the token; here what the command was asked to serve.
  log.info('cli.ui', 'serving the runs of the roots', { roots: options.roots.length, open: options.open });

  io.stdout.write(`Indaba is serving the runs of:\n${options.roots.map((root) => `  ${root}\n`).join('')}`);
  io.stdout.write(
    `\nOpen this address in a browser (it carries the token, so keep it to yourself):\n\n  ${handle.url}\n\n`,
  );
  if (options.open) {
    const opened = io.openBrowser === undefined ? false : await io.openBrowser(handle.url);
    if (!opened) {
      log.info('cli.ui', 'the browser could not be opened');
    }
    io.stdout.write(
      opened ? 'Opening it in your browser.\n' : 'Your browser could not be opened; use the address above.\n',
    );
  }
  io.stdout.write('Stop with Ctrl+C. Runs started in a terminal are not affected.\n');

  await untilStopped(io.signal);
  await handle.close();
  io.stdout.write('Stopped.\n');
  return 0;
}
