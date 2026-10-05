import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Span,
  SpanEnded,
  SpanStarted,
  SpanStatus,
  StepOutput,
  StepStatus,
  StepStatusChanged,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_RECORD_CHARS,
  DEFAULT_MAX_RUN_CHARS,
  parseRecord,
  RunEventWriter,
  type RunRecord,
} from '../src/index.js';
import { FixedClock, makeTempDir } from './support.js';

const TRACE = '1'.repeat(32);
const ROOT = '2'.repeat(16);
const CHILD = '3'.repeat(16);

function root(trace = TRACE): Span {
  return new Span(trace, ROOT, undefined, 'indaba.task t', new Date('2026-10-05T12:00:00.000Z'), {
    'indaba.task.id': 'task-1',
  });
}

function child(): Span {
  return new Span(TRACE, CHILD, ROOT, 'step build', new Date('2026-10-05T12:00:01.000Z'), {
    'indaba.runner': 'acp',
  });
}

async function lines(dir: string, trace = TRACE): Promise<RunRecord[]> {
  const text = await readFile(join(dir, `${trace}.events.jsonl`), 'utf8');
  expect(text.endsWith('\n')).toBe(true);
  return text.trim().split('\n').map(parseRecord);
}

function writer(
  dir: string,
  extra: Partial<ConstructorParameters<typeof RunEventWriter>[0]> = {},
): RunEventWriter {
  return new RunEventWriter({ directory: dir, clock: new FixedClock(), ...extra });
}

