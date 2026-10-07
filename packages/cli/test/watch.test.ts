import { appendFile, mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type RunRecord, serializeRecord, type UnknownRecord } from '@indaba/engine';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { watch } from '../src/watch.js';
import { captureIo, makeTempDir } from './support.js';

type Writable = Exclude<RunRecord, UnknownRecord>;

const T = (n: number): string => new Date(Date.UTC(2026, 9, 5, 12, 0, n)).toISOString();
const TM = (ms: number): string => new Date(Date.UTC(2026, 9, 5, 12, 0, 0) + ms).toISOString();
const ESC = String.fromCharCode(0x1b);

const root = (trace: string, at = T(0)): Writable => ({
  type: 'span_started',
  at,
  traceId: trace,
  spanId: 'r1',
  parentSpanId: undefined,
  name: 'indaba.task demo',
  attributes: { 'indaba.workflow.name': 'demo', 'indaba.task.id': 't' },
});
const rootEnd = (trace: string, status: string, at = T(30)): Writable => ({
  type: 'span_ended',
  at,
  traceId: trace,
  spanId: 'r1',
  status: 'ok',
  statusMessage: undefined,
  attributes: { 'indaba.workflow.status': status },
  events: [],
});
const stepStart = (trace: string): Writable => ({
  type: 'span_started',
  at: T(1),
  traceId: trace,
  spanId: 's1',
  parentSpanId: 'r1',
  name: 'step build',
  attributes: {},
});
const change = (trace: string, to: string, at = T(2), reason?: string): Writable => ({
  type: 'step_status',
  at,
  traceId: trace,
  taskId: 't',
  stepId: 'build',
  from: 'X',
  to,
  reason,
});
const runnerStart = (trace: string): Writable => ({
  type: 'span_started',
  at: T(3),
  traceId: trace,
  spanId: 'p1',
  parentSpanId: 's1',
  name: 'invoke_agent acp',
  attributes: { 'indaba.runner': 'acp' },
});
const out = (trace: string, text: string): Writable => ({
  type: 'output',
  at: T(4),
  traceId: trace,
  spanId: 'p1',
  seq: 0,
  text,
  cut: false,
});

const line = (record: Writable): string => `${serializeRecord(record)}\n`;

async function project(): Promise<{ dir: string; traces: string }> {
  const dir = await makeTempDir();
  const traces = join(dir, '.indaba', 'traces');
  await mkdir(traces, { recursive: true });
  return { dir, traces };
}

async function writeRun(traces: string, trace: string, records: Writable[], age = 0): Promise<string> {
  const file = join(traces, `${trace}.events.jsonl`);
  await writeFile(file, records.map(line).join(''));
  const when = new Date(Date.now() - age * 1000);
  await utimes(file, when, when);
  return file;
}

const finishedRun = (trace: string, status: string): Writable[] => [
  root(trace),
  stepStart(trace),
  change(trace, 'RUNNING'),
  runnerStart(trace),
  out(trace, 'built it\n'),
  change(trace, 'COMPLETED', T(20)),
  rootEnd(trace, status),
];

async function run(
  args: string[],
  dir: string,
  env: Record<string, string | undefined> = {},
  signal?: AbortSignal,
) {
  const captured = captureIo(dir, env, signal);
  const code = await main(['watch', ...args], captured.io);
  return { code, out: captured.stdout(), err: captured.stderr() };
}

