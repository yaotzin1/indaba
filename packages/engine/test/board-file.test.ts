import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BoardKind, type BoardRecord, BoardRecorded, RunBoard } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { BOARD_FILE_SUFFIX, BoardWriter, parseBoardRecord, serializeBoardRecord } from '../src/index.js';
import { FixedClock, makeTempDir } from './support.js';

const TRACE = 'ab12'.repeat(8);

/** A board that has seen every kind of record, so each one is serialized and read back. */
function fullRecords(): BoardRecord[] {
  const records: BoardRecord[] = [];
  const board = new RunBoard({
    traceId: TRACE,
    workflow: 'file',
    clock: new FixedClock(),
    limits: { maxEntries: 3 },
    sink: (record) => records.push(record),
  });
  board.post({ stepId: 's', attempt: 1, source: 'agent', sender: 'w', kind: BoardKind.Note, text: 'plain' });
  board.post({
    stepId: 's',
    attempt: 1,
    source: 'agent',
    sender: 'w',
    kind: BoardKind.Fact,
    key: 'api.version',
    text: '3',
  });
  board.post({
    stepId: 's',
    attempt: 1,
    source: 'engine',
    sender: 'critic',
    kind: BoardKind.Critique,
    round: 2,
    text: 'stale rows',
  });
  board.post({ stepId: 's', attempt: 1, source: 'agent', sender: 'w', kind: BoardKind.Note, text: 'over' });
  board.settle({ stepId: 's', attempt: 1, outcome: 'accepted' });
  board.supersede(['s']);
  return records;
}

describe('board records', () => {
  it('round-trips every record type through one line', () => {
    const records = fullRecords();
    expect(new Set(records.map((r) => r.type))).toEqual(new Set(['board', 'post', 'settle', 'truncated']));
    for (const record of records) {
      const line = serializeBoardRecord(record);
      expect(line).not.toContain('\n');
      expect(parseBoardRecord(line)).toEqual(record);
    }
  });

  it('writes snake_case names and leaves absent optional fields out', () => {
    const [start, note, fact] = fullRecords();
    expect(JSON.parse(serializeBoardRecord(start as BoardRecord))).toEqual({
      type: 'board',
      v: 1,
      at: '2026-01-01T00:00:00.000Z',
      trace_id: TRACE,
      workflow: 'file',
    });
    const wire = JSON.parse(serializeBoardRecord(note as BoardRecord));
    expect(Object.keys(wire)).toEqual([
      'type',
      'seq',
      'at',
      'step_id',
      'attempt',
      'scope',
      'source',
      'sender',
      'kind',
      'text',
      'cut',
    ]);
    expect(JSON.parse(serializeBoardRecord(fact as BoardRecord)).key).toBe('api.version');
  });

  it('keeps a settle record’s reason', () => {
    const settle: BoardRecord = {
      type: 'settle',
      seq: 9,
      at: 'now',
      stepId: 's',
      attempt: 1,
      scope: 'step',
      outcome: 'superseded',
      reason: 'the retry reset this step',
    };
    expect(parseBoardRecord(serializeBoardRecord(settle))).toEqual(settle);
  });

  it('turns anything it does not know into an unknown record, never an error', () => {
    const long = 'x'.repeat(2000);
    const lines = [
      '',
      'not json',
      '[1,2]',
      '42',
      'null',
      '{"type":"post"}',
      '{"type":"mystery","at":"now"}',
      '{"type":"board","v":2,"at":"now","trace_id":"ab","workflow":"w"}',
      '{"type":"post","seq":0,"at":"n","step_id":"s","attempt":1,"scope":"step","source":"agent","sender":"w","kind":"note","text":"t","cut":false}',
      '{"type":"post","seq":1,"at":"n","step_id":"s","attempt":1,"scope":"step","source":"robot","sender":"w","kind":"note","text":"t","cut":false}',
      '{"type":"post","seq":1,"at":"n","step_id":"s","attempt":1,"scope":"step","source":"agent","sender":"w","kind":"secret","text":"t","cut":false}',
      '{"type":"settle","seq":1,"at":"n","step_id":"s","attempt":1,"scope":"step","outcome":"maybe"}',
      '{"type":"truncated","seq":1,"at":"n","reason":"mood"}',
      long,
    ];
    for (const line of lines) {
      const parsed = parseBoardRecord(line);
      expect(parsed.type).toBe('unknown');
      if (parsed.type === 'unknown') {
        expect(parsed.text.length).toBeLessThanOrEqual(500);
      }
    }
  });

  it('ignores a round that is not a positive whole number rather than refusing the entry', () => {
    const line = JSON.stringify({
      type: 'post',
      seq: 1,
      at: 'n',
      step_id: 's',
      attempt: 1,
      scope: 'step',
      source: 'engine',
      sender: 'a',
      kind: 'proposal',
      round: 1.5,
      text: 't',
      cut: true,
    });
    const parsed = parseBoardRecord(line);
    expect(parsed.type).toBe('post');
    expect(parsed).not.toHaveProperty('round');
    expect(parsed).toHaveProperty('cut', true);
  });
});

