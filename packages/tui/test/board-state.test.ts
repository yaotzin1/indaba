import type { BoardFileRecord } from '@indaba/engine';
import { describe, expect, it } from 'vitest';
import {
  activeFilters,
  type BoardAction,
  type BoardState,
  boardAction,
  detailOf,
  emptyBoard,
  factsOf,
  reduceBoard,
  selectedIndex,
  visibleEntries,
} from '../src/board-state.js';

const AT = '2026-10-30T12:00:00.000Z';
type Kind = Extract<BoardFileRecord, { type: 'post' }>['kind'];

const start: BoardFileRecord = { type: 'board', v: 1, at: AT, traceId: 'a'.repeat(32), workflow: 'demo' };

function post(
  seq: number,
  stepId: string,
  kind: Kind,
  text: string,
  extra: { key?: string; sender?: string; attempt?: number } = {},
): BoardFileRecord {
  return {
    type: 'post',
    seq,
    at: AT,
    stepId,
    attempt: extra.attempt ?? 1,
    scope: 'step',
    source: 'agent',
    sender: extra.sender ?? stepId,
    kind,
    ...(extra.key === undefined ? {} : { key: extra.key }),
    text,
    cut: false,
  };
}

function settle(
  seq: number,
  stepId: string,
  outcome: 'accepted' | 'discarded' | 'superseded',
  attempt = 1,
  reason?: string,
): BoardFileRecord {
  return {
    type: 'settle',
    seq,
    at: AT,
    stepId,
    attempt,
    scope: 'step',
    outcome,
    ...(reason === undefined ? {} : { reason }),
  };
}

const read = (records: readonly BoardFileRecord[], from: BoardState = emptyBoard()): BoardState =>
  records.reduce(reduceBoard, from);
const act = (state: BoardState, ...actions: BoardAction[]): BoardState => actions.reduce(boardAction, state);
const texts = (state: BoardState): string[] => visibleEntries(state).map((i) => i.post.text);

const BOARD: readonly BoardFileRecord[] = [
  start,
  post(1, 'research', 'note', 'paged'),
  post(2, 'research', 'fact', 'v1', { key: 'api.version' }),
  settle(3, 'research', 'accepted'),
  post(4, 'plan', 'question', 'which size?', { sender: 'planner' }),
  settle(5, 'plan', 'discarded'),
  post(6, 'build', 'note', 'half done'),
  post(7, 'research', 'fact', 'v2', { key: 'api.version', attempt: 2 }),
  settle(8, 'research', 'accepted', 2),
];

function cycle(
  state: BoardState,
  type: 'cycle-kind' | 'cycle-sender',
  times: number,
): (string | undefined)[] {
  const seen: (string | undefined)[] = [];
  let at = state;
  for (let i = 0; i < times; i += 1) {
    at = boardAction(at, { type });
    seen.push(type === 'cycle-kind' ? at.filters.kind : at.filters.sender);
  }
  return seen;
}