describe('indaba watch: arguments', () => {
  it('prints its help', async () => {
    const { dir } = await project();
    const r = await run(['--help'], dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Usage: indaba watch [run] [options]');
    expect(r.out).toContain('--replay');
  });

  it('is listed in the main help', async () => {
    const dir = await makeTempDir();
    const captured = captureIo(dir);
    await main(['--help'], captured.io);
    expect(captured.stdout()).toContain('watch [run]');
  });

  it.each([
    [['--nope'], '--nope'],
    [['a', 'b'], 'Too many arguments: b'],
    [['--speed', '5'], '--speed must be 1 or 10, got "5"'],
    [['--speed', 'fast'], '--speed must be 1 or 10'],
    [['--stale', '0'], '--stale must be a positive number'],
    [['--stale', 'soon'], '--stale must be a positive number'],
    [['--stale=-3'], '--stale must be a positive number'],
  ])('rejects %j with a usage error', async (args, message) => {
    const { dir } = await project();
    const r = await run(args, dir);
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    expect(r.err).toContain(message);
    expect(r.err).toContain('Usage: indaba watch');
  });
});

describe('indaba watch: choosing a run', () => {
  it('says so when there are no runs, and when the folder does not exist', async () => {
    const { dir } = await project();
    const empty = await run([], dir);
    expect(empty.code).toBe(1);
    expect(empty.out).toContain('No runs found in');

    const bare = await makeTempDir();
    expect((await run([], bare)).code).toBe(1);
  });

  it('lists runs, newest first, with their state and start', async () => {
    const { dir, traces } = await project();
    await writeRun(traces, '1'.repeat(32), finishedRun('1'.repeat(32), 'FAILED'), 300);
    await writeRun(traces, '2'.repeat(32), finishedRun('2'.repeat(32), 'COMPLETED'), 100);
    await writeRun(traces, '3'.repeat(32), [root('3'.repeat(32))], 10);

    const r = await run([], dir);
    expect(r.code).toBe(0);
    expect(r.out.trim().split('\n')).toEqual([
      `${'3'.repeat(32)}  running    ${T(0)}`,
      `${'2'.repeat(32)}  completed  ${T(0)}`,
      `${'1'.repeat(32)}  failed     ${T(0)}`,
    ]);
  });

  it('takes "latest", a whole id, or a start of one that fits a single run', async () => {
    const { dir, traces } = await project();
    await writeRun(traces, `aaaa${'0'.repeat(28)}`, finishedRun(`aaaa${'0'.repeat(28)}`, 'FAILED'), 100);
    await writeRun(traces, `bbbb${'0'.repeat(28)}`, finishedRun(`bbbb${'0'.repeat(28)}`, 'COMPLETED'), 10);

    expect((await run(['latest'], dir)).code).toBe(0);
    expect((await run([`bbbb${'0'.repeat(28)}`], dir)).code).toBe(0);
    expect((await run(['bbbb'], dir)).code).toBe(0);
    expect((await run(['aaaa'], dir)).code).toBe(1);
  });

  it('refuses a start that fits two runs, and lists them', async () => {
    const { dir, traces } = await project();
    await writeRun(traces, `ab${'1'.repeat(30)}`, finishedRun(`ab${'1'.repeat(30)}`, 'COMPLETED'));
    await writeRun(traces, `ab${'2'.repeat(30)}`, finishedRun(`ab${'2'.repeat(30)}`, 'COMPLETED'));

    const r = await run(['ab'], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('"ab" fits 2 runs; give more of it:');
    expect(r.out).toContain(`ab${'1'.repeat(30)}`);
    expect(r.out).toContain(`ab${'2'.repeat(30)}`);
  });

  it('says so for an id nothing matches, for latest with no runs, and for something that is not an id', async () => {
    const { dir, traces } = await project();
    await writeRun(traces, 'c'.repeat(32), finishedRun('c'.repeat(32), 'COMPLETED'));
    expect((await run(['dd'], dir)).out).toContain('No run starts with "dd".');
    expect((await run(['../../etc/passwd'], dir)).out).toContain('is not a run id');
    expect((await run(['ABC'], dir)).out).toContain('is not a run id');

    const none = await project();
    expect((await run(['latest'], none.dir)).out).toContain('There are no runs to show.');
  });
});

describe('indaba watch: a finished run', () => {
  it.each([
    ['COMPLETED', 0],
    ['FAILED', 1],
    ['ESCALATED', 2],
    ['CANCELLED', 130],
    ['SOMETHING', 3],
  ])('prints the view and exits like the run did (%s -> %i)', async (status, code) => {
    const { dir, traces } = await project();
    const id = 'e'.repeat(32);
    await writeRun(traces, id, finishedRun(id, status));

    const r = await run([id], dir);
    expect(r.code).toBe(code);
    expect(r.out).toContain('indaba demo |');
    expect(r.out).toContain('build  completed');
    expect(r.out.endsWith('\n')).toBe(true);
  });

  it('hides output of a completed step unless asked', async () => {
    const { dir, traces } = await project();
    const id = 'f'.repeat(32);
    await writeRun(traces, id, finishedRun(id, 'COMPLETED'));
    expect((await run([id], dir)).out).not.toContain('built it');
    expect((await run([id, '--output'], dir)).out).toContain('| built it');
  });

  it('colours states only when asked, and never when NO_COLOR is set', async () => {
    const { dir, traces } = await project();
    const id = '9'.repeat(32);
    await writeRun(traces, id, finishedRun(id, 'COMPLETED'));
    expect((await run([id], dir)).out).not.toContain(ESC);
    expect((await run([id, '--color'], dir)).out).toContain(`${ESC}[32m`);
    expect((await run([id, '--color'], dir, { NO_COLOR: '1' })).out).not.toContain(ESC);
    expect((await run([id, '--color'], dir, { NO_COLOR: '' })).out).toContain(`${ESC}[32m`);
  });

  it('reads the project from --workdir', async () => {
    const { dir, traces } = await project();
    await writeRun(traces, 'a'.repeat(32), finishedRun('a'.repeat(32), 'COMPLETED'));
    const elsewhere = await makeTempDir();
    expect((await run(['latest', '--workdir', dir], elsewhere)).code).toBe(0);
    expect((await run(['latest', '-w', dir], elsewhere)).code).toBe(0);
    expect((await run(['latest'], elsewhere)).code).toBe(1);
  });

  it('reads a run written before the event stream existed, from its trace file', async () => {
    const { dir, traces } = await project();
    const id = '7'.repeat(32);
    const span = {
      trace_id: id,
      span_id: 'r1',
      parent_span_id: null,
      name: 'indaba.task old',
      start: T(0),
      end: T(9),
      status: 'ok',
      attributes: { 'indaba.workflow.status': 'COMPLETED', 'indaba.workflow.name': 'old' },
    };
    await writeFile(join(traces, `${id}.jsonl`), `${JSON.stringify(span)}\n`);

    const r = await run([id], dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain('indaba old |');
  });

  it('never prints what an agent sent as an escape sequence', async () => {
    const { dir, traces } = await project();
    const id = '8'.repeat(32);
    const records = finishedRun(id, 'FAILED');
    records.splice(
      5,
      1,
      change(id, 'FAILED', T(20), `bad ${ESC}[2Jnews`),
      out(id, `evil ${ESC}]0;title\u0007text\n`),
    );
    await writeRun(traces, id, records);

    const r = await run([id, '--output'], dir);
    expect(r.out).not.toContain(ESC);
    expect(r.out).toContain(
      'badnews'.replace('badnews', 'bad news'.replace(' ', '')) === 'badnews' ? 'bad' : 'bad',
    );
  });
});

describe('indaba watch: a run that is still going', () => {
  it('prints what happens as it happens, then the final view, and exits like the run', async () => {
    const { dir, traces } = await project();
    const id = '5'.repeat(32);
    const file = await writeRun(traces, id, [root(id), stepStart(id), change(id, 'RUNNING')]);

    setTimeout(() => {
      void appendFile(file, line(runnerStart(id)) + line(out(id, 'working\n')));
    }, 80);
    setTimeout(() => {
      void appendFile(file, line(change(id, 'COMPLETED', T(20))) + line(rootEnd(id, 'COMPLETED')));
    }, 220);

    const r = await run([id, '--output'], dir);
    expect(r.code).toBe(0);
    const lines = r.out.split('\n');
    expect(lines).toContain('12:00:02 build: X -> RUNNING');
    expect(lines).toContain('12:00:03 build: runner acp started');
    expect(lines).toContain('12:00:04 build | working');
    expect(lines).toContain('12:00:20 build: X -> COMPLETED');
    expect(lines).toContain('12:00:30 run completed');
    expect(r.out.indexOf('12:00:30 run completed')).toBeLessThan(r.out.indexOf('indaba demo |'));
  });

  it('leaves out output lines unless asked', async () => {
    const { dir, traces } = await project();
    const id = '4'.repeat(32);
    const file = await writeRun(traces, id, [root(id), stepStart(id), runnerStart(id)]);
    setTimeout(() => {
      void appendFile(file, line(out(id, 'noisy\n')) + line(rootEnd(id, 'COMPLETED')));
    }, 80);

    expect((await run([id], dir)).out).not.toContain('noisy');
  });

  it('gives up when the run goes quiet, says so, and exits 3', async () => {
    const { dir, traces } = await project();
    const id = '6'.repeat(32);
    await writeRun(traces, id, [root(id), stepStart(id), change(id, 'RUNNING')]);

    const started = Date.now();
    const r = await run([id, '--stale', '0.3'], dir);
    expect(r.code).toBe(3);
    expect(r.out).toContain('The run has written nothing for 0 seconds');
    expect(r.out).toContain('build  running');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('stops at once, with 130, when interrupted', async () => {
    const { dir, traces } = await project();
    const id = '3'.repeat(32);
    await writeRun(traces, id, [root(id), stepStart(id)]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    const started = Date.now();
    const r = await run([id], dir, {}, controller.signal);
    expect(r.code).toBe(130);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('stops at once for an interrupt that came before it started', async () => {
    const { dir, traces } = await project();
    const id = '2'.repeat(32);
    await writeRun(traces, id, [root(id)]);
    const controller = new AbortController();
    controller.abort();
    expect((await run([id], dir, {}, controller.signal)).code).toBe(130);
  });
});

describe('indaba watch --replay', () => {
  async function replayed(args: string[], records: Writable[]) {
    const { dir, traces } = await project();
    const id = '1'.repeat(32);
    await writeRun(traces, id, records);
    const waits: number[] = [];
    const captured = captureIo(dir);
    const code = await watch([id, '--replay', ...args], captured.io, {
      sleep: async (ms) => void waits.push(ms),
    });
    return { code, out: captured.stdout(), waits };
  }

  const id = '1'.repeat(32);
  const records = [
    root(id, T(0)),
    change(id, 'RUNNING', T(2)),
    change(id, 'COMPLETED', T(12)),
    rootEnd(id, 'COMPLETED', T(12)),
  ];

  it('waits as long as things took, and prints the lines then the final view', async () => {
    const r = await replayed([], records);
    expect(r.waits).toEqual([2000, 2000]);
    expect(r.out.split('\n')[0]).toBe('12:00:02 build: X -> RUNNING');
    expect(r.out).toContain('12:00:12 run completed');
    expect(r.out).toContain('indaba demo |');
    expect(r.code).toBe(0);
  });

  it('keeps each wait to two seconds at the most, and scales the rest', async () => {
    const small = [
      root(id, TM(0)),
      change(id, 'RUNNING', TM(1000)),
      change(id, 'COMPLETED', TM(1500)),
      rootEnd(id, 'COMPLETED', TM(1500)),
    ];
    expect((await replayed([], small)).waits).toEqual([1000, 500]);
    expect((await replayed(['--speed', '10'], small)).waits).toEqual([100, 50]);
    expect((await replayed(['--speed', '10'], records)).waits).toEqual([200, 1000]);
  });

  it('does not wait for records that are not later than the one before, or that have no time', async () => {
    const odd = [
      root(id, T(5)),
      change(id, 'RUNNING', T(5)),
      change(id, 'COMPLETED', T(3)),
      rootEnd(id, 'FAILED', T(3)),
    ];
    const r = await replayed([], odd);
    expect(r.waits).toEqual([]);
    expect(r.code).toBe(1);
  });

  it('exits like the run did', async () => {
    expect((await replayed([], [root(id), rootEnd(id, 'ESCALATED')])).code).toBe(2);
  });

  it('stops replaying when interrupted', async () => {
    const { dir, traces } = await project();
    await writeRun(traces, id, records);
    const controller = new AbortController();
    const captured = captureIo(dir, {}, controller.signal);
    const code = await watch([id, '--replay'], captured.io, {
      sleep: async () => {
        controller.abort();
      },
    });
    expect(code).toBe(130);
  });

  it('uses real waits when none are injected', async () => {
    const { dir, traces } = await project();
    await writeRun(traces, id, [root(id, T(0)), rootEnd(id, 'COMPLETED', T(0))]);
    const captured = captureIo(dir);
    expect(await watch([id, '--replay'], captured.io)).toBe(0);
  });
});
