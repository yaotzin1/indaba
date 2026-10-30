import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BoardKind, type BoardRecord, BoardRecorded, RunBoard } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  BOARD_FILE_SUFFIX,
  type BoardFileRecord,
  BoardReader,
  BoardWriter,
  serializeBoardRecord,
} from '../src/index.js';
import { FixedClock, makeTempDir } from './support.js';

const TRACE = 'ab12'.repeat(8);

function board(records: BoardRecord[]): RunBoard {
  return new RunBoard({
    traceId: TRACE,
    workflow: 'reader',
    clock: new FixedClock(),
    sink: (record) => records.push(record),
  });
}

function post(b: RunBoard, text: string, kind: BoardKind = BoardKind.Note): void {
  b.post({ stepId: 's', attempt: 1, source: 'agent', sender: 'w', kind, text });
}

const lineOf = (record: BoardRecord): string => `${serializeBoardRecord(record)}\n`;

/** A sleep that never waits, and counts, so a follow test controls what arrives between two looks. */
function ticker(onTick: (n: number) => Promise<void>) {
  let n = 0;
  return async (): Promise<void> => {
    n += 1;
    await onTick(n);
  };
}

describe('BoardReader.exists and readAll', () => {
  it('says there is no board for a run that has no file, and reads nothing from it', async () => {
    const reader = new BoardReader(await makeTempDir());
    expect(await reader.exists(TRACE)).toBe(false);
    expect(await reader.readAll(TRACE)).toEqual([]);
  });

  it('refuses a run id that is not lowercase hexadecimal', async () => {
    const reader = new BoardReader(await makeTempDir());
    for (const id of ['../x', 'A1', '', 'a/b']) {
      await expect(reader.exists(id)).rejects.toThrow(RangeError);
      await expect(reader.readAll(id)).rejects.toThrow(RangeError);
      await expect(reader.follow(id, new AbortController().signal).next()).rejects.toThrow(RangeError);
    }
  });

  it('reads what the writer wrote, as the same records', async () => {
    const dir = await makeTempDir();
    const records: BoardRecord[] = [];
    const b = board(records);
    post(b, 'one');
    post(b, 'two', BoardKind.Result);
    b.settle({ stepId: 's', attempt: 1, outcome: 'accepted' });
    const writer = new BoardWriter({ directory: dir });
    for (const record of records) {
      void writer.onRecorded(new BoardRecorded(TRACE, record));
    }
    await writer.flush();
    const reader = new BoardReader(dir);
    expect(await reader.exists(TRACE)).toBe(true);
    expect(await reader.readAll(TRACE)).toEqual(records);
  });

  it('leaves a half-written last line out, keeps an unknown record and a line that is not JSON, and skips a later version', async () => {
    const dir = await makeTempDir();
    const records: BoardRecord[] = [];
    post(board(records), 'kept');
    const lines = [
      lineOf(records[0] as BoardRecord),
      lineOf(records[1] as BoardRecord),
      '{"type":"from-the-future","at":"x"}\n',
      'not json at all\n',
      '{"type":"board","v":2,"at":"x","trace_id":"ab","workflow":"w"}\n',
    ];
    const half = lineOf(records[1] as BoardRecord).slice(0, 20);
    await writeFile(join(dir, `${TRACE}${BOARD_FILE_SUFFIX}`), lines.join('') + half);
    const read = await new BoardReader(dir).readAll(TRACE);
    expect(read.map((r) => r.type)).toEqual(['board', 'post', 'unknown', 'unknown', 'unknown']);
    expect(read.slice(0, 2)).toEqual(records);
  });
});

