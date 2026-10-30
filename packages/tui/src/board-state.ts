import type { BoardFileRecord } from '@indaba/engine';

/**
 * The board pane's state (specs/run-blackboard, AC-33 to AC-35): the entries read from `<traceId>.board.jsonl`, what
 * became of each, the filters, and which entry is selected. Pure: records and actions in, the next state out. It
 * imports nothing but the record types, so it is tested with no terminal. Strings are stored as they came; the pane
 * filters them before they reach a component (AC-36).
 */
type PostRecord = Extract<BoardFileRecord, { type: 'post' }>;
type SettleRecord = Extract<BoardFileRecord, { type: 'settle' }>;

export type BoardEntryKind = PostRecord['kind'];
export type BoardEntryState = 'pending' | SettleRecord['outcome'];

/** The kinds in the order the pane cycles through them. */
export const BOARD_KINDS: readonly BoardEntryKind[] = [
  'note',
  'question',
  'result',
  'fact',
  'decision',
  'proposal',
  'critique',
  'agreement',
  'tool_intent',
];

export interface BoardItem {
  readonly post: PostRecord;
  readonly state: BoardEntryState;
  /** Why it was settled, when the settlement said. */
  readonly reason?: string;
}

export interface BoardFilters {
  /** Only this step's entries. */
  readonly step?: string;
  readonly kind?: BoardEntryKind;
  readonly sender?: string;
  /** Show the discarded and superseded entries too. */
  readonly settled: boolean;
}

export type BoardMode = 'list' | 'facts' | 'detail';

export interface BoardState {
  /** The start record has been read. */
  readonly started: boolean;
  readonly workflow?: string;
  /** In `seq` order. */
  readonly items: readonly BoardItem[];
  readonly settlements: readonly SettleRecord[];
  /** The board reached its entry or size limit and stopped taking entries. */
  readonly truncated: boolean;
  /** Lines the reader could not make sense of. */
  readonly unknown: number;
  readonly filters: BoardFilters;
  readonly mode: BoardMode;
  /** The selected entry. Without one, or when it is filtered out, the newest visible entry is selected. */
  readonly cursor?: number;
}

export type BoardAction =
  | { readonly type: 'step'; readonly stepId: string | undefined }
  | { readonly type: 'cycle-kind' }
  | { readonly type: 'cycle-sender' }
  | { readonly type: 'clear' }
  | { readonly type: 'toggle-settled' }
  | { readonly type: 'move'; readonly by: number }
  | { readonly type: 'first' }
  | { readonly type: 'last' }
  | { readonly type: 'open' }
  | { readonly type: 'close' }
  | { readonly type: 'facts' };

export function emptyBoard(): BoardState {
  return {
    started: false,
    items: [],
    settlements: [],
    truncated: false,
    unknown: 0,
    filters: { settled: false },
    mode: 'list',
  };
}

/** The state an entry has after the settlements, applied in `seq` order the way the engine applied them. */
function applySettlement(items: readonly BoardItem[], record: SettleRecord): readonly BoardItem[] {
  return items.map((item) => {
    const p = item.post;
    const sameGroup = p.stepId === record.stepId && p.attempt === record.attempt && p.scope === record.scope;
    const applies = record.outcome === 'superseded' ? item.state === 'accepted' : item.state === 'pending';
    if (!sameGroup || !applies || p.seq >= record.seq) {
      return item;
    }
    return {
      post: p,
      state: record.outcome,
      ...(record.reason === undefined ? {} : { reason: record.reason }),
    };
  });
}

function derive(posts: readonly PostRecord[], settlements: readonly SettleRecord[]): readonly BoardItem[] {
  return settlements.reduce(
    applySettlement,
    posts.map((post): BoardItem => ({ post, state: 'pending' })),
  );
}

const bySeq = (a: { readonly seq: number }, b: { readonly seq: number }): number => a.seq - b.seq;

/** Reads one record. Total: a record already read, or one out of order, never throws or corrupts the state. */
export function reduceBoard(state: BoardState, record: BoardFileRecord): BoardState {
  switch (record.type) {
    case 'board':
      return state.started ? state : { ...state, started: true, workflow: record.workflow };
    case 'unknown':
      return { ...state, unknown: state.unknown + 1 };
    case 'truncated':
      return { ...state, truncated: true };
    case 'post': {
      if (state.items.some((i) => i.post.seq === record.seq)) {
        return state;
      }
      const last = state.items.at(-1);
      if (last === undefined || last.post.seq < record.seq) {
        const arrived = derive(
          [record],
          state.settlements.filter((s) => s.seq > record.seq),
        );
        return { ...state, items: [...state.items, ...arrived] };
      }
      const posts = [...state.items.map((i) => i.post), record].sort(bySeq);
      return { ...state, items: derive(posts, state.settlements) };
    }
    case 'settle': {
      if (state.settlements.some((s) => s.seq === record.seq)) {
        return state;
      }
      const last = state.settlements.at(-1);
      if (last === undefined || last.seq < record.seq) {
        return {
          ...state,
          settlements: [...state.settlements, record],
          items: applySettlement(state.items, record),
        };
      }
      const settlements = [...state.settlements, record].sort(bySeq);
      return {
        ...state,
        settlements,
        items: derive(
          state.items.map((i) => i.post),
          settlements,
        ),
      };
    }
  }
}

