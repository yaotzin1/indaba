import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseRecord,
  type RunRecord,
  serializeRecord,
  summariseRun,
  TraceReader,
  type UnknownRecord,
} from '../src/index.js';
import { makeTempDir } from './support.js';

const AT = '2026-10-05T12:00:00.000Z';
const ROOT = '2'.repeat(16);
const STEP = '3'.repeat(16);

type Writable = Exclude<RunRecord, UnknownRecord>;

const started = (trace: string, span = ROOT, parent?: string): Writable => ({
  type: 'span_started',
  at: AT,
  traceId: trace,
  spanId: span,
  parentSpanId: parent,
  name: span === ROOT ? 'indaba.task t' : 'step s',
  attributes: {},
});

const ended = (trace: string, span = ROOT, status?: string): Writable => ({
  type: 'span_ended',
  at: AT,
  traceId: trace,
  spanId: span,
  status: 'ok',
  statusMessage: undefined,
  attributes: status === undefined ? {} : { 'indaba.workflow.status': status },
  events: [],
});

const output = (trace: string, seq: number, text: string): Writable => ({
  type: 'output',
  at: AT,
  traceId: trace,
  spanId: STEP,
  seq,
  text,
  cut: false,
});

const line = (record: Writable): string => `${serializeRecord(record)}\n`;

async function runFile(dir: string, trace: string, records: Writable[]): Promise<string> {
  const file = join(dir, `${trace}.events.jsonl`);
  await writeFile(file, records.map(line).join(''));
  return file;
}

/** A sleep that, instead of waiting, lets the test do something between two polls of the file. */
function ticks(...steps: (() => Promise<void>)[]): (ms: number, signal?: AbortSignal) => Promise<void> {
  let n = 0;
  return async () => {
    const step = steps[n++];
    if (step === undefined) {
      throw new Error('the reader kept polling after the test had nothing left to do');
    }
    await step();
  };
}

async function collect(source: AsyncIterable<RunRecord>): Promise<RunRecord[]> {
  const out: RunRecord[] = [];
  for await (const record of source) {
    out.push(record);
  }
  return out;
}

