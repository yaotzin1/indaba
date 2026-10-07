import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RunRecord, serializeRecord } from '@indaba/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watch } from '../src/index.js';
import { output, root, rootEnd, sampleRecords, status, stepStart, T, TRACE } from './fixtures.js';
import { FakeStdin, FakeStdout, until } from './terminal.js';

type Writable = Exclude<RunRecord, { type: 'unknown' }>;

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'indaba-tui-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeRun(records: RunRecord[]): Promise<void> {
  const lines = records
    .filter((r): r is Writable => r.type !== 'unknown')
    .map((r) => `${serializeRecord(r)}\n`);
  await writeFile(join(dir, `${TRACE}.events.jsonl`), lines.join(''));
}

function options(extra: { replay?: boolean; speed?: 1 | 10; attached?: boolean; signal?: AbortSignal } = {}) {
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
  return {
    stdout,
    stdin,
    options: {
      directory: dir,
      runId: TRACE,
      replay: extra.replay ?? false,
      speed: extra.speed ?? 10,
      attached: extra.attached ?? false,
      ascii: false,
      color: false,
      stdout: stdout as unknown as NodeJS.WritableStream,
      stdin: stdin as unknown as NodeJS.ReadableStream,
      ...(extra.signal === undefined ? {} : { signal: extra.signal }),
    },
  };
}

describe('watch', () => {
  it('refuses anything that is not a run id, before it touches a file', async () => {
    const t = options();
    await expect(watch({ ...t.options, runId: '../secret' })).rejects.toThrow(RangeError);
    await expect(watch({ ...t.options, runId: 'ABC' })).rejects.toThrow(RangeError);
  });

  it('shows a run that is still going and leaves it with code 0 when the person closes the screen', async () => {
    await writeRun(sampleRecords());
    const t = options();
    const done = watch(t.options);
    await until(() => t.stdout.text.includes('compiling') || t.stdout.text.includes('line two'));
    t.stdin.type('q');
    const result = await done;
    expect(result).toMatchObject({ quit: 'close', code: 0 });
    expect(result.run.status).toBe('running');
  });

  it('ends with the exit status of a run that has finished', async () => {
    await writeRun([...sampleRecords(), rootEnd('COMPLETED')]);
    const ok = options();
    const first = watch(ok.options);
    await until(() => ok.stdout.text.includes('completed'));
    ok.stdin.type('q');
    expect((await first).code).toBe(0);

    await writeRun([...sampleRecords(), rootEnd('FAILED')]);
    const bad = options();
    const second = watch(bad.options);
    await until(() => bad.stdout.text.includes('failed'));
    bad.stdin.type('q');
    const result = await second;
    expect(result.run.status).toBe('failed');
    expect(result.code).not.toBe(0);
  });

  it('exits 130 when the person cancels a run the screen started', async () => {
    await writeRun(sampleRecords());
    const t = options({ attached: true });
    const done = watch(t.options);
    await until(() => t.stdout.text.includes('plan'));
    t.stdin.type('q');
    await until(() => t.stdout.text.includes('c cancel'));
    t.stdin.type('c');
    expect(await done).toMatchObject({ quit: 'cancel', code: 130 });
  });

  it('replays a finished run, with the same end state as watching it', async () => {
    await writeRun([
      root(T(0)),
      stepStart('a', T(1)),
      status('a', 'RUNNING', undefined, T(1)),
      output('a', 1, 'hi\n', T(1)),
      rootEnd('COMPLETED', T(2)),
    ]);
    const t = options({ replay: true, speed: 10 });
    const done = watch(t.options);
    await until(() => t.stdout.text.includes('completed'));
    t.stdin.type('q');
    const result = await done;
    expect(result.run.status).toBe('completed');
    expect(result.run.steps.map((s) => s.id)).toEqual(['a']);
  });

  it('stops following when the caller aborts, without the person pressing anything', async () => {
    await writeRun(sampleRecords());
    const controller = new AbortController();
    const t = options({ signal: controller.signal });
    const done = watch(t.options);
    await until(() => t.stdout.text.includes('plan'));
    controller.abort();
    t.stdin.type('q');
    expect((await done).quit).toBe('close');
  });
});
