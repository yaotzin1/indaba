import type { BoardFileRecord } from '@indaba/engine';
import { describe, expect, it } from 'vitest';
import {
  type BoardPane,
  boardHelpRows,
  boardKey,
  boardKeyLines,
  boardRows,
  KIND_MARKS,
} from '../src/board-screen.js';
import { BOARD_KINDS, boardAction, emptyBoard, reduceBoard } from '../src/board-state.js';

const AT = '2026-10-30T12:00:00.000Z';
type Kind = Extract<BoardFileRecord, { type: 'post' }>['kind'];
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

const start: BoardFileRecord = { type: 'board', v: 1, at: AT, traceId: 'a'.repeat(32), workflow: 'demo' };
const post = (seq: number, stepId: string, kind: Kind, text: string, key?: string): BoardFileRecord => ({
  type: 'post',
  seq,
  at: AT,
  stepId,
  attempt: 1,
  scope: 'step',
  source: 'agent',
  sender: stepId,
  kind,
  ...(key === undefined ? {} : { key }),
  text,
  cut: false,
});
const settle = (
  seq: number,
  stepId: string,
  outcome: 'accepted' | 'discarded' | 'superseded',
): BoardFileRecord => ({
  type: 'settle',
  seq,
  at: AT,
  stepId,
  attempt: 1,
  scope: 'step',
  outcome,
});

const paneOf = (records: readonly BoardFileRecord[], degraded = false): BoardPane => ({
  state: records.reduce(reduceBoard, emptyBoard()),
  degraded,
});
/** Whether a line holds a control character other than a tab: what could move the cursor or repaint the screen. */
function hasControl(line: string): boolean {
  return Array.from(line).some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return (code < 0x20 && code !== 0x09) || (code >= 0x7f && code <= 0x9f);
  });
}
const text = (rows: readonly { text: string }[]): string => rows.map((r) => r.text).join('\n');

const BOARD = [
  start,
  post(1, 'research', 'note', 'the API is paged'),
  post(2, 'research', 'fact', 'v2', 'api.version'),
  settle(3, 'research', 'accepted'),
  post(4, 'plan', 'question', 'which size?'),
  settle(5, 'plan', 'discarded'),
  post(6, 'build', 'note', 'half done'),
];

