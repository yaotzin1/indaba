import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BoardFileRecord, parseBoardRecord, serializeBoardRecord } from '@indaba/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watch } from '../src/index.js';
import { sampleRecords, TRACE } from './fixtures.js';
import { FakeStdin, FakeStdout, sleep, until } from './terminal.js';

const AT = '2026-10-30T12:00:00.000Z';
let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'indaba-tui-board-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const start = (): BoardFileRecord => ({ type: 'board', v: 1, at: AT, traceId: TRACE, workflow: 'demo' });
const note = (seq: number, text: string): BoardFileRecord => ({
  type: 'post',
  seq,
  at: AT,
  stepId: 'plan',
  attempt: 1,
  scope: 'step',
  source: 'agent',
  sender: 'plan',
  kind: 'note',
  text,
  cut: false,
});
const lines = (records: readonly BoardFileRecord[]): string =>
  records.map((r) => `${serializeBoardRecord(r as Parameters<typeof serializeBoardRecord>[0])}\n`).join('');

async function writeTrace(): Promise<void> {
  const { serializeRecord } = await import('@indaba/engine');
  const text = sampleRecords()
    .filter((r) => r.type !== 'unknown')
    .map((r) => `${serializeRecord(r as Parameters<typeof serializeRecord>[0])}\n`)
    .join('');
  await writeFile(join(dir, `${TRACE}.events.jsonl`), text);
}

function open(replay: boolean) {
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
  const done = watch({
    directory: dir,
    runId: TRACE,
    replay,
    speed: 10,
    attached: false,
    ascii: false,
    color: false,
    stdout: stdout as unknown as NodeJS.WritableStream,
    stdin: stdin as unknown as NodeJS.ReadableStream,
  });
  return { stdout, stdin, done };
}

describe('watch and the board file (AC-38)', () => {
  it('follows the board file beside the trace: first no file, then the entries as they are written', async () => {
    await writeTrace();
    const t = open(false);
    await until(() => t.stdout.text.includes('plan'));
    t.stdin.type('b');
    await until(() => t.stdout.text.includes('No board file yet.'));
    await writeFile(join(dir, `${TRACE}.board.jsonl`), lines([start(), note(1, 'the API is paged')]));
    await until(() => t.stdout.text.includes('the API is paged'));
    await appendFile(join(dir, `${TRACE}.board.jsonl`), lines([note(2, 'a later note')]));
    await until(() => t.stdout.text.includes('a later note'));
    t.stdin.type('q');
    expect((await t.done).quit).toBe('close');
  });

  it('reads the whole file for a replay', async () => {
    await writeTrace();
    await writeFile(join(dir, `${TRACE}.board.jsonl`), lines([start(), note(1, 'kept for the replay')]));
    const t = open(true);
    await until(() => t.stdout.text.includes('plan'));
    t.stdin.type('b');
    await until(() => t.stdout.text.includes('kept for the replay'));
    t.stdin.type('q');
    await t.done;
  });

  it('shows the board of a run whose file has a line it does not understand', async () => {
    await writeTrace();
    await writeFile(
      join(dir, `${TRACE}.board.jsonl`),
      `${lines([start(), note(1, 'still here')])}not json\n`,
    );
    expect(parseBoardRecord('not json').type).toBe('unknown');
    const t = open(true);
    await until(() => t.stdout.text.includes('plan'));
    t.stdin.type('b');
    await until(() => t.stdout.text.includes('still here'));
    await sleep(20);
    t.stdin.type('q');
    await t.done;
  });
});