describe('RunEventWriter: what it writes', () => {
  it('writes span starts and ends, step changes and output, whole lines, in the order they happened', async () => {
    const dir = await makeTempDir();
    const w = writer(dir);
    const r = root();
    const c = child();

    void w.onSpanStarted(new SpanStarted(r));
    void w.onStepStatus(new StepStatusChanged('task-1', 'build', StepStatus.Pending, StepStatus.Running));
    void w.onSpanStarted(new SpanStarted(c));
    void w.onOutput(new StepOutput(TRACE, CHILD, 0, 'hello '));
    void w.onOutput(new StepOutput(TRACE, CHILD, 1, 'world\n'));
    c.addEvent('indaba.runner.skipped', { 'indaba.runner': 'api' });
    c.end(new Date('2026-10-05T12:00:05.000Z'), SpanStatus.Ok);
    void w.onSpanEnded(new SpanEnded(c));
    r.setAttribute('indaba.workflow.status', 'COMPLETED');
    r.end(new Date('2026-10-05T12:00:06.000Z'), SpanStatus.Ok);
    await w.onSpanEnded(new SpanEnded(r));

    const records = await lines(dir);
    expect(records.map((x) => x.type)).toEqual([
      'span_started',
      'step_status',
      'span_started',
      'output',
      'output',
      'span_ended',
      'span_ended',
    ]);
    expect(records[0]).toMatchObject({ spanId: ROOT, parentSpanId: undefined, name: 'indaba.task t' });
    expect(records[1]).toMatchObject({ taskId: 'task-1', stepId: 'build', from: 'PENDING', to: 'RUNNING' });
    expect(records[2]).toMatchObject({
      spanId: CHILD,
      parentSpanId: ROOT,
      attributes: { 'indaba.runner': 'acp' },
    });
    expect(
      records.filter((x) => x.type === 'output').map((x) => (x.type === 'output' ? [x.seq, x.text] : [])),
    ).toEqual([
      [0, 'hello '],
      [1, 'world\n'],
    ]);
    expect(records[5]).toMatchObject({
      spanId: CHILD,
      status: 'ok',
      at: '2026-10-05T12:00:05.000Z',
      events: [{ name: 'indaba.runner.skipped', attributes: { 'indaba.runner': 'api' } }],
    });
    expect(records[6]).toMatchObject({ attributes: { 'indaba.workflow.status': 'COMPLETED' } });
  });

  it('stamps step changes and output with the injected clock', async () => {
    const dir = await makeTempDir();
    const w = writer(dir);
    await w.onSpanStarted(new SpanStarted(root()));
    await w.onStepStatus(new StepStatusChanged('task-1', 's', StepStatus.Pending, StepStatus.Running, 'why'));
    await w.onOutput(new StepOutput(TRACE, CHILD, 0, 'x'));

    const records = await lines(dir);
    expect(records[1]).toMatchObject({ at: '2026-01-01T00:00:00.000Z', reason: 'why' });
    expect(records[2]).toMatchObject({ at: '2026-01-01T00:00:00.000Z' });
  });

  it('keeps the order of lines even when events arrive faster than the disk takes them', async () => {
    const dir = await makeTempDir();
    const w = writer(dir);
    await w.onSpanStarted(new SpanStarted(root()));
    for (let i = 0; i < 200; i++) {
      void w.onOutput(new StepOutput(TRACE, CHILD, i, `chunk ${i}\n`));
    }
    await w.flush();

    const seqs = (await lines(dir)).flatMap((x) => (x.type === 'output' ? [x.seq] : []));
    expect(seqs).toEqual(Array.from({ length: 200 }, (_, i) => i));
  });

  it('puts each run in its own file, named by the trace id, and writes nothing else', async () => {
    const dir = await makeTempDir();
    const w = writer(dir);
    const other = '4'.repeat(32);
    await w.onSpanStarted(new SpanStarted(root()));
    await w.onSpanStarted(new SpanStarted(root(other)));
    await w.flush();

    expect((await readdir(dir)).sort()).toEqual([`${TRACE}.events.jsonl`, `${other}.events.jsonl`]);
  });

  it('creates the directory, and its parents, when it does not exist', async () => {
    const base = await makeTempDir();
    const dir = join(base, 'a', 'b', 'traces');
    const w = writer(dir);
    await w.onSpanStarted(new SpanStarted(root()));
    expect(await readdir(dir)).toEqual([`${TRACE}.events.jsonl`]);
  });

  it('drops a step change for a task whose root span it never saw', async () => {
    const dir = await makeTempDir();
    const w = writer(dir);
    await w.onSpanStarted(new SpanStarted(root()));
    await w.onStepStatus(
      new StepStatusChanged('some-other-task', 's', StepStatus.Pending, StepStatus.Running),
    );

    expect((await lines(dir)).map((x) => x.type)).toEqual(['span_started']);
  });

  it('learns a task only from a root span, not from a child that carries the same attribute', async () => {
    const dir = await makeTempDir();
    const w = writer(dir);
    const sneaky = new Span(TRACE, CHILD, ROOT, 'step x', new Date(0), { 'indaba.task.id': 'task-9' });
    await w.onSpanStarted(new SpanStarted(sneaky));
    await w.onStepStatus(new StepStatusChanged('task-9', 's', StepStatus.Pending, StepStatus.Running));

    expect((await lines(dir)).map((x) => x.type)).toEqual(['span_started']);
  });

  it('ignores a root span whose task id is not a string', async () => {
    const dir = await makeTempDir();
    const w = writer(dir);
    const odd = new Span(TRACE, ROOT, undefined, 'indaba.task t', new Date(0), { 'indaba.task.id': 7 });
    await w.onSpanStarted(new SpanStarted(odd));
    await w.onStepStatus(new StepStatusChanged('7', 's', StepStatus.Pending, StepStatus.Running));

    expect((await lines(dir)).map((x) => x.type)).toEqual(['span_started']);
  });

  it('refuses a trace id that is not plain hexadecimal, since it names a file', async () => {
    const dir = await makeTempDir();
    const w = writer(dir);
    for (const bad of ['../escape', 'ABC', 'a/b', '']) {
      await w.onSpanStarted(new SpanStarted(root(bad)));
      await w.onOutput(new StepOutput(bad, CHILD, 0, 'x'));
    }
    expect(await readdir(dir).catch(() => [])).toEqual([]);
  });
});

