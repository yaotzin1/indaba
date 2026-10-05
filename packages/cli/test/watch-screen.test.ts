import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { type RunRecord, serializeRecord, type UnknownRecord } from '@indaba/engine';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index.js';
import { loadTui, type TuiLoad, type TuiWatchOptions } from '../src/tui-loader.js';
import { captureIo, makeTempDir } from './support.js';

type Writable = Exclude<RunRecord, UnknownRecord>;

const TRACE = 'c'.repeat(32);
const finished: Writable[] = [
  {
    type: 'span_started',
    at: '2026-10-05T12:00:00.000Z',
    traceId: TRACE,
    spanId: 'r1',
    parentSpanId: undefined,
    name: 'indaba.task demo',
    attributes: { 'indaba.workflow.name': 'demo', 'indaba.task.id': 't' },
  },
  {
    type: 'span_ended',
    at: '2026-10-05T12:00:30.000Z',
    traceId: TRACE,
    spanId: 'r1',
    status: 'ok',
    statusMessage: undefined,
    attributes: { 'indaba.workflow.status': 'COMPLETED' },
    events: [],
  },
];

async function project(): Promise<string> {
  const dir = await makeTempDir();
  const traces = join(dir, '.indaba', 'traces');
  await mkdir(traces, { recursive: true });
  await writeFile(
    join(traces, `${TRACE}.events.jsonl`),
    finished.map((r) => `${serializeRecord(r)}\n`).join(''),
  );
  return dir;
}

interface Setup {
  readonly calls: TuiWatchOptions[];
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function watchWith(
  args: string[],
  load: (calls: TuiWatchOptions[]) => TuiLoad | Promise<TuiLoad>,
  extra: { terminal?: boolean; env?: Record<string, string | undefined> } = {},
): Promise<Setup> {
  const dir = await project();
  const calls: TuiWatchOptions[] = [];
  const captured = captureIo(dir, extra.env ?? {});
  const terminal =
    extra.terminal === false ? {} : { terminal: { stdin: new PassThrough(), stdout: new PassThrough() } };
  const io: Io = { ...captured.io, ...terminal, loadTui: async () => load(calls) };
  const code = await main(['watch', ...args], io);
  return { calls, code, out: captured.stdout(), err: captured.stderr() };
}

const fakeTui =
  (code: number, quit: 'close' | 'detach' | 'cancel' = 'close') =>
  (calls: TuiWatchOptions[]): TuiLoad => ({
    tui: {
      watch: async (options) => {
        calls.push(options);
        return { quit, code };
      },
    },
  });

describe('indaba watch: the dashboard', () => {
  it('opens the dashboard on a terminal, and returns its exit status', async () => {
    const r = await watchWith([TRACE], fakeTui(0));
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatchObject({
      runId: TRACE,
      replay: false,
      speed: 1,
      attached: false,
      ascii: false,
      color: true,
    });
    expect(r.calls[0]?.directory.endsWith(join('.indaba', 'traces'))).toBe(true);
    expect(r.code).toBe(0);
    expect(r.out).toBe('');
  });

  it('passes replay, speed and ascii on, and the code of a failed run through', async () => {
    const r = await watchWith([TRACE, '--replay', '--speed', '10', '--ascii'], fakeTui(1));
    expect(r.calls[0]).toMatchObject({ replay: true, speed: 10, ascii: true });
    expect(r.code).toBe(1);
  });

  it('turns colour off for NO_COLOR', async () => {
    const r = await watchWith([TRACE], fakeTui(0), { env: { NO_COLOR: '1' } });
    expect(r.calls[0]?.color).toBe(false);
  });

  it('prints lines instead when asked with --plain or --output', async () => {
    for (const flag of ['--plain', '--output']) {
      const r = await watchWith([TRACE, flag], fakeTui(0));
      expect(r.calls).toHaveLength(0);
      expect(r.out).toContain('completed');
    }
  });

  it('prints lines when there is no terminal, without even loading the dashboard', async () => {
    let loaded = false;
    const r = await watchWith(
      [TRACE],
      () => {
        loaded = true;
        return { missing: 'x' };
      },
      { terminal: false },
    );
    expect(loaded).toBe(false);
    expect(r.out).toContain('completed');
    expect(r.err).toBe('');
  });

  it('lists the runs as lines, whatever the terminal', async () => {
    const r = await watchWith([], fakeTui(0));
    expect(r.calls).toHaveLength(0);
    expect(r.out).toContain(TRACE);
  });

  it('says how to install the dashboard when it is not there, and prints lines', async () => {
    const r = await watchWith([TRACE], () => ({ missing: 'Cannot find package' }));
    expect(r.err).toContain('npm install @indaba/tui');
    expect(r.out).toContain('completed');
    expect(r.code).toBe(0);
  });

  it('falls back to lines, and says why, when the dashboard throws', async () => {
    const r = await watchWith([TRACE], () => ({
      tui: {
        watch: async () => {
          throw new Error('no raw mode');
        },
      },
    }));
    expect(r.err).toContain('The dashboard failed (no raw mode)');
    expect(r.out).toContain('completed');
  });
});

describe('loadTui', () => {
  it('returns the module when it exports watch', async () => {
    const watch = async () => ({ quit: 'close' as const, code: 0 });
    const loaded = await loadTui(async (name) => {
      expect(name).toBe('@indaba/tui');
      return { watch };
    });
    expect(loaded).toEqual({ tui: { watch } });
  });

  it('reports the package missing, with the reason, when it cannot be loaded', async () => {
    const loaded = await loadTui(async () => {
      throw new Error("Cannot find package '@indaba/tui'");
    });
    expect(loaded).toEqual({ missing: "Cannot find package '@indaba/tui'" });
    expect(await loadTui(async () => Promise.reject('plain string'))).toEqual({ missing: 'plain string' });
  });

  it('reports it missing when what loads has no watch function', async () => {
    const loaded = await loadTui(async () => ({ watch: 3 }));
    expect('missing' in loaded && loaded.missing).toContain('does not export a watch function');
  });

  it('loads for real without throwing, whether or not the package is installed here', async () => {
    const loaded = await loadTui();
    expect('tui' in loaded || 'missing' in loaded).toBe(true);
  });
});
