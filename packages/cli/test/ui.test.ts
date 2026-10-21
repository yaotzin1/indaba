import { EventEmitter } from 'node:events';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { createBrowserOpener, openerCommand, type Starter } from '../src/open-browser.js';
import { loadServer, type ServerLoad, type UiServerOptions } from '../src/server-loader.js';
import { captureIo, makeTempDir } from './support.js';

const ADDRESS = 'http://127.0.0.1:4321/#token=abc';
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function fakeServer(page: string | null = '/page') {
  const started: UiServerOptions[] = [];
  let closed = 0;
  const load = (): Promise<ServerLoad> =>
    Promise.resolve({
      server: {
        defaultPageDirectory: () => page ?? undefined,
        startServer: (options) => {
          started.push(options);
          return Promise.resolve({ url: ADDRESS, port: 4321, close: () => Promise.resolve(void closed++) });
        },
      },
    });
  return { load, started, closed: () => closed };
}

async function runUi(args: string[], options: { noPage?: boolean; opens?: boolean } = {}) {
  const dir = await makeTempDir();
  const controller = new AbortController();
  const captured = captureIo(dir, {}, controller.signal);
  const server = fakeServer(options.noPage === true ? null : '/page');
  const opened: string[] = [];
  const io = {
    ...captured.io,
    loadServer: server.load,
    openBrowser: (url: string) => {
      opened.push(url);
      return Promise.resolve(options.opens ?? true);
    },
  };
  const finished = main(['ui', ...args], io);
  return { dir, controller, captured, server, opened, finished };
}

describe('indaba ui', () => {
  it('serves the current folder, prints the address, opens the browser and stops on request', async () => {
    const { dir, controller, captured, server, opened, finished } = await runUi([]);
    await settle();
    expect(server.started).toEqual([{ roots: [dir], staticDir: '/page' }]);
    expect(captured.stdout()).toContain(ADDRESS);
    expect(opened).toEqual([ADDRESS]);
    expect(server.closed()).toBe(0);
    controller.abort();
    expect(await finished).toBe(0);
    expect(server.closed()).toBe(1);
    expect(captured.stdout()).toContain('Stopped.');
  });

  it('takes several roots and a port, and does not open the browser with --no-open', async () => {
    const other = await makeTempDir();
    const { dir, controller, server, opened, finished } = await runUi([
      '--root',
      other,
      '--root',
      '.',
      '--port',
      '4000',
      '--no-open',
    ]);
    await settle();
    expect(server.started[0]).toMatchObject({ roots: [other, dir], port: 4000 });
    expect(opened).toEqual([]);
    controller.abort();
    await finished;
  });

  it('passes the folders with kept debate messages to the server, resolved from here', async () => {
    const { dir, controller, server, finished } = await runUi([
      '--discussion-dir',
      'kept',
      '--discussion-dir',
      '..',
      '--no-open',
    ]);
    await settle();
    expect(server.started[0]?.discussionDirectories).toEqual([join(dir, 'kept'), resolve(dir, '..')]);
    controller.abort();
    await finished;
  });

  it('says so when the browser could not be opened', async () => {
    const { controller, captured, finished } = await runUi([], { opens: false });
    await settle();
    expect(captured.stdout()).toContain('could not be opened');
    controller.abort();
    await finished;
  });

  it('ends at once when it was given no way to be stopped, and reports a browser it cannot open', async () => {
    const dir = await makeTempDir();
    const captured = captureIo(dir);
    const server = fakeServer();
    expect(await main(['ui'], { ...captured.io, loadServer: server.load })).toBe(0);
    expect(server.closed()).toBe(1);
    expect(captured.stdout()).toContain('could not be opened');
  });

  it.each([
    [['--port', '0'], '--port'],
    [['--port', 'abc'], '--port'],
    [['--port', '70000'], '--port'],
    [['--port', ' '], '--port'],
    [['--bogus'], 'bogus'],
    [['extra'], 'Unexpected argument'],
  ])('refuses %j as a usage error', async (args, text) => {
    const { captured, finished } = await runUi(args);
    expect(await finished).toBe(2);
    expect(captured.stderr()).toContain(text);
    expect(captured.stderr()).toContain('Usage: indaba ui');
  });

  it('prints its usage', async () => {
    const { captured, finished } = await runUi(['--help']);
    expect(await finished).toBe(0);
    expect(captured.stdout()).toContain('--no-open');
  });

  it('fails plainly when a root does not exist', async () => {
    const { captured, finished, server } = await runUi(['--root', 'no-such-folder']);
    expect(await finished).toBe(1);
    expect(captured.stdout()).toContain('does not exist');
    expect(server.started).toEqual([]);
  });

  it('fails plainly when the server package is not installed', async () => {
    const dir = await makeTempDir();
    const captured = captureIo(dir);
    const code = await main(['ui'], {
      ...captured.io,
      loadServer: () => Promise.resolve({ missing: 'not found' }),
    });
    expect(code).toBe(1);
    expect(captured.stdout()).toContain('@indaba/server');
    expect(captured.stdout()).toContain('not found');
  });

  it('fails plainly when the page has not been built', async () => {
    const { captured, finished, server } = await runUi([], { noPage: true });
    expect(await finished).toBe(1);
    expect(captured.stdout()).toContain('pnpm build');
    expect(server.started).toEqual([]);
  });

  it('reports a server that fails to start without a stack', async () => {
    const dir = await makeTempDir();
    const captured = captureIo(dir);
    const load = (): Promise<ServerLoad> =>
      Promise.resolve({
        server: {
          defaultPageDirectory: () => '/page',
          startServer: () => Promise.reject(new Error('port in use')),
        },
      });
    expect(await main(['ui'], { ...captured.io, loadServer: load })).toBe(1);
    expect(captured.stderr()).toBe('port in use\n');
  });

  it('is listed in the usage of the command line', async () => {
    const dir = await makeTempDir();
    const captured = captureIo(dir);
    await main(['--help'], captured.io);
    expect(captured.stdout()).toContain('  ui ');
  });
});

