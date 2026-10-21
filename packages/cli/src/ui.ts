import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Io } from './main.js';
import { loadServer, type ServerLoad } from './server-loader.js';

export const UI_USAGE = `Usage: indaba ui [options]

Open the web view of the runs on this machine. It reads what runs write under .indaba/traces; it starts nothing.

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
    io.stdout.write(UI_USAGE);
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
    io.stdout.write(
      `indaba ui needs the package @indaba/server, which could not be loaded (${loaded.missing}).\n` +
        'Install it next to indaba, then try again: npm install -g @indaba/server\n',
    );
    return 1;
  }
  const staticDir = loaded.server.defaultPageDirectory();
  if (staticDir === undefined) {
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
  });

  io.stdout.write(`Indaba is serving the runs of:\n${options.roots.map((root) => `  ${root}\n`).join('')}`);
  io.stdout.write(
    `\nOpen this address in a browser (it carries the token, so keep it to yourself):\n\n  ${handle.url}\n\n`,
  );
  if (options.open) {
    const opened = io.openBrowser === undefined ? false : await io.openBrowser(handle.url);
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