describe('reduceBoard', () => {
  it('starts empty and reads the start record once', () => {
    const empty = emptyBoard();
    expect(empty.started).toBe(false);
    expect(visibleEntries(empty)).toEqual([]);
    const s = read([start, { ...start, workflow: 'other' }]);
    expect(s.started).toBe(true);
    expect(s.workflow).toBe('demo');
  });

  it('settles entries the way the engine did, and leaves a pending entry pending', () => {
    const s = read(BOARD);
    expect(s.items.map((i) => [i.post.seq, i.state])).toEqual([
      [1, 'accepted'],
      [2, 'accepted'],
      [4, 'discarded'],
      [6, 'pending'],
      [7, 'accepted'],
    ]);
  });

  it('keeps the reason of a settlement, and a reset turns accepted entries into superseded', () => {
    const s = read([...BOARD, settle(9, 'research', 'superseded', 1, 'a retry reset this step')]);
    const first = s.items.find((i) => i.post.seq === 1);
    expect(first?.state).toBe('superseded');
    expect(first?.reason).toBe('a retry reset this step');
    expect(s.items.find((i) => i.post.seq === 7)?.state).toBe('accepted');
  });

  it('does not settle an entry posted after the settlement', () => {
    const s = read([
      start,
      post(1, 'a', 'note', 'x'),
      settle(2, 'a', 'accepted'),
      post(3, 'a', 'note', 'later'),
    ]);
    expect(s.items.map((i) => i.state)).toEqual(['accepted', 'pending']);
  });

  it('does not settle an entry posted after the settlement, even when the records arrive the other way round', () => {
    const records = [
      start,
      post(1, 'a', 'note', 'x'),
      settle(2, 'a', 'accepted'),
      post(3, 'a', 'note', 'later'),
    ];
    expect(read([...records].reverse()).items.map((i) => i.state)).toEqual(['accepted', 'pending']);
    expect(
      read([records[3], records[2], records[1]].flatMap((r) => (r === undefined ? [] : [r]))).items,
    ).toEqual(read(records).items);
  });

  it('reads the same board whatever order its records arrive in', () => {
    const forward = read(BOARD);
    const backward = read([...BOARD].reverse());
    const order = [3, 7, 1, 0, 5, 2, 8, 4, 6];
    const shuffled = read(order.flatMap((i) => (BOARD[i] === undefined ? [] : [BOARD[i]])));
    for (const other of [backward, shuffled]) {
      expect(other.items).toEqual(forward.items);
      expect(other.settlements).toEqual(forward.settlements);
    }
  });

  it('ignores a record it has already read, so a reader that starts over changes nothing', () => {
    const once = read(BOARD);
    expect(read(BOARD, once)).toEqual(once);
  });

  it('counts a line it does not know, and notes that the board stopped taking entries', () => {
    const s = read([
      start,
      { type: 'unknown', text: 'garbage' },
      { type: 'truncated', seq: 9, at: AT, reason: 'entries' },
    ]);
    expect(s.unknown).toBe(1);
    expect(s.truncated).toBe(true);
  });
});

describe('the list and its filters (AC-34)', () => {
  const s = read(BOARD);

  it('shows pending and accepted entries by default, and the discarded and superseded ones when asked', () => {
    expect(texts(s)).toEqual(['paged', 'v1', 'half done', 'v2']);
    const all = act(s, { type: 'toggle-settled' });
    expect(texts(all)).toEqual(['paged', 'v1', 'which size?', 'half done', 'v2']);
    expect(activeFilters(all)).toEqual(['including discarded and replaced entries']);
    expect(texts(act(all, { type: 'toggle-settled' }))).toEqual(texts(s));
  });

  it('filters by step, kind and sender, and the filters combine', () => {
    expect(texts(act(s, { type: 'step', stepId: 'research' }))).toEqual(['paged', 'v1', 'v2']);
    const notes = act(s, { type: 'step', stepId: 'research' }, { type: 'cycle-kind' });
    expect(notes.filters.kind).toBe('note');
    expect(texts(notes)).toEqual(['paged']);
    expect(activeFilters(act(notes, { type: 'cycle-sender' }))).toEqual([
      'step research',
      'kind note',
      'sender build',
    ]);
    expect(texts(act(notes, { type: 'cycle-sender' }))).toEqual([]);
  });

  it('cycles a kind through the kinds that are present, then back to all', () => {
    expect(cycle(s, 'cycle-kind', 5)).toEqual(['note', 'question', 'fact', undefined, 'note']);
  });

  it('cycles a sender through the senders that are present, then back to all', () => {
    expect(cycle(s, 'cycle-sender', 5)).toEqual(['build', 'planner', 'research', undefined, 'build']);
  });

  it('clears every filter in one action, and clearing the step alone leaves the others', () => {
    const filtered = act(
      s,
      { type: 'step', stepId: 'research' },
      { type: 'cycle-kind' },
      { type: 'toggle-settled' },
    );
    expect(activeFilters(filtered)).toHaveLength(3);
    expect(act(filtered, { type: 'clear' }).filters).toEqual({ settled: false });
    expect(activeFilters(act(filtered, { type: 'step', stepId: undefined }))).toEqual([
      'kind note',
      'including discarded and replaced entries',
    ]);
    expect(activeFilters(emptyBoard())).toEqual([]);
  });

  it('cycles nothing on an empty board', () => {
    expect(act(emptyBoard(), { type: 'cycle-kind' }, { type: 'cycle-sender' }).filters).toEqual({
      settled: false,
    });
  });
});

