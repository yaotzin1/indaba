import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createLogger, type LogRecord } from '@indaba/engine';
import type { RunControlPort } from '@indaba/tui';
import { describe, expect, it, vi } from 'vitest';
import { homeRunControl, redactDeep, runHome } from '../src/home.js';
import { type Io, main } from '../src/index.js';
import { RunControlError } from '../src/run-control/index.js';
import type { UiRunControl } from '../src/server-loader.js';
import type { TuiHomeOptions, TuiLoad } from '../src/tui-loader.js';
import { captureIo, makeTempDir } from './support.js';

/** Shaped like a key, built from parts so no file holds one (the security audit scans tests too). */
const SECRET = ['sk', 'live', '0123456789', 'abcdefghij'].join('-');
const ENV = { OPENROUTER_API_KEY: SECRET };

function fakeControl(
  over: Partial<UiRunControl & { detach(): void }> = {},
): UiRunControl & { detach?(): void } {
  return {
    list: async () => ({ workflows: [], truncated: false }),
    start: async () => ({ startId: 'web-1' }),
    startStatus: () => ({ state: 'starting' }),
    stop: () => ({ state: 'stopping' }),
    isAlive: () => true,
    stopAll: async () => undefined,
    ...over,
  };
}

describe('redactDeep', () => {
  it('replaces a credential in every string of a nested value, keeping the shape and the rest', () => {
    const value = { a: [`x ${SECRET}`, 3, null, true], b: { c: `${SECRET}` }, d: undefined };
    expect(redactDeep(value, ENV)).toEqual({
      a: ['x [redacted]', 3, null, true],
      b: { c: '[redacted]' },
      d: undefined,
    });
    expect(JSON.stringify(redactDeep(value, ENV))).not.toContain(SECRET);
  });
});

describe('what the screen gets of the control (AC-07, AC-13)', () => {
  it('satisfies the port the terminal application declares', () => {
    // a compile-time check as much as a run-time one: the CLI composition root cannot drift from the port
    const port: RunControlPort = homeRunControl(fakeControl(), ENV);
    expect(Object.keys(port).sort()).toEqual(
      ['detach', 'isAlive', 'list', 'start', 'startStatus', 'stop', 'stopAll'].sort(),
    );
  });

  it('replaces a credential in a workflow list, whatever field it is in', async () => {
    const control = fakeControl({
      list: async () => ({
        workflows: [
          {
            id: 'w',
            name: `n ${SECRET}`,
            path: 'a.yml',
            project: 'p',
            valid: false,
            problems: [`bad ${SECRET}`],
          },
        ],
        truncated: false,
      }),
    });
    const listed = await homeRunControl(control, ENV).list();
    expect(JSON.stringify(listed)).not.toContain(SECRET);
    expect(listed.workflows[0]?.problems[0]).toBe('bad [redacted]');
  });

  it('re-makes a refusal with its name, code and a redacted message and detail', async () => {
    const control = fakeControl({
      start: async () => {
        throw new RunControlError('confirmation_required', `confirm ${SECRET}`, {
          contentHash: 'h',
          use: { commands: [`curl -H ${SECRET}`] },
        });
      },
    });
    const error = await homeRunControl(control, ENV)
      .start({ workflowId: 'w' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'RunControlError', code: 'confirmation_required' });
    expect((error as Error).message).toBe('confirm [redacted]');
    expect((error as { detail: unknown }).detail).toEqual({
      contentHash: 'h',
      use: { commands: ['curl -H [redacted]'] },
    });
  });

  it('redacts an error that is not a refusal, and one that is not even an Error', async () => {
    const plain = fakeControl({
      start: async () => {
        throw new Error(`boom ${SECRET}`);
      },
    });
    const a = await homeRunControl(plain, ENV)
      .start({ workflowId: 'w' })
      .catch((e: unknown) => e);
    expect(a).toMatchObject({ message: 'boom [redacted]' });
    expect(a).not.toHaveProperty('code');
    const text = fakeControl({
      start: () => Promise.reject(`string ${SECRET}`),
    });
    const b = await homeRunControl(text, ENV)
      .start({ workflowId: 'w' })
      .catch((e: unknown) => e);
    expect((b as Error).message).toBe('string [redacted]');
  });

  it('passes a start through, and redacts the status that comes back', async () => {
    const control = fakeControl({ startStatus: () => ({ state: 'failed', failure: `died ${SECRET}` }) });
    const port = homeRunControl(control, ENV);
    expect(await port.start({ workflowId: 'w' })).toEqual({ startId: 'web-1' });
    expect(port.startStatus('web-1')).toEqual({ state: 'failed', failure: 'died [redacted]' });
    const gone = homeRunControl(fakeControl({ startStatus: () => undefined }), ENV);
    expect(gone.startStatus('x')).toBeUndefined();
  });

  it('passes stop, isAlive and stopAll through, and detach when the control has one', async () => {
    const stop = vi.fn(() => ({ state: 'ended' as const }));
    const stopAll = vi.fn(async () => undefined);
    const detach = vi.fn();
    const port = homeRunControl(fakeControl({ stop, stopAll, detach, isAlive: () => false }), ENV);
    expect(port.stop('r')).toEqual({ state: 'ended' });
    expect(port.isAlive('r')).toBe(false);
    await port.stopAll();
    port.detach();
    expect([stop.mock.calls.length, stopAll.mock.calls.length, detach.mock.calls.length]).toEqual([1, 1, 1]);
    expect(() => homeRunControl(fakeControl(), ENV).detach()).not.toThrow();
  });

  it('lets stopAll reject, so the screen can say the runs were not stopped', async () => {
    const port = homeRunControl(fakeControl({ stopAll: () => Promise.reject(new Error('EPERM')) }), ENV);
    await expect(port.stopAll()).rejects.toThrow('EPERM');
  });
});