describe('BoardWriter', () => {
  it('appends whole lines in the order the records arrived, and nothing else', async () => {
    const dir = await makeTempDir();
    const writer = new BoardWriter({ directory: join(dir, 'traces') });
    const records = fullRecords();
    // handed over without waiting: the queue alone keeps the order
    for (const record of records) {
      void writer.onRecorded(new BoardRecorded(TRACE, record));
    }
    await writer.flush();
    const text = await readFile(join(dir, 'traces', `${TRACE}${BOARD_FILE_SUFFIX}`), 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.trim().split('\n').map(parseBoardRecord)).toEqual(records);
    expect(text.split('\n')[0]).toContain('"type":"board"');
  });

  it('keeps a file apart for each run and appends to one that exists', async () => {
    const dir = await makeTempDir();
    const writer = new BoardWriter({ directory: dir });
    const other = 'cd34'.repeat(8);
    const [start, post] = fullRecords() as [BoardRecord, BoardRecord];
    await writer.onRecorded(new BoardRecorded(TRACE, start));
    await writer.onRecorded(new BoardRecorded(other, start));
    await new BoardWriter({ directory: dir }).onRecorded(new BoardRecorded(TRACE, post));
    expect((await readdir(dir)).sort()).toEqual(
      [`${TRACE}${BOARD_FILE_SUFFIX}`, `${other}${BOARD_FILE_SUFFIX}`].sort(),
    );
    expect(
      (await readFile(join(dir, `${TRACE}${BOARD_FILE_SUFFIX}`), 'utf8')).trim().split('\n'),
    ).toHaveLength(2);
  });

  it('refuses a trace id that is not plain lowercase hexadecimal, so it can never name another path', async () => {
    const dir = await makeTempDir();
    const errors: unknown[] = [];
    const writer = new BoardWriter({ directory: dir, onError: (e) => errors.push(e) });
    const [start] = fullRecords() as [BoardRecord];
    for (const id of ['../escape', 'a/b', 'a\\b', 'ABCD', '', 'g1', `${'a'.repeat(65)}`]) {
      await writer.onRecorded(new BoardRecorded(id, start));
    }
    expect(await readdir(dir)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('reports the first failure once and lets the run go on, still writing when it can', async () => {
    const dir = await makeTempDir();
    const blocker = join(dir, 'file');
    await writeFile(blocker, 'in the way');
    const errors: unknown[] = [];
    const writer = new BoardWriter({ directory: join(blocker, 'traces'), onError: (e) => errors.push(e) });
    const records = fullRecords();
    for (const record of records) {
      await expect(writer.onRecorded(new BoardRecorded(TRACE, record))).resolves.toBeUndefined();
    }
    await writer.flush();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(await readFile(blocker, 'utf8')).toBe('in the way');
  });

  it('works without an error handler', async () => {
    const dir = await makeTempDir();
    const blocker = join(dir, 'file');
    await writeFile(blocker, 'x');
    const writer = new BoardWriter({ directory: join(blocker, 'nested') });
    const [start] = fullRecords() as [BoardRecord];
    await expect(writer.onRecorded(new BoardRecorded(TRACE, start))).resolves.toBeUndefined();
  });
});