describe('boardRows', () => {
  it('says there is no board when the run has none', () => {
    expect(text(boardRows(undefined, 60, 10, { ascii: false }))).toBe('There is no board for this run.');
  });

  it('says there is no board file yet while nothing has been read', () => {
    const rows = boardRows(paneOf([]), 80, 12, { ascii: false });
    expect(text(rows)).toContain('No board file yet.');
    expect(text(rows)).toContain('Nothing has been added yet.');
  });

  it('lists one line per entry: sequence, step, sender, glyph and word, and the text; pending is marked', () => {
    const rows = boardRows(paneOf(BOARD), 100, 14, { ascii: false });
    expect(text(rows)).toContain('#1  research  research  ● Note  the API is paged');
    expect(text(rows)).toContain('#2  research  research  ■ Fact  v2');
    expect(text(rows)).toContain('#6  build  build  ● Note (pending)  half done');
    expect(text(rows)).not.toContain('which size?');
    expect(rows[0]?.text).toBe('Board: notes between steps (4)');
    expect(rows.at(-1)?.text).toContain('Enter open');
  });

  it('shows the discarded entry, in words, once asked', () => {
    const state = boardAction(paneOf(BOARD).state, { type: 'toggle-settled' });
    const out = text(boardRows({ state, degraded: false }, 100, 14, { ascii: false }));
    expect(out).toContain('#4  plan  plan  ? Question (discarded)  which size?');
    expect(out).toContain('Showing: including discarded and replaced entries');
  });

  it('calls a superseded entry replaced', () => {
    const records = [
      start,
      post(1, 'a', 'note', 'old'),
      settle(2, 'a', 'accepted'),
      settle(3, 'a', 'superseded'),
    ];
    const state = boardAction(paneOf(records).state, { type: 'toggle-settled' });
    expect(text(boardRows({ state, degraded: false }, 100, 12, { ascii: false }))).toContain(
      '● Note (replaced)  old',
    );
  });

  it('marks the selected entry', () => {
    const rows = boardRows(paneOf(BOARD), 100, 14, { ascii: false });
    expect(rows.filter((r) => r.selected).map((r) => r.text)).toEqual([
      '#6  build  build  ● Note (pending)  half done',
    ]);
  });

  it('keeps the selected entry in view in a short pane', () => {
    const records: BoardFileRecord[] = [start];
    for (let i = 1; i <= 30; i += 1) {
      records.push(post(i, 's', 'note', `note ${i}`));
    }
    const rows = boardRows(paneOf(records), 60, 8, { ascii: false });
    expect(rows).toHaveLength(8);
    expect(text(rows)).toContain('note 30');
  });

  it('shows the active filters, and says so when none matches', () => {
    const state = boardAction(paneOf(BOARD).state, { type: 'step', stepId: 'nowhere' });
    const out = text(boardRows({ state, degraded: false }, 80, 12, { ascii: false }));
    expect(out).toContain('Showing: step nowhere');
    expect(out).toContain('No entry matches the filters.');
  });

  it('lists the facts with the step that set them', () => {
    const state = boardAction(paneOf(BOARD).state, { type: 'facts' });
    const out = text(boardRows({ state, degraded: false }, 80, 12, { ascii: false }));
    expect(out).toContain('api.version: v2  (research)');
    expect(boardKeyLines('facts', false).join(' ')).toContain('f back');
    const none = boardAction(paneOf([start]).state, { type: 'facts' });
    expect(text(boardRows({ state: none, degraded: false }, 80, 12, { ascii: false }))).toContain(
      'No facts yet.',
    );
  });

  it('opens one entry in full', () => {
    const records = [
      ...BOARD,
      { ...post(7, 'build', 'result', 'x'.repeat(120)), cut: true } as BoardFileRecord,
    ];
    const state = boardAction(boardAction(paneOf(records).state, { type: 'last' }), { type: 'open' });
    const out = text(boardRows({ state, degraded: false }, 40, 24, { ascii: false }));
    for (const field of [
      'Step: build',
      'Attempt: 1',
      'Sender: build',
      'Kind: ▣ Result',
      `Time: ${AT}`,
      'State: pending',
    ]) {
      expect(out).toContain(field);
    }
    expect(out).toContain('(this entry was cut to the size limit)');
    expect(out.split('\n').filter((l) => l.startsWith('xxxx')).length).toBeGreaterThan(1);
    expect(boardKeyLines('detail', false).join(' ')).toContain('Esc back');
    const empty = boardAction(emptyBoard(), { type: 'open' });
    expect(empty.mode).toBe('list');
  });

  it('shows the reason, the round and the name of an entry that has them', () => {
    const records: BoardFileRecord[] = [
      start,
      { ...post(1, 'argue', 'critique', 'too vague'), round: 2 } as BoardFileRecord,
      { ...settle(2, 'argue', 'discarded'), reason: 'the step failed' } as BoardFileRecord,
      post(3, 'argue', 'fact', 'v', 'k.name'),
    ];
    const base = boardAction(paneOf(records).state, { type: 'toggle-settled' });
    const first = boardAction(boardAction(base, { type: 'first' }), { type: 'open' });
    const out = text(boardRows({ state: first, degraded: false }, 60, 24, { ascii: false }));
    expect(out).toContain('Round: 2');
    expect(out).toContain('Why: the step failed');
    const named = boardAction(boardAction(base, { type: 'last' }), { type: 'open' });
    expect(text(boardRows({ state: named, degraded: false }, 60, 24, { ascii: false }))).toContain(
      'Name: k.name',
    );
  });

  it('says when the board is incomplete or reached its limit', () => {
    const rows = boardRows(
      {
        state: reduceBoard(paneOf(BOARD).state, { type: 'truncated', seq: 9, at: AT, reason: 'chars' }),
        degraded: true,
      },
      100,
      16,
      { ascii: false },
    );
    expect(text(rows)).toContain('The board is incomplete: part of it could not be saved.');
    expect(text(rows)).toContain('The board reached its size limit; later notes were not kept.');
  });

  it('has a glyph and a word for every kind, in ASCII too', () => {
    for (const kind of BOARD_KINDS) {
      const mark = KIND_MARKS[kind];
      expect(mark.word).toMatch(/^[A-Z][a-z ]+$/);
      expect(mark.glyph.length).toBeGreaterThan(0);
      expect(mark.ascii).toMatch(/^[\x21-\x7e]$/);
    }
    expect(new Set(BOARD_KINDS.map((k) => KIND_MARKS[k].glyph)).size).toBe(BOARD_KINDS.length);
    expect(new Set(BOARD_KINDS.map((k) => KIND_MARKS[k].ascii)).size).toBe(BOARD_KINDS.length);
    const ascii = text(boardRows(paneOf(BOARD), 100, 14, { ascii: true }));
    expect(ascii).toContain('o Note');
    expect(ascii).toContain('# Fact');
    expect(ascii).not.toMatch(/[^\x20-\x7e\n]/);
  });

  it('clips every row to the width', () => {
    for (const row of boardRows(paneOf(BOARD), 30, 14, { ascii: false })) {
      expect(Array.from(row.text).length).toBeLessThanOrEqual(30);
    }
  });
});