describe('loadServer', () => {
  it('returns the module when it has what the command needs', async () => {
    const module = { startServer: () => undefined, defaultPageDirectory: () => undefined };
    expect(await loadServer(() => Promise.resolve(module))).toEqual({ server: module });
  });

  it('says why when the package is absent, fails to load or is the wrong shape', async () => {
    expect(await loadServer(() => Promise.reject(new Error('Cannot find package')))).toEqual({
      missing: 'Cannot find package',
    });
    expect(await loadServer(() => Promise.reject('plain'))).toEqual({ missing: 'plain' });
    expect(await loadServer(() => Promise.resolve({}))).toMatchObject({
      missing: expect.stringContaining('does not export'),
    });
  });
});

describe('opening the browser', () => {
  it('passes the address as one argument, never through a shell', () => {
    const url = `${ADDRESS} & calc`;
    expect(openerCommand('win32', url)).toEqual({
      file: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', url],
    });
    expect(openerCommand('darwin', url)).toEqual({ file: 'open', args: [url] });
    expect(openerCommand('linux', url)).toEqual({ file: 'xdg-open', args: [url] });
  });

  const fakeChild = (event: 'spawn' | 'error') => {
    const emitter = new EventEmitter() as EventEmitter & { unref: () => void };
    emitter.unref = () => undefined;
    queueMicrotask(() => emitter.emit(event, new Error('ENOENT')));
    return emitter as never;
  };

  it('is true when the opener starts and false when it cannot', async () => {
    const seen: string[][] = [];
    const ok: Starter = (file, args) => {
      seen.push([file, ...args]);
      return fakeChild('spawn');
    };
    expect(await createBrowserOpener('linux', ok)(ADDRESS)).toBe(true);
    expect(seen).toEqual([['xdg-open', ADDRESS]]);
    expect(await createBrowserOpener('linux', () => fakeChild('error'))(ADDRESS)).toBe(false);
    const throws: Starter = () => {
      throw new Error('bad');
    };
    expect(await createBrowserOpener('linux', throws)(ADDRESS)).toBe(false);
  });
});

describe('the folder of kept debate messages on run', () => {
  it('is an option of run only, and run lists it', async () => {
    const dir = await makeTempDir();
    const plan = captureIo(dir);
    expect(await main(['plan', '--discussion-dir', 'x'], plan.io)).toBe(2);
    expect(plan.stderr()).toContain('Unknown option \'--discussion-dir\' for "plan"');
    const help = captureIo(dir);
    await main(['run', '--help'], help.io);
    expect(help.stdout()).toContain('--discussion-dir');
  });
});