describe('TraceReader.readAll', () => {
  it('reads every record of the event file, in order', async () => {
    const dir = await makeTempDir();
    const trace = 'a'.repeat(32);
    await runFile(dir, trace, [
      started(trace),
      started(trace, STEP, ROOT),
      output(trace, 0, 'hi'),
      ended(trace, STEP),
      ended(trace, ROOT, 'COMPLETED'),
    ]);

    const records = await new TraceReader(dir).readAll(trace);
    expect(records.map((r) => r.type)).toEqual([
      'span_started',
      'span_started',
      'output',
      'span_ended',
      'span_ended',
    ]);
  });

  it('leaves out a last line that has no newline yet, because it is still being written', async () => {
    const dir = await makeTempDir();
    const trace = 'b'.repeat(32);
    const file = await runFile(dir, trace, [started(trace)]);
    await appendFile(file, serializeRecord(output(trace, 0, 'half')));

    expect((await new TraceReader(dir).readAll(trace)).map((r) => r.type)).toEqual(['span_started']);
    await appendFile(file, '\n');
    expect((await new TraceReader(dir).readAll(trace)).map((r) => r.type)).toEqual([
      'span_started',
      'output',
    ]);
  });

  it('skips blank lines and keeps a line it does not understand as an unknown record', async () => {
    const dir = await makeTempDir();
    const trace = 'c'.repeat(32);
    await writeFile(
      join(dir, `${trace}.events.jsonl`),
      `\n${line(started(trace))}\nnot json at all\n\n{"type":"mystery"}\n`,
    );

    const records = await new TraceReader(dir).readAll(trace);
    expect(records.map((r) => r.type)).toEqual(['span_started', 'unknown', 'unknown']);
  });

  it('is empty for a run with no files at all', async () => {
    const dir = await makeTempDir();
    expect(await new TraceReader(dir).readAll('d'.repeat(32))).toEqual([]);
    expect(await new TraceReader(join(dir, 'missing')).readAll('d'.repeat(32))).toEqual([]);
  });

  it('reads a run written before the event stream existed, from its trace file', async () => {
    const dir = await makeTempDir();
    const trace = 'e'.repeat(32);
    const spans = [
      {
        trace_id: trace,
        span_id: STEP,
        parent_span_id: ROOT,
        name: 'step s',
        start: AT,
        end: '2026-10-05T12:00:03.000Z',
        status: 'ok',
        attributes: { 'indaba.runner': 'acp' },
        events: [{ name: 'indaba.acp.session', attributes: { n: 1 } }],
      },
      {
        trace_id: trace,
        span_id: ROOT,
        parent_span_id: null,
        name: 'indaba.task t',
        start: AT,
        end: '2026-10-05T12:00:04.000Z',
        status: 'ok',
        attributes: { 'indaba.workflow.status': 'COMPLETED' },
      },
    ];
    await writeFile(
      join(dir, `${trace}.jsonl`),
      `${spans.map((s) => JSON.stringify(s)).join('\n')}\n\nnot json\n[1]\n{"trace_id":1}\n`,
    );

    const records = await new TraceReader(dir).readAll(trace);
    expect(records.map((r) => `${r.type}:${'spanId' in r ? r.spanId : ''}`)).toEqual([
      `span_started:${STEP}`,
      `span_ended:${STEP}`,
      `span_started:${ROOT}`,
      `span_ended:${ROOT}`,
    ]);
    expect(records[0]).toMatchObject({ parentSpanId: ROOT, at: AT });
    expect(records[1]).toMatchObject({
      at: '2026-10-05T12:00:03.000Z',
      events: [{ name: 'indaba.acp.session' }],
    });
    expect(records[2]).toMatchObject({ parentSpanId: undefined });
    expect(summariseRun(records).status).toBe('completed');
  });

  it('prefers the event file when both exist', async () => {
    const dir = await makeTempDir();
    const trace = 'f'.repeat(32);
    await runFile(dir, trace, [started(trace)]);
    await writeFile(
      join(dir, `${trace}.jsonl`),
      `${JSON.stringify({ trace_id: trace, span_id: 'x', name: 'n', start: AT, end: AT, status: 'ok' })}\n`,
    );

    expect(await new TraceReader(dir).readAll(trace)).toHaveLength(1);
  });

  it('refuses a run id that is not lowercase hexadecimal, before it can become a path', async () => {
    const reader = new TraceReader(await makeTempDir());
    for (const bad of ['', '../x', 'A', 'a/b', '..', 'a\\b']) {
      await expect(reader.readAll(bad)).rejects.toThrow(RangeError);
      expect(() => reader.follow(bad).next()).rejects.toThrow(RangeError);
    }
  });
});