describe('selection, detail and facts (AC-35)', () => {
  const s = read(BOARD);

  it('selects the newest entry until the person moves, and keeps the selection as entries arrive', () => {
    expect(selectedIndex(s)).toBe(3);
    const up = act(s, { type: 'move', by: -1 });
    expect(up.cursor).toBe(6);
    const more = read([post(10, 'build', 'note', 'newer')], up);
    expect(visibleEntries(more)[selectedIndex(more)]?.post.seq).toBe(6);
    expect(selectedIndex(emptyBoard())).toBe(-1);
  });

  it('stops at both ends, and goes to the first and the last', () => {
    expect(act(s, { type: 'move', by: -99 }).cursor).toBe(1);
    expect(act(s, { type: 'first' }).cursor).toBe(1);
    expect(act(s, { type: 'first' }, { type: 'move', by: 99 }).cursor).toBe(7);
    expect(act(s, { type: 'first' }, { type: 'last' }).cursor).toBe(7);
    expect(act(emptyBoard(), { type: 'move', by: 1 })).toEqual(emptyBoard());
    expect(act(emptyBoard(), { type: 'first' }).cursor).toBeUndefined();
  });

  it('falls back to the newest visible entry when the selected one is filtered out', () => {
    const filtered = act(s, { type: 'first' }, { type: 'step', stepId: 'build' });
    expect(visibleEntries(filtered)[selectedIndex(filtered)]?.post.text).toBe('half done');
  });

  it('opens the selected entry in full and returns to the list', () => {
    const open = act(s, { type: 'first' }, { type: 'open' });
    expect(open.mode).toBe('detail');
    expect(detailOf(open)?.post).toMatchObject({
      seq: 1,
      stepId: 'research',
      attempt: 1,
      kind: 'note',
      text: 'paged',
    });
    expect(detailOf(s)).toBeUndefined();
    expect(act(open, { type: 'close' }).mode).toBe('list');
    expect(act(s, { type: 'close' })).toEqual(s);
    expect(act(emptyBoard(), { type: 'open' }).mode).toBe('list');
  });

  it('leaves the detail view when a filter changes', () => {
    const open = act(s, { type: 'open' });
    expect(act(open, { type: 'cycle-kind' }).mode).toBe('list');
    expect(act(open, { type: 'clear' }).mode).toBe('list');
  });

  it('lists the current value of each fact with the step that set it, by key', () => {
    expect(factsOf(s).map((f) => [f.key, f.item.post.text, f.item.post.stepId])).toEqual([
      ['api.version', 'v2', 'research'],
    ]);
    const more = read(
      [post(10, 'other', 'fact', 'on', { key: 'a.flag' }), settle(11, 'other', 'accepted')],
      s,
    );
    expect(factsOf(more).map((f) => f.key)).toEqual(['a.flag', 'api.version']);
    expect(factsOf(act(more, { type: 'step', stepId: 'other' })).map((f) => f.key)).toEqual(['a.flag']);
  });

  it('leaves out facts that are pending or discarded', () => {
    expect(factsOf(read([post(1, 'a', 'fact', 'x', { key: 'k' })]))).toEqual([]);
    expect(factsOf(read([post(1, 'a', 'fact', 'x', { key: 'k' }), settle(2, 'a', 'discarded')]))).toEqual([]);
  });

  it('switches to the facts and back, and does not move or open there', () => {
    const f = act(s, { type: 'facts' });
    expect(f.mode).toBe('facts');
    expect(act(f, { type: 'move', by: -1 })).toEqual(f);
    expect(act(f, { type: 'open' })).toEqual(f);
    expect(act(f, { type: 'facts' }).mode).toBe('list');
    expect(act(f, { type: 'close' }).mode).toBe('list');
  });
});
