import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BoardKind, RunBoard } from '@indaba/core';
import {
  parseBoardRecord,
  type RunRecord,
  serializeBoardRecord,
  serializeRecord,
  type UnknownRecord,
} from '@indaba/engine';
import { describe, expect, it } from 'vitest';
import { BOARD_SECTION_ENTRIES, formatBoardSection } from '../src/board-section.js';
import { main } from '../src/index.js';
import { watch } from '../src/watch.js';
import { captureIo, makeTempDir } from './support.js';

type Writable = Exclude<RunRecord, UnknownRecord>;
const ESC = String.fromCharCode(0x1b);
const T = (n: number): string => new Date(Date.UTC(2026, 9, 5, 12, 0, n)).toISOString();
const clock = { now: () => new Date(Date.UTC(2026, 9, 5, 12, 0, 0)) };

function newBoard(): RunBoard {
  return new RunBoard({ traceId: 'a'.repeat(32), workflow: 'demo', clock });
}

function post(board: RunBoard, stepId: string, kind: BoardKind, text: string, key?: string): number {
  const entry = board.post({
    stepId,
    attempt: 1,
    source: 'agent',
    sender: stepId,
    kind,
    text,
    ...(key === undefined ? {} : { key }),
  });
  if (entry === undefined) {
    throw new Error('the board refused a post the test needs');
  }
  board.settle({ stepId, attempt: 1, outcome: 'accepted' });
  return entry.seq;
}

const fileRecords = (board: RunBoard) =>
  board.records().map((r) => parseBoardRecord(serializeBoardRecord(r)));