describe('TraceReader.follow', () => {
  const trace = '1'.repeat(32);

  it('yields what is there and stops when the root span has ended', async () => {
    const dir = await makeTempDir();
    await runFile(dir, trace, [
      started(trace),
      started(trace, STEP, ROOT),
      ended(trace, STEP),
      ended(trace, ROOT, 'COMPLETED'),
      output(trace, 9, 'after the end'),
    ]);

    const records = await collect(new TraceReader(dir).follow(trace));
    expect(records.map((r) => r.type)).toEqual(['span_started', 'span_started', 'span_ended', 'span_ended']);
  });

  it('waits for a file that does not exist yet, then follows it as lines are added', async () => {
    const dir = await makeTempDir();
    const file = join(dir, `${trace}.events.jsonl`);
    const reader = new TraceReader(dir, {
      sleep: ticks(
        async () => writeFile(file, line(started(trace))),
        async () => appendFile(file, line(output(trace, 0, 'one'))),
        async () => appendFile(file, line(output(trace, 1, 'two')) + line(ended(trace, ROOT, 'FAILED'))),
      ),
    });

    const records = await collect(reader.follow(trace));
    expect(records.map((r) => (r.type === 'output' ? `output:${r.text}` : r.type))).toEqual([
      'span_started',
      'output:one',
      'output:two',
      'span_ended',
    ]);
  });

  it('holds back a line that is only partly written until it is complete', async () => {
    const dir = await makeTempDir();
    const file = await runFile(dir, trace, [started(trace)]);
    const half = serializeRecord(output(trace, 0, 'complete line'));
    const seen: string[] = [];
    const reader = new TraceReader(dir, {
      sleep: ticks(
        async () => appendFile(file, half.slice(0, 20)),
        async () => appendFile(file, `${half.slice(20)}\n`),
        async () => appendFile(file, line(ended(trace, ROOT, 'COMPLETED'))),
      ),
    });

    for await (const record of reader.follow(trace)) {
      seen.push(record.type === 'output' ? `output:${record.text}` : record.type);
    }
    expect(seen).toEqual(['span_started', 'output:complete line', 'span_ended']);
  });

  it('does not split a multi-byte character that arrives in two pieces', async () => {
    const dir = await makeTempDir();
    const file = await runFile(dir, trace, [started(trace)]);
    const bytes = Buffer.from(line(output(trace, 0, 'price: €100 😀')), 'utf8');
    const euro = bytes.indexOf(Buffer.from('€', 'utf8'));
    const reader = new TraceReader(dir, {
      sleep: ticks(
        async () => appendFile(file, bytes.subarray(0, euro + 1)), // the first byte of the euro sign only
        async () => appendFile(file, bytes.subarray(euro + 1)),
        async () => appendFile(file, line(ended(trace, ROOT, 'COMPLETED'))),
      ),
    });

    const records = await collect(reader.follow(trace));
    const text = records.find((r) => r.type === 'output');
    expect(text?.type === 'output' ? text.text : '').toBe('price: €100 😀');
  });

  it('stops when the signal aborts, even with nothing written', async () => {
    const dir = await makeTempDir();
    const controller = new AbortController();
    const reader = new TraceReader(dir, { sleep: ticks(async () => controller.abort()) });

    expect(await collect(reader.follow(trace, controller.signal))).toEqual([]);
  });

  it('stops at once for a signal that is already aborted', async () => {
    const dir = await makeTempDir();
    await runFile(dir, trace, [started(trace)]);
    const controller = new AbortController();
    controller.abort();

    expect(await collect(new TraceReader(dir).follow(trace, controller.signal))).toEqual([]);
  });

  it('starts over when the file is replaced by a shorter one', async () => {
    const dir = await makeTempDir();
    const file = await runFile(dir, trace, [
      started(trace),
      output(trace, 0, 'a long first version of the file'),
    ]);
    const reader = new TraceReader(dir, {
      sleep: ticks(
        async () => writeFile(file, line(started(trace))),
        async () => appendFile(file, line(ended(trace, ROOT, 'COMPLETED'))),
      ),
    });

    const records = await collect(reader.follow(trace));
    expect(records.map((r) => r.type)).toEqual(['span_started', 'output', 'span_started', 'span_ended']);
  });

  it('only a root span ending finishes the run, not a step ending', async () => {
    const dir = await makeTempDir();
    const file = await runFile(dir, trace, [started(trace), started(trace, STEP, ROOT), ended(trace, STEP)]);
    const reader = new TraceReader(dir, {
      sleep: ticks(async () => appendFile(file, line(ended(trace, ROOT, 'COMPLETED')))),
    });

    expect((await collect(reader.follow(trace))).map((r) => r.type)).toEqual([
      'span_started',
      'span_started',
      'span_ended',
      'span_ended',
    ]);
  });

  it('keeps going past lines it does not understand', async () => {
    const dir = await makeTempDir();
    await writeFile(
      join(dir, `${trace}.events.jsonl`),
      `garbage\n${line(started(trace))}{"type":"x"}\n${line(ended(trace, ROOT, 'COMPLETED'))}`,
    );

    expect((await collect(new TraceReader(dir).follow(trace))).map((r) => r.type)).toEqual([
      'unknown',
      'span_started',
      'unknown',
      'span_ended',
    ]);
  });

  it('polls on a timer of its own when none is injected, and honours the interval option', async () => {
    const dir = await makeTempDir();
    const file = join(dir, `${trace}.events.jsonl`);
    setTimeout(() => {
      void writeFile(file, line(started(trace)) + line(ended(trace, ROOT, 'COMPLETED')));
    }, 40);
    const records = await collect(new TraceReader(dir, { pollMs: 10 }).follow(trace));
    expect(records.map((r) => r.type)).toEqual(['span_started', 'span_ended']);
  });
});