describe('hostile board text (AC-36)', () => {
  const hostile = `${ESC}[2J${ESC}]0;owned${BEL} move\u0008\u0008 done${ESC}[31m`;
  const records = [
    start,
    { ...post(1, `st${ESC}[2Jep`, 'note', hostile), sender: `se${ESC}[1;1Hnder` } as BoardFileRecord,
    { ...post(2, 'a', 'fact', hostile, `k${ESC}ey`) } as BoardFileRecord,
    settle(3, 'a', 'accepted'),
    settle(4, `st${ESC}[2Jep`, 'accepted'),
  ];

  it('reaches no row as anything but text, in the list, the facts and the detail view', () => {
    const base = paneOf(records).state;
    const views = [
      base,
      boardAction(base, { type: 'facts' }),
      boardAction(boardAction(base, { type: 'first' }), { type: 'open' }),
    ];
    for (const state of views) {
      const out = boardRows({ state, degraded: false }, 80, 24, { ascii: false });
      for (const row of out) {
        expect(hasControl(row.text), row.text).toBe(false);
        expect(row.text).not.toContain(ESC);
      }
    }
  });
});

describe('the board keys', () => {
  const state = paneOf(BOARD).state;
  const k = (char: string) => ({ char });

  it('move, jump, open and go back', () => {
    expect(boardKey(state, 'up', { pageSize: 5 })?.cursor).toBe(2);
    expect(boardKey(state, k('k'), { pageSize: 5 })?.cursor).toBe(2);
    const first = boardKey(state, 'home', { pageSize: 5 });
    expect(first?.cursor).toBe(1);
    expect(boardKey(first ?? state, 'down', { pageSize: 5 })?.cursor).toBe(2);
    expect(boardKey(first ?? state, k('j'), { pageSize: 5 })?.cursor).toBe(2);
    expect(boardKey(first ?? state, 'pagedown', { pageSize: 2 })?.cursor).toBe(6);
    expect(boardKey(first ?? state, 'pagedown', { pageSize: 0 })?.cursor).toBe(2);
    expect(boardKey(state, 'pageup', { pageSize: 99 })?.cursor).toBe(1);
    expect(boardKey(first ?? state, k('g'), { pageSize: 5 })?.cursor).toBe(1);
    expect(boardKey(first ?? state, k('G'), { pageSize: 5 })?.cursor).toBe(6);
    expect(boardKey(first ?? state, 'end', { pageSize: 5 })?.cursor).toBe(6);
    const open = boardKey(state, 'enter', { pageSize: 5 });
    expect(open?.mode).toBe('detail');
    expect(boardKey(open ?? state, 'escape', { pageSize: 5 })?.mode).toBe('list');
  });

  it('leave Esc to the dashboard once the board is at its list, and any key that is not the board’s', () => {
    expect(boardKey(state, 'escape', { pageSize: 5 })).toBeUndefined();
    expect(boardKey(state, 'tab', { pageSize: 5 })).toBeUndefined();
    expect(boardKey(state, 'ctrl-c', { pageSize: 5 })).toBeUndefined();
    for (const char of ['q', '?', 'b', 'z', 'u']) {
      expect(boardKey(state, k(char), { pageSize: 5 }), char).toBeUndefined();
    }
  });

  it('filter by the selected step, toggling it off again, and cycle kind and sender, and clear', () => {
    const stepped = boardKey(state, k('s'), { stepId: 'research', pageSize: 5 });
    expect(stepped?.filters.step).toBe('research');
    expect(
      boardKey(stepped ?? state, k('s'), { stepId: 'research', pageSize: 5 })?.filters.step,
    ).toBeUndefined();
    expect(boardKey(state, k('s'), { pageSize: 5 })).toBe(state);
    expect(boardKey(state, k('t'), { pageSize: 5 })?.filters.kind).toBe('note');
    expect(boardKey(state, k('r'), { pageSize: 5 })?.filters.sender).toBe('build');
    expect(boardKey(stepped ?? state, k('x'), { pageSize: 5 })?.filters).toEqual({ settled: false });
  });

  it('switch to the facts and show or hide the discarded entries', () => {
    expect(boardKey(state, k('f'), { pageSize: 5 })?.mode).toBe('facts');
    expect(boardKey(state, k('d'), { pageSize: 5 })?.filters.settled).toBe(true);
  });

  it('are all in the legend and the help', () => {
    const legend = boardKeyLines('list', false).join(' ');
    for (const word of [
      'move',
      'Enter',
      's step',
      't kind',
      'r sender',
      'x clear',
      'f facts',
      'd discarded',
      'b close',
    ]) {
      expect(legend).toContain(word);
    }
    expect(boardKeyLines('list', true).join(' ')).toContain('up/down');
    const help = text(boardHelpRows(80, false));
    for (const word of [
      'Enter',
      'Esc',
      'cycle the kind',
      'clear the filters',
      'the facts',
      'discarded and replaced',
    ]) {
      expect(help).toContain(word);
    }
    expect(text(boardHelpRows(80, true))).toContain('up/down');
  });
});

