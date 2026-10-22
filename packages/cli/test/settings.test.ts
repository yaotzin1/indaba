import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { LoggingSettings } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { testSink } from '../src/log.js';
import { SETTINGS_USAGE } from '../src/settings.js';
import type { TuiLoad, TuiSettingsOptions } from '../src/tui-loader.js';
import { captureIo, makeTempDir } from './support.js';

const NOW = '2026-10-21T08:00:00.000Z';

async function command(
  args: string[],
  cwd: string,
  extra: { env?: Record<string, string>; loadTui?: () => Promise<TuiLoad>; terminal?: boolean } = {},
) {
  const captured = captureIo(cwd, extra.env ?? {});
  const code = await main(args, {
    ...captured.io,
    clock: () => new Date(NOW),
    pid: 1,
    ...(extra.loadTui === undefined ? {} : { loadTui: extra.loadTui }),
    ...(extra.terminal === true ? { terminal: { stdin: new PassThrough(), stdout: new PassThrough() } } : {}),
  });
  return { code, out: captured.stdout(), err: captured.stderr() };
}

const logOptions = (root: string) => ({
  root,
  level: 'debug' as const,
  dir: undefined,
  stderr: { write: () => undefined },
  environment: {},
  clock: () => new Date(NOW),
  pid: 1,
});

describe('indaba settings', () => {
  it('prints the settings in use, with the defaults when there is no file', async () => {
    const dir = await makeTempDir();
    const r = await command(['settings'], dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain('not written yet: all defaults');
    expect(r.out).toContain('  level: info  (default info)');
    expect(r.out).toContain('  sinks[0]: file, level debug');
    expect(r.out).toContain('    Log folder: .indaba/logs');
  });

  it('prints remote sinks, and says what is wrong with a file', async () => {
    const dir = await makeTempDir();
    await writeFile(
      join(dir, 'indaba.config'),
      'logging:\n  sinks:\n    - type: gelf\n      address: udp://g.test:12201\n      secretEnv: G_TOKEN\n',
    );
    const r = await command(['settings', '--plain'], dir);
    expect(r.out).toContain('  sinks[0]: gelf, level info');
    expect(r.out).toContain('    address: udp://g.test:12201');
    expect(r.out).toContain('G_TOKEN');
    expect(r.out).toContain('queue 1000, timeout 5 s, retries 3');
    await writeFile(join(dir, 'indaba.config'), 'logging:\n  level: loud\n');
    const bad = await command(['settings', '-w', '.'], dir);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('logging.level must be one of');
  });

  it('opens the screen on a terminal, and saves through the same writer as a hand-edited file', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'indaba.config'), '# kept\n');
    const seen: TuiSettingsOptions[] = [];
    const loadTui = async (): Promise<TuiLoad> => ({
      tui: {
        watch: async () => ({ quit: 'close', code: 0 }),
        editLoggingSettings: async (options) => {
          seen.push(options);
          const changed: LoggingSettings = { ...options.settings, level: 'debug' };
          await options.actions.save(changed);
          const tested = await options.actions.test({ type: 'stderr', level: 'warn' });
          expect(tested.ok).toBe(true);
          expect(options.actions.isVariableSet('SET_ONE')).toBe(true);
          expect(options.actions.isVariableSet('EMPTY_ONE')).toBe(false);
          return { saved: true };
        },
      },
    });
    const r = await command(['settings'], dir, {
      loadTui,
      terminal: true,
      env: { SET_ONE: 'x', EMPTY_ONE: '' },
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain('Logging settings saved to');
    expect(seen[0]?.path).toBe(join(dir, 'indaba.config'));
    const text = await readFile(join(dir, 'indaba.config'), 'utf8');
    expect(text).toContain('# kept');
    expect(text).toContain('level: debug');
  });

  it('says when nothing was saved, and prints when the screen is not installed', async () => {
    const dir = await makeTempDir();
    const none = await command(['settings'], dir, {
      terminal: true,
      loadTui: async () => ({
        tui: {
          watch: async () => ({ quit: 'close', code: 0 }),
          editLoggingSettings: async () => ({ saved: false }),
        },
      }),
    });
    expect(none.out).toBe('Nothing was saved.\n');
    const missing = await command(['settings'], dir, {
      terminal: true,
      loadTui: async () => ({ missing: 'not installed' }),
    });
    expect(missing.err).toContain('The Settings screen needs @indaba/tui');
    expect(missing.out).toContain('Logging settings');
  });

  it('prints its usage and refuses an argument', async () => {
    const dir = await makeTempDir();
    expect((await command(['settings', '--help'], dir)).out).toBe(SETTINGS_USAGE);
    const bad = await command(['settings', 'extra'], dir);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('Unexpected argument: extra');
    expect((await command(['settings', '--nope'], dir)).code).toBe(2);
  });
});

describe('testSink', () => {
  it('writes a test record to a file sink', async () => {
    const dir = await makeTempDir();
    const result = await testSink(
      { type: 'file', level: 'debug', folder: 'logs', maxFileBytes: 1000, maxFiles: 2 },
      logOptions(dir),
    );
    expect(result).toEqual({ ok: true, text: 'The test record was written to the log folder.' });
    expect(await readFile(join(dir, 'logs', 'indaba-2026-10-21.log.jsonl'), 'utf8')).toContain(
      'a test record',
    );
  });

  it('says a folder that cannot be written', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'blocked'), '');
    const result = await testSink(
      { type: 'file', level: 'debug', folder: 'blocked/logs', maxFileBytes: 1000, maxFiles: 2 },
      logOptions(dir),
    );
    expect(result.ok).toBe(false);
    expect(result.text).toContain('the log folder cannot be written');
  });

  it('posts to a collector, and says when it is down', async () => {
    const server = createServer((_req, res) => res.writeHead(202).end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/gelf`;
    const remote = { level: 'info' as const, queueLength: 2, timeoutSeconds: 1, retries: 0 };
    expect(await testSink({ type: 'http-json', address: url, ...remote }, logOptions('.'))).toEqual({
      ok: true,
      text: 'The collector took the test record.',
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const down = await testSink({ type: 'gelf', address: url, ...remote }, logOptions('.'));
    expect(down.ok).toBe(false);
    expect(down.text).toMatch(/^The test record was not delivered: /);
    const udp = await testSink({ type: 'gelf', address: 'udp://127.0.0.1:9', ...remote }, logOptions('.'));
    expect(udp.text).toContain('UDP gives no answer');
  });
});