describe('summariseRun', () => {
  it('is running until the root span has ended', () => {
    expect(summariseRun([]).status).toBe('running');
    expect(summariseRun([started('a'), started('a', STEP, ROOT), ended('a', STEP)]).status).toBe('running');
  });

  it.each([
    ['COMPLETED', 'completed'],
    ['FAILED', 'failed'],
    ['ESCALATED', 'escalated'],
    ['CANCELLED', 'cancelled'],
    ['SOMETHING_ELSE', 'unknown'],
  ])('reads the workflow status %s as %s', (named, expected) => {
    expect(summariseRun([started('a'), ended('a', ROOT, named)]).status).toBe(expected);
  });

  it('is unknown when the root ended without saying how', () => {
    expect(summariseRun([started('a'), ended('a', ROOT)]).status).toBe('unknown');
  });

  it('takes the start time from the root span', () => {
    expect(summariseRun([started('a')]).startedAt).toBe(AT);
    expect(summariseRun([]).startedAt).toBeUndefined();
    expect(summariseRun([started('a', STEP, ROOT)]).startedAt).toBeUndefined();
  });

  it('ignores a step span that carries a workflow status', () => {
    expect(summariseRun([started('a'), started('a', STEP, ROOT), ended('a', STEP, 'FAILED')]).status).toBe(
      'running',
    );
  });
});