describe('every call the screen makes is guarded (AC-13)', () => {
  const boom = (): never => {
    throw new Error(`failed with ${SECRET}`);
  };
  const reject = (): Promise<never> => Promise.reject(new Error(`failed with ${SECRET}`));

  it.each([
    ['list', { list: reject }, (port: RunControlPort) => port.list()],
    ['start', { start: reject }, (port: RunControlPort) => port.start({ workflowId: 'w' })],
    ['stopAll', { stopAll: reject }, (port: RunControlPort) => port.stopAll()],
  ] as const)('%s rejects with the credential replaced', async (_name, over, call) => {
    const port = homeRunControl(fakeControl(over as Partial<UiRunControl>), ENV);
    const error = await call(port).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('failed with [redacted]');
  });

  it.each([
    ['startStatus', { startStatus: boom }, (port: RunControlPort) => port.startStatus('x')],
    ['stop', { stop: boom }, (port: RunControlPort) => port.stop('r')],
    ['isAlive', { isAlive: boom }, (port: RunControlPort) => port.isAlive('r')],
    ['detach', { detach: boom }, (port: RunControlPort) => port.detach()],
  ] as const)('%s throws with the credential replaced', (_name, over, call) => {
    const port = homeRunControl(fakeControl(over as Partial<UiRunControl>), ENV);
    expect(() => call(port)).toThrow('failed with [redacted]');
  });
});

describe('Home started from bare indaba with a control (AC-05, AC-11)', () => {
  const rawTerminal = () => ({
    stdin: Object.assign(new PassThrough(), { setRawMode: () => undefined }),
    stdout: new PassThrough(),
  });

  async function bare(startRun: Io['startRun'] | undefined) {
    const calls: TuiHomeOptions[] = [];
    const captured = captureIo(await makeTempDir(), {});
    const io: Io = {
      ...captured.io,
      terminal: rawTerminal(),
      ...(startRun === undefined ? {} : { startRun }),
      loadTui: async (): Promise<TuiLoad> => ({
        tui: {
          watch: async () => ({ quit: 'close', code: 0 }),
          run: async (options) => {
            calls.push(options);
            return { quit: 'close', code: 0 };
          },
        },
      }),
    };
    const code = await main([], io);
    return { calls, code, err: captured.stderr() };
  }

  it('hands Home a control when this command can start runs, and none when it cannot', async () => {
    const withStart = await bare(() => {
      throw new Error('not used');
    });
    expect(withStart.code).toBe(0);
    expect(withStart.calls[0]?.runs).toBeDefined();
    const without = await bare(undefined);
    expect(without.calls[0]?.runs).toBeUndefined();
  });

  it('lists the workflows of the project through that control', async () => {
    const { calls } = await bare(() => {
      throw new Error('not used');
    });
    const listed = await calls[0]?.runs?.list();
    expect(listed).toMatchObject({ workflows: [], truncated: false });
  });

  it('lets the runs go when the screen throws, and says so in one line', async () => {
    const detach = vi.fn();
    const control = fakeControl({ detach });
    const records: LogRecord[] = [];
    const logger = createLogger({
      sinks: [{ write: (r) => void records.push(r) }],
      clock: () => new Date(0),
    });
    const captured = captureIo(await makeTempDir(), ENV);
    const terminal = rawTerminal();
    const code = await runHome(
      { ...captured.io, terminal },
      {
        kind: 'open',
        terminal,
        tui: {
          watch: async () => ({ quit: 'close', code: 0 }),
          run: async () => {
            throw new Error(`boom ${SECRET}`);
          },
        },
      },
      logger,
      { ascii: false, color: true, environment: ENV, control },
    );
    expect(code).toBe(1);
    expect(detach).toHaveBeenCalledTimes(1);
    expect(captured.stderr()).not.toContain(SECRET);
    expect(JSON.stringify(records)).not.toContain(SECRET);
  });

  it('lets the runs go when the screen ends normally, and tolerates a detach that fails', async () => {
    const detach = vi.fn(() => {
      throw new Error('already gone');
    });
    const captured = captureIo(await makeTempDir(), ENV);
    const terminal = rawTerminal();
    const code = await runHome(
      { ...captured.io, terminal },
      {
        kind: 'open',
        terminal,
        tui: {
          watch: async () => ({ quit: 'close', code: 0 }),
          run: async () => ({ quit: 'detach', code: 0 }),
        },
      },
      createLogger({ sinks: [], clock: () => new Date(0) }),
      { ascii: false, color: true, environment: ENV, control: fakeControl({ detach }) },
    );
    expect(code).toBe(0);
    expect(detach).toHaveBeenCalledTimes(1);
  });
});

describe('a released run is never cancelled by its channel closing (AC-05)', () => {
  it('has no listener for the channel closing in the child entry point', () => {
    // `release()` closes the channel; if the child treated that as a cancel, d on the quit question would stop the runs
    const bin = readFileSync(fileURLToPath(new URL('../src/bin.ts', import.meta.url)), 'utf8');
    expect(bin).not.toMatch(/on\(\s*['"]disconnect['"]/);
    expect(bin).toMatch(/CANCEL_MESSAGE/);
  });
});
