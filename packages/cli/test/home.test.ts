import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createLogger, type LogRecord, serializeRecord, TraceReader } from '@indaba/engine';
import { describe, expect, it, vi } from 'vitest';
import { homeGate, runHome } from '../src/home.js';
import { type Io, main } from '../src/index.js';
import { loadTui, type TuiHomeOptions, type TuiLoad, type TuiModule } from '../src/tui-loader.js';
import { captureIo, makeTempDir } from './support.js';

const TRACE = 'd'.repeat(32);

async function project(): Promise<string> {
  const dir = await makeTempDir();
  const traces = join(dir, '.indaba', 'traces');
  await mkdir(traces, { recursive: true });
  const records = [
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
  ] as const;
  await writeFile(
    join(traces, `${TRACE}.events.jsonl`),
    records.map((r) => `${serializeRecord(r)}\n`).join(''),
  );
  return dir;
}

/** A terminal that can be put in raw mode, as a real one can. */
const rawTerminal = () => ({
  stdin: Object.assign(new PassThrough(), { setRawMode: () => undefined }),
  stdout: new PassThrough(),
});

interface Setup {
  readonly calls: TuiHomeOptions[];
  readonly loads: number;
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function bare(
  load: (calls: TuiHomeOptions[]) => TuiLoad,
  extra: {
    terminal?: Io['terminal'] | false;
    env?: Record<string, string | undefined>;
    signal?: AbortSignal;
  } = {},
): Promise<Setup> {
  const dir = await project();
  const calls: TuiHomeOptions[] = [];
  let loads = 0;
  const captured = captureIo(dir, extra.env ?? {}, extra.signal);
  const terminal = extra.terminal === false ? {} : { terminal: extra.terminal ?? rawTerminal() };
  const io: Io = {
    ...captured.io,
    ...terminal,
    loadTui: async () => {
      loads += 1;
      return load(calls);
    },
  };
  const code = await main([], io);
  return { calls, loads, code, out: captured.stdout(), err: captured.stderr() };
}

const homeTui =
  (result: { quit: 'close' | 'detach' | 'cancel'; code: number } = { quit: 'close', code: 0 }) =>
  (calls: TuiHomeOptions[]): TuiLoad => ({
    tui: {
      watch: async () => ({ quit: 'close', code: 0 }),
      run: async (options) => {
        calls.push(options);
        return result;
      },
    },
  });

/** What bare `indaba` writes today, with no terminal at all. */
async function today(): Promise<{ code: number; err: string; out: string }> {
  const captured = captureIo(await makeTempDir());
  const code = await main([], captured.io);
  return { code, err: captured.stderr(), out: captured.stdout() };
}

describe('bare indaba: the gate of Home (specs/tui-home)', () => {
  it('is the usage error it has always been without a terminal, and never loads the tui (AC-02)', async () => {
    const baseline = await today();
    expect(baseline.code).toBe(2);
    expect(baseline.err).toContain('No command given.');
    const r = await bare(homeTui(), { terminal: false });
    expect({ code: r.code, err: r.err, out: r.out }).toEqual(baseline);
    expect(r.loads).toBe(0);
    expect(r.calls).toHaveLength(0);
  });

  it('is the same with INDABA_NO_TUI=1 on a terminal (AC-02)', async () => {
    const baseline = await today();
    const r = await bare(homeTui(), { env: { INDABA_NO_TUI: '1' } });
    expect({ code: r.code, err: r.err, out: r.out }).toEqual(baseline);
    expect(r.loads).toBe(0);
  });

  it.each(['0', '', 'true', 'yes'])(
    'opens Home when INDABA_NO_TUI is %j: only the exact 1 turns it off',
    async (value) => {
      const r = await bare(homeTui(), { env: { INDABA_NO_TUI: value } });
      expect(r.calls).toHaveLength(1);
      expect(r.code).toBe(0);
    },
  );

  it('opens Home on a terminal and returns its exit status', async () => {
    const r = await bare(homeTui());
    expect(r.calls).toHaveLength(1);
    expect(r.code).toBe(0);
    expect(r.out).toBe('');
    expect(r.err).toBe('');
  });

  it.each([
    [{ quit: 'close', code: 0 } as const, 0],
    [{ quit: 'close', code: 1 } as const, 1],
    [{ quit: 'cancel', code: 130 } as const, 130],
  ])('returns the status %j of Home as the exit status', async (result, expected) => {
    expect((await bare(homeTui(result))).code).toBe(expected);
  });

  it('refuses a terminal that cannot be put in raw mode, names the plain command, and exits 1 (AC-08)', async () => {
    const r = await bare(homeTui(), { terminal: { stdin: new PassThrough(), stdout: new PassThrough() } });
    expect(r.code).toBe(1);
    expect(r.err).toContain('raw mode');
    expect(r.err).toContain('indaba watch --plain');
    expect(r.err).not.toContain('No command given.');
    expect(r.loads).toBe(0);
    expect(r.calls).toHaveLength(0);
  });

  it('says on one line that @indaba/tui could not be loaded, then gives the usage error (AC-02)', async () => {
    const baseline = await today();
    const r = await bare(() => ({ missing: 'Cannot find package' }));
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      `The home screen (@indaba/tui) could not be loaded (Cannot find package).\n${baseline.err}`,
    );
  });

  it('leaves bare indaba exactly as today when an older @indaba/tui has no run (AC-09)', async () => {
    const baseline = await today();
    const old: TuiModule = { watch: async () => ({ quit: 'close', code: 0 }) };
    const r = await bare(() => ({ tui: old }));
    expect({ code: r.code, err: r.err, out: r.out }).toEqual(baseline);
    expect(r.loads).toBe(1);
  });

  it('hands Home the runs of the project, the way indaba watch lists them (AC-07, AC-11)', async () => {
    const r = await bare(homeTui());
    const options = r.calls[0];
    expect(options).toBeDefined();
    const listed = await options?.listRuns();
    expect(listed?.map((run) => run.runId)).toEqual([TRACE]);
    expect(listed?.[0]).toMatchObject({ status: 'completed', workflow: 'demo' });
    const controller = new AbortController();
    const feed = options?.openRun?.(TRACE, controller.signal);
    expect(feed?.source).toBeDefined();
    expect(feed?.board).toBeDefined();
    controller.abort();
  });

  it('passes the colour, ASCII, streams and signal choices of the environment', async () => {
    const terminal = rawTerminal();
    const controller = new AbortController();
    const r = await bare(homeTui(), {
      terminal,
      signal: controller.signal,
      env: { INDABA_ASCII: '1', NO_COLOR: '1' },
    });
    expect(r.calls[0]).toMatchObject({ ascii: true, color: false });
    expect(r.calls[0]?.stdout).toBe(terminal.stdout);
    expect(r.calls[0]?.stdin).toBe(terminal.stdin);
    expect(r.calls[0]?.signal).toBe(controller.signal);
    const plain = await bare(homeTui());
    expect(plain.calls[0]).toMatchObject({ ascii: false, color: true });
    const empty = await bare(homeTui(), { env: { NO_COLOR: '', INDABA_ASCII: '0' } });
    expect(empty.calls[0]).toMatchObject({ ascii: false, color: true });
  });

  it('writes one redacted line and exits 1 when Home throws, and leaves the secret out', async () => {
    // built from fragments so this file holds nothing shaped like a key
    const secret = ['sk', 'live', '0123456789', 'abcdefghij'].join('-');
    const r = await bare(
      () => ({
        tui: {
          watch: async () => ({ quit: 'close', code: 0 }),
          run: async () => {
            throw new Error(`boom with ${secret}`);
          },
        },
      }),
      { env: { OPENROUTER_API_KEY: secret } },
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain('The home screen failed (boom with');
    expect(r.err).not.toContain(secret);
    expect(r.err.trim().split('\n')).toHaveLength(1);
  });

  it('logs the failure with the credential replaced, as the failure table says', async () => {
    const secret = ['sk', 'live', '0123456789', 'abcdefghij'].join('-');
    const environment = { OPENROUTER_API_KEY: secret };
    const records: LogRecord[] = [];
    const logger = createLogger({
      sinks: [{ write: (r) => void records.push(r) }],
      clock: () => new Date(0),
    });
    const captured = captureIo(await makeTempDir(), environment);
    const tui: TuiModule & { run: (options: TuiHomeOptions) => Promise<never> } = {
      watch: async () => ({ quit: 'close', code: 0 }),
      run: async () => {
        throw new Error(`boom with ${secret}`);
      },
    };
    const code = await runHome(
      { ...captured.io, terminal: rawTerminal() },
      { kind: 'open', tui, terminal: rawTerminal() },
      logger,
      { ascii: false, color: true, environment },
    );
    expect(code).toBe(1);
    const logged = JSON.stringify(records);
    expect(logged).toContain('the home screen failed');
    expect(logged).toContain('boom with');
    expect(logged).not.toContain(secret);
  });

  it('replaces a credential in an error from reading the runs before the screen can draw it', async () => {
    const secret = ['sk', 'live', '0123456789', 'abcdefghij'].join('-');
    const spy = vi
      .spyOn(TraceReader.prototype, 'listRuns')
      .mockRejectedValue(new Error(`cannot read with ${secret}`));
    try {
      const r = await bare(homeTui(), { env: { OPENROUTER_API_KEY: secret } });
      const options = r.calls[0];
      expect(options).toBeDefined();
      const failure = await options?.listRuns().then(
        () => undefined,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      expect(failure).toContain('cannot read with');
      expect(failure).not.toContain(secret);
    } finally {
      spy.mockRestore();
    }
  });

  it('is not asked for by the commands that have their own behaviour', async () => {
    for (const args of [['--help'], ['--version'], ['validate', '--help']]) {
      const captured = captureIo(await makeTempDir());
      const load = vi.fn(async (): Promise<TuiLoad> => ({ missing: 'unused' }));
      await main(args, { ...captured.io, terminal: rawTerminal(), loadTui: load });
      expect(load).not.toHaveBeenCalled();
    }
  });
});

describe('homeGate', () => {
  it('says usage without a terminal and open with one', async () => {
    const captured = captureIo(await makeTempDir());
    const load = async (): Promise<TuiLoad> => homeTui()([]);
    expect(await homeGate(captured.io, load, false)).toEqual({ kind: 'usage' });
    expect(await homeGate({ ...captured.io, terminal: rawTerminal() }, load, true)).toEqual({
      kind: 'usage',
    });
    const gate = await homeGate({ ...captured.io, terminal: rawTerminal() }, load, false);
    expect(gate.kind).toBe('open');
  });
});

describe('loadTui and run', () => {
  it('accepts a module with watch and no run, so an older @indaba/tui still loads (AC-09)', async () => {
    const loaded = await loadTui(async () => ({ watch: () => undefined }));
    expect('tui' in loaded).toBe(true);
    if ('tui' in loaded) {
      expect(loaded.tui.run).toBeUndefined();
    }
  });

  it('hands on a module that has run', async () => {
    const run = async () => ({ quit: 'close' as const, code: 0 });
    const loaded = await loadTui(async () => ({ watch: () => undefined, run }));
    expect('tui' in loaded && loaded.tui.run === run).toBe(true);
  });
});