describe('TraceReader.listRuns', () => {
  it('lists each run once, with its status, newest first', async () => {
    const dir = await makeTempDir();
    const old = '1'.repeat(32);
    const middle = '2'.repeat(32);
    const live = '3'.repeat(32);
    await runFile(dir, old, [started(old), ended(old, ROOT, 'FAILED')]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await runFile(dir, middle, [started(middle), ended(middle, ROOT, 'COMPLETED')]);
    await writeFile(join(dir, `${middle}.jsonl`), '');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await runFile(dir, live, [started(live)]);

    const runs = await new TraceReader(dir).listRuns();
    expect(runs.map((r) => [r.runId, r.status])).toEqual([
      [live, 'running'],
      [middle, 'completed'],
      [old, 'failed'],
    ]);
    expect(runs[0]?.startedAt).toBe(AT);
  });

  it('lists a run that has only a trace file, and ignores everything that is not a run', async () => {
    const dir = await makeTempDir();
    const legacy = 'a'.repeat(32);
    await writeFile(
      join(dir, `${legacy}.jsonl`),
      `${JSON.stringify({ trace_id: legacy, span_id: ROOT, parent_span_id: null, name: 'indaba.task t', start: AT, end: AT, status: 'ok', attributes: { 'indaba.workflow.status': 'ESCALATED' } })}\n`,
    );
    await writeFile(join(dir, 'notes.jsonl'), 'x');
    await writeFile(join(dir, 'README.md'), 'x');
    await writeFile(join(dir, `${'B'.repeat(32)}.jsonl`), 'x');
    await writeFile(join(dir, `${legacy}.jsonl.bak`), 'x');
    await mkdir(join(dir, `${'c'.repeat(32)}.jsonl`));

    const runs = await new TraceReader(dir).listRuns();
    expect(runs.map((r) => [r.runId, r.status])).toEqual([[legacy, 'escalated']]);
  });

  it('is empty for a directory that does not exist, or has nothing in it', async () => {
    const dir = await makeTempDir();
    expect(await new TraceReader(join(dir, 'nope')).listRuns()).toEqual([]);
    expect(await new TraceReader(dir).listRuns()).toEqual([]);
  });

  it('keeps a stable order for runs written in the same instant', async () => {
    const dir = await makeTempDir();
    const a = '1'.repeat(32);
    const b = '2'.repeat(32);
    await runFile(dir, a, [started(a)]);
    await runFile(dir, b, [started(b)]);
    const first = await new TraceReader(dir).listRuns();
    const second = await new TraceReader(dir).listRuns();
    expect(second).toEqual(first);
    expect(first).toHaveLength(2);
  });

  it('reads a renamed file under its new name only', async () => {
    const dir = await makeTempDir();
    const a = '1'.repeat(32);
    const b = '9'.repeat(32);
    await runFile(dir, a, [started(a)]);
    await rename(join(dir, `${a}.events.jsonl`), join(dir, `${b}.events.jsonl`));
    expect((await new TraceReader(dir).listRuns()).map((r) => r.runId)).toEqual([b]);
  });

  it('parses the same records readAll returns', async () => {
    const dir = await makeTempDir();
    const a = '1'.repeat(32);
    await runFile(dir, a, [started(a)]);
    const [record] = await new TraceReader(dir).readAll(a);
    expect(record).toEqual(parseRecord(serializeRecord(started(a))));
  });
});

describe('TraceReader: what it will not accept', () => {
  it('names the problem when a run id is not lowercase hexadecimal', async () => {
    const reader = new TraceReader(await makeTempDir());
    await expect(reader.readAll('../x')).rejects.toThrow('A run id is lowercase hexadecimal.');
    await expect(reader.follow('A').next()).rejects.toThrow('A run id is lowercase hexadecimal.');
  });

  it('reads an old trace file line by line, skipping what is not a span with an id, a span id and a name', async () => {
    const dir = await makeTempDir();
    const trace = 'e'.repeat(32);
    const good = {
      trace_id: trace,
      span_id: ROOT,
      parent_span_id: null,
      name: 'indaba.task t',
      start: AT,
      end: AT,
      status: 'ok',
    };
    const lines = [
      '   ',
      'null',
      '"text"',
      '42',
      JSON.stringify({ ...good, trace_id: undefined }),
      JSON.stringify({ ...good, span_id: undefined }),
      JSON.stringify({ ...good, name: undefined }),
      JSON.stringify({ ...good, trace_id: 7 }),
      JSON.stringify({ ...good, span_id: 7 }),
      JSON.stringify({ ...good, name: 7 }),
      JSON.stringify(good),
    ];
    await writeFile(join(dir, `${trace}.jsonl`), `${lines.join('\n')}\n`);

    const records = await new TraceReader(dir).readAll(trace);
    expect(records.map((r) => r.type)).toEqual(['span_started', 'span_ended']);
  });

  it('ends a span that carries no end, or a malformed one, at the time it started', async () => {
    const dir = await makeTempDir();
    const trace = 'e'.repeat(32);
    const base = { trace_id: trace, parent_span_id: null, name: 'indaba.task t', start: AT, status: 'ok' };
    await writeFile(
      join(dir, `${trace}.jsonl`),
      `${JSON.stringify({ ...base, span_id: ROOT })}\n${JSON.stringify({ ...base, span_id: STEP, end: 5 })}\n`,
    );

    const records = await new TraceReader(dir).readAll(trace);
    expect(records.filter((r) => r.type === 'span_ended').map((r) => ('at' in r ? r.at : ''))).toEqual([
      AT,
      AT,
    ]);
  });

  it('lists only files named exactly like a run: nothing before the id, nothing after the extension', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, `z${'a'.repeat(32)}.jsonl`), 'x');
    await writeFile(join(dir, `${'d'.repeat(32)}.jsonl.bak`), 'x');
    await writeFile(join(dir, `${'e'.repeat(32)}.events.jsonl.old`), 'x');
    await writeFile(join(dir, `${'1'.repeat(32)}.jsonl`), 'x');

    expect((await new TraceReader(dir).listRuns()).map((r) => r.runId)).toEqual(['1'.repeat(32)]);
  });

  it('reports a directory it cannot read, instead of pretending there are no runs', async () => {
    const dir = await makeTempDir();
    const notADirectory = join(dir, 'file');
    await writeFile(notADirectory, 'x');

    await expect(new TraceReader(notADirectory).listRuns()).rejects.toThrow();
  });
});