describe('plain words (AC-40)', () => {
  it('keeps the banned words out of everything the pane says', () => {
    const banned = /digest|settle|supersede|degraded|jsonl/i;
    const pane = paneOf(BOARD, true);
    const withLimit = {
      ...pane,
      state: reduceBoard(pane.state, { type: 'truncated', seq: 9, at: AT, reason: 'entries' }),
    };
    const shown = [
      ...boardRows(undefined, 100, 10, { ascii: false }),
      ...boardRows(paneOf([]), 100, 10, { ascii: false }),
      ...boardRows(withLimit, 100, 20, { ascii: false }),
      ...boardRows(
        { ...withLimit, state: boardAction(withLimit.state, { type: 'toggle-settled' }) },
        100,
        20,
        {
          ascii: false,
        },
      ),
      ...boardRows({ ...withLimit, state: boardAction(withLimit.state, { type: 'facts' }) }, 100, 20, {
        ascii: false,
      }),
      ...boardRows({ ...withLimit, state: boardAction(withLimit.state, { type: 'open' }) }, 100, 30, {
        ascii: false,
      }),
      ...boardHelpRows(100, false),
    ].map((r) => r.text);
    shown.push(...(['list', 'detail', 'facts'] as const).flatMap((m) => boardKeyLines(m, false)));
    // the entries' own text is data, not the pane's words
    const own = shown.filter((l) => !/^#\d+ /.test(l));
    expect(own.length).toBeGreaterThan(20);
    for (const line of own) {
      expect(line, line).not.toMatch(banned);
    }
  });
});