describe('BoardReader.follow', () => {
  it('waits for a file that does not exist yet, then yields from its first record', async () => {
    const dir = await makeTempDir();
    const records: BoardRecord[] = [];
    post(board(records), 'late');
    const file = join(dir, `${TRACE}${BOARD_FILE_SUFFIX}`);
    const controller = new AbortController();
    const sleep = ticker(async (n) => {
      if (n === 2) {
        await writeFile(file, records.map(lineOf).join(''));
      }
    });
    const seen: BoardFileRecord[] = [];
    for await (const record of new BoardReader(dir, { sleep }).follow(TRACE, controller.signal)) {
      seen.push(record);
      if (seen.length === records.length) {
        controller.abort();
      }
    }
    expect(seen).toEqual(records);
  });

  it('holds a partial last line until it is complete, and never yields it twice', async () => {
    const dir = await makeTempDir();
    const records: BoardRecord[] = [];
    const b = board(records);
    post(b, 'first');
    post(b, 'second');
    const [start, first, second] = records.map(lineOf) as [string, string, string];
    const file = join(dir, `${TRACE}${BOARD_FILE_SUFFIX}`);
    await mkdir(dir, { recursive: true });
    await writeFile(file, start + first + second.slice(0, 15));
    const controller = new AbortController();
    const sleep = ticker(async (n) => {
      if (n === 1) {
        await appendFile(file, second.slice(15));
      }
    });
    const seen: BoardFileRecord[] = [];
    for await (const record of new BoardReader(dir, { sleep }).follow(TRACE, controller.signal)) {
      seen.push(record);
      if (seen.length === 3) {
        controller.abort();
      }
    }
    expect(seen).toEqual(records);
  });

  it('starts over when the file is replaced by a shorter one, and stops at once on an aborted signal', async () => {
    const dir = await makeTempDir();
    const records: BoardRecord[] = [];
    const b = board(records);
    post(b, 'a long first entry to make the first file longer than the second');
    const file = join(dir, `${TRACE}${BOARD_FILE_SUFFIX}`);
    await writeFile(file, records.map(lineOf).join(''));
    const controller = new AbortController();
    const replacement = lineOf(records[0] as BoardRecord);
    const sleep = ticker(async (n) => {
      if (n === 1) {
        await writeFile(file, replacement);
      }
    });
    const seen: BoardFileRecord[] = [];
    for await (const record of new BoardReader(dir, { sleep }).follow(TRACE, controller.signal)) {
      seen.push(record);
      if (seen.length === 3) {
        controller.abort();
      }
    }
    expect(seen.map((r) => r.type)).toEqual(['board', 'post', 'board']);

    const stopped = new AbortController();
    stopped.abort();
    // an aborted signal still gets one look at the file, then ends: it does not wait
    const once: BoardFileRecord[] = [];
    for await (const record of new BoardReader(dir).follow(TRACE, stopped.signal)) {
      once.push(record);
    }
    expect(once.map((r) => r.type)).toEqual(['board']);

    const absent: BoardFileRecord[] = [];
    for await (const record of new BoardReader(await makeTempDir()).follow(TRACE, stopped.signal)) {
      absent.push(record);
    }
    expect(absent).toEqual([]);
  });

  it('yields what was written just before the abort, with one last look', async () => {
    const dir = await makeTempDir();
    const records: BoardRecord[] = [];
    const b = board(records);
    post(b, 'early');
    const file = join(dir, `${TRACE}${BOARD_FILE_SUFFIX}`);
    const [start, early] = records.map(lineOf) as [string, string];
    await writeFile(file, start + early);
    const controller = new AbortController();
    // the run ends during the wait: the last settlement is written, then the consumer aborts
    post(b, 'last');
    const last = records.map(lineOf)[2] as string;
    const sleep = ticker(async () => {
      await appendFile(file, last);
      controller.abort();
    });
    const seen: BoardFileRecord[] = [];
    for await (const record of new BoardReader(dir, { sleep }).follow(TRACE, controller.signal)) {
      seen.push(record);
    }
    expect(seen).toEqual(records);
  });

  it('wakes from the default wait when the signal aborts', async () => {
    const dir = await makeTempDir();
    const controller = new AbortController();
    const started = new BoardReader(dir, { pollMs: 60_000 }).follow(TRACE, controller.signal).next();
    setTimeout(() => controller.abort(), 10);
    expect((await started).done).toBe(true);
  });
});

describe('a resumed run', () => {
  it('rebuilds the board from the file and appends with the next seq, with no second start record', async () => {
    const dir = await makeTempDir();
    const firstRun: BoardRecord[] = [];
    const b = board(firstRun);
    post(b, 'before the stop');
    b.settle({ stepId: 's', attempt: 1, outcome: 'accepted' });
    const writer = new BoardWriter({ directory: dir });
    for (const record of firstRun) {
      void writer.onRecorded(new BoardRecorded(TRACE, record));
    }
    await writer.flush();

    const reader = new BoardReader(dir);
    const known = (await reader.readAll(TRACE)).filter((r): r is BoardRecord => r.type !== 'unknown');
    const resumed = RunBoard.replay(known, {
      traceId: TRACE,
      workflow: 'reader',
      clock: new FixedClock(),
      sink: (record) => void writer.onRecorded(new BoardRecorded(TRACE, record)),
    });
    expect(resumed.entries().map((e) => e.text)).toEqual(['before the stop']);
    post(resumed, 'after the resume');
    await writer.flush();

    const all = await reader.readAll(TRACE);
    expect(all.filter((r) => r.type === 'board')).toHaveLength(1);
    const seqs = all.flatMap((r) => ('seq' in r ? [r.seq] : []));
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(all.at(-1)).toMatchObject({ type: 'post', text: 'after the resume' });
  });
});