describe('RunEventWriter: output', () => {
  it('redacts every chunk before it is stored', async () => {
    const dir = await makeTempDir();
    const secret = ['sk', 'live', 'abcdef123456'].join('-');
    const w = writer(dir, { redact: (text) => text.replaceAll(secret, '[redacted]') });
    await w.onOutput(new StepOutput(TRACE, CHILD, 0, `the key is ${secret}, really`));

    const [record] = await lines(dir);
    expect(record).toMatchObject({ type: 'output', text: 'the key is [redacted], really' });
    expect(await readFile(join(dir, `${TRACE}.events.jsonl`), 'utf8')).not.toContain(secret);
  });

  it('stores nothing, and tells onError once, when redaction fails', async () => {
    const dir = await makeTempDir();
    const errors: unknown[] = [];
    const w = writer(dir, {
      redact: () => {
        throw new Error('redactor broke');
      },
      onError: (e) => errors.push(e),
    });
    await w.onOutput(new StepOutput(TRACE, CHILD, 0, 'secret text'));
    await w.onOutput(new StepOutput(TRACE, CHILD, 1, 'more'));

    expect(errors).toHaveLength(1);
    expect(await readdir(dir).catch(() => [])).toEqual([]);
  });

  it('cuts text longer than one record may be, and says so; text of exactly that length is not cut', async () => {
    const dir = await makeTempDir();
    const w = writer(dir, { maxRecordChars: 10 });
    await w.onOutput(new StepOutput(TRACE, CHILD, 0, 'x'.repeat(10)));
    await w.onOutput(new StepOutput(TRACE, CHILD, 1, 'y'.repeat(11)));

    const [exact, longer] = await lines(dir);
    expect(exact).toMatchObject({ text: 'x'.repeat(10), cut: false });
    expect(longer).toMatchObject({ text: 'y'.repeat(10), cut: true });
  });

  it('allows 4096 characters a record and 2 MiB a run unless told otherwise', () => {
    expect(DEFAULT_MAX_RECORD_CHARS).toBe(4096);
    expect(DEFAULT_MAX_RUN_CHARS).toBe(2 * 1024 * 1024);
  });

  it('stores output up to the run allowance, then one truncated record, then nothing', async () => {
    const dir = await makeTempDir();
    const w = writer(dir, { maxRunChars: 10 });
    await w.onOutput(new StepOutput(TRACE, CHILD, 0, 'aaaaa'));
    await w.onOutput(new StepOutput(TRACE, CHILD, 1, 'bbbbb')); // exactly uses the allowance
    await w.onOutput(new StepOutput(TRACE, CHILD, 2, 'c')); // one over
    await w.onOutput(new StepOutput(TRACE, CHILD, 3, 'd'));
    await w.onOutput(new StepOutput(TRACE, CHILD, 4, 'e'));

    const records = await lines(dir);
    expect(records.map((x) => x.type)).toEqual(['output', 'output', 'truncated']);
    expect(records[2]).toMatchObject({ spanId: CHILD });
  });

  it('keeps the allowance per run, so one run running out does not silence another', async () => {
    const dir = await makeTempDir();
    const w = writer(dir, { maxRunChars: 3 });
    const other = '5'.repeat(32);
    await w.onOutput(new StepOutput(TRACE, CHILD, 0, 'aaaa'));
    await w.onOutput(new StepOutput(other, CHILD, 0, 'bbb'));

    expect((await lines(dir, TRACE)).map((x) => x.type)).toEqual(['truncated']);
    expect((await lines(dir, other)).map((x) => x.type)).toEqual(['output']);
  });

  it('counts redacted text against the allowance, not what the agent printed', async () => {
    const dir = await makeTempDir();
    const w = writer(dir, { maxRunChars: 5, redact: () => 'abc' });
    await w.onOutput(new StepOutput(TRACE, CHILD, 0, 'a very long secret-bearing chunk'));

    expect((await lines(dir)).map((x) => x.type)).toEqual(['output']);
  });
});

describe('RunEventWriter: failure is never the run’s problem', () => {
  it('reports the first failure to write once and never throws', async () => {
    const dir = await makeTempDir();
    const blocker = join(dir, 'blocker');
    await writeFile(blocker, 'a file where a directory should be');
    const errors: unknown[] = [];
    const w = writer(join(blocker, 'traces'), { onError: (e) => errors.push(e) });

    await expect(w.onSpanStarted(new SpanStarted(root()))).resolves.toBeUndefined();
    await expect(w.onOutput(new StepOutput(TRACE, CHILD, 0, 'x'))).resolves.toBeUndefined();
    await w.flush();

    expect(errors).toHaveLength(1);
  });

  it('keeps writing after a failure that goes away', async () => {
    const dir = await makeTempDir();
    const w = writer(dir);
    await w.onSpanStarted(new SpanStarted(root()));
    await writeFile(join(dir, `${'6'.repeat(32)}.events.jsonl`), '');
    await w.onSpanStarted(new SpanStarted(root('6'.repeat(32))));
    expect((await lines(dir, '6'.repeat(32))).map((x) => x.type)).toEqual(['span_started']);
  });

  it('works without any option but the directory and the clock', async () => {
    const dir = await makeTempDir();
    const w = new RunEventWriter({ directory: dir, clock: new FixedClock() });
    await w.onOutput(new StepOutput(TRACE, CHILD, 0, 'plain'));
    expect((await lines(dir))[0]).toMatchObject({ text: 'plain' });
  });
});