describe('formatBoardSection (AC-39)', () => {
  it('is empty for a run with no board file', () => {
    expect(formatBoardSection([])).toBe('');
  });

  it('lists the facts, then the accepted entries as `#seq step kind: text`', () => {
    const board = newBoard();
    post(board, 'research', BoardKind.Fact, 'v2', 'api.version');
    post(board, 'research', BoardKind.Note, 'the API is paged');
    post(board, 'plan', BoardKind.Question, 'which page size?');
    expect(formatBoardSection(fileRecords(board))).toBe(
      [
        'Board',
        '  Facts:',
        '    api.version: v2 (research)',
        '  Notes between steps:',
        '  #1 research fact: v2',
        '  #3 research note: the API is paged',
        '  #5 plan question: which page size?',
        '',
      ].join('\n'),
    );
  });

  it('shows only accepted entries: pending, discarded and superseded ones are left out', () => {
    const board = newBoard();
    post(board, 'a', BoardKind.Note, 'kept');
    board.post({
      stepId: 'b',
      attempt: 1,
      source: 'agent',
      sender: 'b',
      kind: BoardKind.Note,
      text: 'pending one',
    });
    board.post({
      stepId: 'c',
      attempt: 1,
      source: 'agent',
      sender: 'c',
      kind: BoardKind.Note,
      text: 'thrown away',
    });
    board.settle({ stepId: 'c', attempt: 1, outcome: 'discarded' });
    post(board, 'd', BoardKind.Note, 'reset later');
    board.supersede(['d']);
    const text = formatBoardSection(fileRecords(board));
    expect(text).toContain('#1 a note: kept');
    for (const gone of ['pending one', 'thrown away', 'reset later']) {
      expect(text).not.toContain(gone);
    }
  });

  it('says so when nothing was accepted', () => {
    const board = newBoard();
    expect(formatBoardSection(fileRecords(board))).toBe('Board\n  Nothing has been added to the board.\n');
  });

  it('shows the newest 50 and counts the older ones, in the singular and the plural', () => {
    const board = newBoard();
    for (let i = 1; i <= BOARD_SECTION_ENTRIES + 1; i += 1) {
      post(board, 's', BoardKind.Note, `note ${i}`);
    }
    const one = formatBoardSection(fileRecords(board));
    expect(one).toContain('1 older entry is not shown.');
    expect(one).not.toContain('#1 s note: note 1\n');
    expect(one).toContain('#3 s note: note 2\n');
    expect(one.split('\n').filter((l) => l.startsWith('  #'))).toHaveLength(BOARD_SECTION_ENTRIES);

    post(board, 's', BoardKind.Note, 'one more');
    const two = formatBoardSection(fileRecords(board));
    expect(two).toContain('2 older entries are not shown.');
    expect(two.trimEnd().endsWith('not shown.')).toBe(true);
  });

  it('says when the board stopped taking entries', () => {
    const board = new RunBoard({
      traceId: 'a'.repeat(32),
      workflow: 'demo',
      clock,
      limits: { maxEntries: 1 },
    });
    post(board, 's', BoardKind.Note, 'first');
    board.post({
      stepId: 's',
      attempt: 1,
      source: 'agent',
      sender: 's',
      kind: BoardKind.Note,
      text: 'second',
    });
    expect(formatBoardSection(fileRecords(board))).toContain(
      'The board reached its size limit; later notes were not kept.',
    );
  });

  it('ignores lines it does not know and filters control characters out of whatever the file holds', () => {
    const hostile = `${ESC}[31mred${ESC}]0;title`;
    const lines = [
      JSON.stringify({ type: 'board', v: 1, at: T(0), trace_id: 'a'.repeat(32), workflow: 'demo' }),
      JSON.stringify({
        type: 'post',
        seq: 1,
        at: T(1),
        step_id: 'a',
        attempt: 1,
        scope: 'step',
        source: 'agent',
        sender: 'a',
        kind: 'note',
        text: hostile,
        cut: false,
      }),
      JSON.stringify({
        type: 'settle',
        seq: 2,
        at: T(2),
        step_id: 'a',
        attempt: 1,
        scope: 'step',
        outcome: 'accepted',
      }),
      'not json at all',
      JSON.stringify({ type: 'from-the-future', x: 1 }),
    ];
    const text = formatBoardSection(lines.map(parseBoardRecord));
    expect(text).not.toContain(ESC);
    expect(text).toContain('#1 a note:');
  });

  it('uses plain words (AC-40)', () => {
    const board = newBoard();
    post(board, 'a', BoardKind.Fact, 'x', 'k');
    post(board, 'a', BoardKind.Note, 'y');
    const text = formatBoardSection(fileRecords(board)).replace(/#\d+ a \w+: .*/g, '');
    expect(text).not.toMatch(/digest|settle|supersede|degraded|jsonl|seq\b/i);
  });
});

// The command: the section follows the steps in every plain output, and a run without a board file prints what it did.
const runRoot = (trace: string, at = T(0)): Writable => ({
  type: 'span_started',
  at,
  traceId: trace,
  spanId: 'r1',
  parentSpanId: undefined,
  name: 'indaba.task demo',
  attributes: { 'indaba.workflow.name': 'demo', 'indaba.task.id': 't' },
});
const rootEnd = (trace: string): Writable => ({
  type: 'span_ended',
  at: T(30),
  traceId: trace,
  spanId: 'r1',
  status: 'ok',
  statusMessage: undefined,
  attributes: { 'indaba.workflow.status': 'COMPLETED' },
  events: [],
});

async function project(finished: boolean, board: RunBoard | undefined) {
  const dir = await makeTempDir();
  const traces = join(dir, '.indaba', 'traces');
  await mkdir(traces, { recursive: true });
  const id = 'b'.repeat(32);
  const records = finished ? [runRoot(id), rootEnd(id)] : [runRoot(id)];
  await writeFile(join(traces, `${id}.events.jsonl`), records.map((r) => `${serializeRecord(r)}\n`).join(''));
  if (board !== undefined) {
    await writeFile(
      join(traces, `${id}.board.jsonl`),
      board
        .records()
        .map((r) => `${serializeBoardRecord(r)}\n`)
        .join(''),
    );
  }
  return { dir, traces, id };
}

async function run(dir: string, args: string[]) {
  const captured = captureIo(dir, {});
  const code = await main(['watch', ...args], captured.io);
  return { code, out: captured.stdout() };
}

describe('indaba watch --plain and the board (AC-39)', () => {
  const board = (): RunBoard => {
    const b = newBoard();
    post(b, 'research', BoardKind.Fact, 'v2', 'api.version');
    post(b, 'research', BoardKind.Note, 'paged');
    return b;
  };

  it('prints the section after the steps of a finished run, and exits as the run did', async () => {
    const { dir, id } = await project(true, board());
    const r = await run(dir, [id, '--plain']);
    expect(r.code).toBe(0);
    expect(r.out.indexOf('indaba demo |')).toBeGreaterThanOrEqual(0);
    expect(r.out.indexOf('Board\n')).toBeGreaterThan(r.out.indexOf('indaba demo |'));
    expect(r.out).toContain('#3 research note: paged');
  });

  it('prints exactly what it did before for a run with no board file', async () => {
    const without = await project(true, undefined);
    const withEmpty = await project(true, newBoard());
    const plain = await run(without.dir, [without.id, '--plain']);
    expect(plain.out).not.toContain('Board');
    expect(plain.out.endsWith('\n')).toBe(true);
    expect((await run(withEmpty.dir, [withEmpty.id, '--plain'])).out).toContain('Board\n');
  });

  it('leaves the section out when the file cannot be read, and still shows the run', async () => {
    const { dir, traces, id } = await project(true, undefined);
    await mkdir(join(traces, `${id}.board.jsonl`)); // a folder where the file should be
    const r = await run(dir, [id, '--plain']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('indaba demo |');
    expect(r.out).not.toContain('Board');
  });

  it('prints it at the end of a replay', async () => {
    const { dir, id } = await project(true, board());
    const captured = captureIo(dir, {});
    const code = await watch([id, '--replay'], captured.io, { sleep: async () => undefined });
    expect(code).toBe(0);
    expect(captured.stdout().trimEnd().endsWith('#3 research note: paged')).toBe(true);
  });

  it('prints it when a run that never finished goes quiet', async () => {
    const { dir, id } = await project(false, board());
    const captured = captureIo(dir, {});
    const code = await watch([id, '--stale', '0.2'], captured.io);
    expect(code).toBe(3);
    const out = captured.stdout();
    expect(out).toContain('Board\n');
    expect(out.indexOf('Board\n')).toBeLessThan(out.indexOf('The run has written nothing'));
  });
});