function visible(state: BoardState): readonly BoardItem[] {
  const { step, kind, sender, settled } = state.filters;
  return state.items.filter(
    (item) =>
      (settled || item.state === 'pending' || item.state === 'accepted') &&
      (step === undefined || item.post.stepId === step) &&
      (kind === undefined || item.post.kind === kind) &&
      (sender === undefined || item.post.sender === sender),
  );
}

/** The entries the list shows, in `seq` order. */
export function visibleEntries(state: BoardState): readonly BoardItem[] {
  return visible(state);
}

/** The selected entry's position in `visibleEntries`: the cursor, else the newest. -1 when the list is empty. */
export function selectedIndex(state: BoardState): number {
  const list = visible(state);
  if (state.cursor !== undefined) {
    const at = list.findIndex((i) => i.post.seq === state.cursor);
    if (at >= 0) {
      return at;
    }
  }
  return list.length - 1;
}

/** The current value of each fact, with the step that set it: accepted facts, the highest `seq` per key, by key. */
export function factsOf(state: BoardState): readonly { readonly key: string; readonly item: BoardItem }[] {
  const latest = new Map<string, BoardItem>();
  for (const item of state.items) {
    const { step } = state.filters;
    if (
      item.state === 'accepted' &&
      item.post.kind === 'fact' &&
      item.post.key !== undefined &&
      (step === undefined || item.post.stepId === step)
    ) {
      latest.set(item.post.key, item);
    }
  }
  return [...latest]
    .map(([key, item]) => ({ key, item }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The entry the detail view shows. */
export function detailOf(state: BoardState): BoardItem | undefined {
  if (state.mode !== 'detail') {
    return undefined;
  }
  return visible(state)[selectedIndex(state)];
}

/** What the person asked to see, in words for the pane to print; empty when nothing is filtered. */
export function activeFilters(state: BoardState): readonly string[] {
  const { step, kind, sender, settled } = state.filters;
  return [
    ...(step === undefined ? [] : [`step ${step}`]),
    ...(kind === undefined ? [] : [`kind ${kind}`]),
    ...(sender === undefined ? [] : [`sender ${sender}`]),
    ...(settled ? ['including discarded and replaced entries'] : []),
  ];
}

/** The next value in a cycle: the one after `current` among `values`, none after the last. */
function next<T>(values: readonly T[], current: T | undefined): T | undefined {
  if (values.length === 0) {
    return undefined;
  }
  if (current === undefined) {
    return values[0];
  }
  return values[values.indexOf(current) + 1];
}

function kindsPresent(state: BoardState): readonly BoardEntryKind[] {
  const seen = new Set(state.items.map((i) => i.post.kind));
  return BOARD_KINDS.filter((k) => seen.has(k));
}

function sendersPresent(state: BoardState): readonly string[] {
  return [...new Set(state.items.map((i) => i.post.sender))].sort();
}

function pointAt(state: BoardState, item: BoardItem | undefined): BoardState {
  const { cursor: _old, ...rest } = state;
  return item === undefined ? rest : { ...rest, cursor: item.post.seq };
}

function withFilters(state: BoardState, filters: BoardFilters): BoardState {
  return { ...state, filters, mode: state.mode === 'detail' ? 'list' : state.mode };
}

/** A key's meaning for the board, already named by the pane. Total: an impossible request leaves the state as it was. */
export function boardAction(state: BoardState, action: BoardAction): BoardState {
  const { filters } = state;
  switch (action.type) {
    case 'step': {
      const { step: _old, ...rest } = filters;
      return withFilters(state, action.stepId === undefined ? rest : { ...rest, step: action.stepId });
    }
    case 'cycle-kind': {
      const { kind: current, ...rest } = filters;
      const to = next(kindsPresent(state), current);
      return withFilters(state, to === undefined ? rest : { ...rest, kind: to });
    }
    case 'cycle-sender': {
      const { sender: current, ...rest } = filters;
      const to = next(sendersPresent(state), current);
      return withFilters(state, to === undefined ? rest : { ...rest, sender: to });
    }
    case 'clear':
      return { ...state, filters: { settled: false }, mode: state.mode === 'detail' ? 'list' : state.mode };
    case 'toggle-settled':
      return withFilters(state, { ...filters, settled: !filters.settled });
    case 'move': {
      const list = visible(state);
      if (list.length === 0 || state.mode === 'facts') {
        return state;
      }
      const to = Math.min(Math.max(selectedIndex(state) + action.by, 0), list.length - 1);
      return pointAt(state, list[to]);
    }
    case 'first':
      return pointAt(state, visible(state)[0]);
    case 'last':
      return pointAt(state, visible(state).at(-1));
    case 'open':
      return visible(state).length === 0 || state.mode === 'facts' ? state : { ...state, mode: 'detail' };
    case 'close':
      return state.mode === 'list' ? state : { ...state, mode: 'list' };
    case 'facts':
      return { ...state, mode: state.mode === 'facts' ? 'list' : 'facts' };
  }
}
