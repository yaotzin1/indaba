import { sanitize } from '@indaba/engine';
import {
  activeFilters,
  type BoardEntryKind,
  type BoardEntryState,
  type BoardItem,
  type BoardState,
  boardAction,
  detailOf,
  factsOf,
  selectedIndex,
  visibleEntries,
} from './board-state.js';
import { clip, wrap } from './layout.js';
import type { Row, Tone } from './screen.js';
import type { KeyName } from './ui-state.js';

/** What the board pane draws from: the board as read so far, and whether the run said it could not write it all. */
export interface BoardPane {
  readonly state: BoardState;
  readonly degraded: boolean;
}

interface Mark {
  readonly glyph: string;
  readonly ascii: string;
  readonly word: string;
}

/** Every kind has a glyph and a word, so colour is never the only sign of one (AC-37). */
export const KIND_MARKS: Readonly<Record<BoardEntryKind, Mark>> = {
  note: { glyph: '●', ascii: 'o', word: 'Note' },
  question: { glyph: '?', ascii: '?', word: 'Question' },
  result: { glyph: '▣', ascii: '=', word: 'Result' },
  fact: { glyph: '■', ascii: '#', word: 'Fact' },
  decision: { glyph: '◆', ascii: '!', word: 'Decision' },
  proposal: { glyph: '▷', ascii: '>', word: 'Proposal' },
  critique: { glyph: '✖', ascii: 'x', word: 'Critique' },
  agreement: { glyph: '✔', ascii: '+', word: 'Agreement' },
  tool_intent: { glyph: '⚙', ascii: '$', word: 'Tool request' },
};

const STATE_WORD: Readonly<Record<BoardEntryState, string>> = {
  pending: 'pending',
  accepted: 'accepted',
  discarded: 'discarded',
  superseded: 'replaced',
};

const row = (text: string, tone: Tone = 'normal', selected = false): Row => ({ text, tone, selected });

/** Board text came from an agent: it is filtered for the terminal here, whatever was stored, and kept on one line. */
function safe(text: string): string {
  return sanitize(text).replace(/\s+/g, ' ').trim();
}

function mark(kind: BoardEntryKind, ascii: boolean): string {
  const m = KIND_MARKS[kind];
  return `${ascii ? m.ascii : m.glyph} ${m.word}`;
}

function stateNote(item: BoardItem): string {
  return item.state === 'accepted' ? '' : ` (${STATE_WORD[item.state]})`;
}

function tone(item: BoardItem): Tone {
  switch (item.state) {
    case 'pending':
      return 'info';
    case 'accepted':
      return 'normal';
    default:
      return 'dim';
  }
}

function listLine(item: BoardItem, selected: boolean, width: number, ascii: boolean): Row {
  const { post } = item;
  const text = `#${post.seq}  ${safe(post.stepId)}  ${safe(post.sender)}  ${mark(post.kind, ascii)}${stateNote(item)}  ${safe(post.text)}`;
  return row(clip(text, width, ascii), tone(item), selected);
}

/** The lines the legend shows, by what the pane is showing. Also the board part of the help screen. */
export function boardKeyLines(mode: BoardState['mode'], ascii: boolean): readonly string[] {
  const arrows = ascii ? 'up/down' : '↑↓';
  switch (mode) {
    case 'detail':
      return [`Esc back to the list   ${arrows} previous or next entry   b close the board`];
    case 'facts':
      return ['f back to the list   s step   x clear   b close the board'];
    case 'list':
      return [
        `${arrows} move   Enter open   s step   t kind   r sender`,
        'x clear   f facts   d show or hide discarded   b close the board',
      ];
  }
}

/** The board keys for the help screen, one per line. */
export function boardHelpRows(width: number, ascii: boolean): Row[] {
  const arrows = ascii ? 'up/down' : '↑/↓';
  return [
    row('Board keys (b opens the board; tab moves the arrow keys)', 'accent'),
    row(`${arrows}, j/k   move`, 'normal'),
    row('Enter        open an entry', 'normal'),
    row('Esc          back, then close the board', 'normal'),
    row('s            only the selected step', 'normal'),
    row('t / r        cycle the kind / the sender', 'normal'),
    row('x            clear the filters', 'normal'),
    row('f            the facts', 'normal'),
    row('d            show or hide discarded and replaced entries', 'normal'),
  ].map((r) => ({ ...r, text: clip(r.text, width, ascii) }));
}

function notices(pane: BoardPane, width: number, ascii: boolean): Row[] {
  const { state } = pane;
  const out: Row[] = [];
  if (!state.started && state.items.length === 0) {
    out.push(
      row(clip('No board file yet. It appears when the run first writes to the board.', width, ascii), 'dim'),
    );
  }
  if (pane.degraded) {
    out.push(row(clip('The board is incomplete: part of it could not be saved.', width, ascii), 'warn'));
  }
  if (state.unknown > 0) {
    out.push(
      row(
        clip(`${state.unknown} line(s) of the board could not be read and are left out.`, width, ascii),
        'warn',
      ),
    );
  }
  if (state.truncated) {
    out.push(row(clip('The board reached its size limit; later notes were not kept.', width, ascii), 'warn'));
  }
  return out;
}

function detailLines(item: BoardItem, width: number, ascii: boolean): Row[] {
  const { post } = item;
  // few rows for the fields, so the text of the entry keeps the room
  const groups: string[] = [
    `Step: ${safe(post.stepId)}   Attempt: ${post.attempt}   Sender: ${safe(post.sender)}`,
    `Kind: ${mark(post.kind, ascii)}   State: ${STATE_WORD[item.state]}${post.round === undefined ? '' : `   Round: ${post.round}`}`,
    `Time: ${safe(post.at)}${post.key === undefined ? '' : `   Name: ${safe(post.key)}`}`,
    ...(item.reason === undefined ? [] : [`Why: ${safe(item.reason)}`]),
  ];
  const head = groups.map((line) => row(clip(line, width, ascii)));
  const body = wrap(safe(post.text), width).map((line) => row(line));
  const cut = post.cut ? [row(clip('(this entry was cut to the size limit)', width, ascii), 'dim')] : [];
  return [...head, row(''), ...body, ...cut];
}

/** The window of `rows` that keeps `at` in view, roughly in the middle. */
function windowOf<T>(rows: readonly T[], at: number, height: number): T[] {
  const start = Math.min(Math.max(0, at - Math.floor(height / 2)), Math.max(0, rows.length - height));
  return rows.slice(start, start + height);
}

/**
 * The board pane as rows (AC-33 to AC-38). Pure: the same board and size always give the same rows. Every string is
 * sanitised here, so nothing an agent wrote reaches a component as anything but text.
 */
export function boardRows(
  pane: BoardPane | undefined,
  width: number,
  height: number,
  options: { readonly ascii: boolean },
): Row[] {
  const { ascii } = options;
  if (pane === undefined) {
    return [row(clip('There is no board for this run.', width, ascii), 'dim')].slice(0, Math.max(1, height));
  }
  const { state } = pane;
  const entries = visibleEntries(state);
  const title = row(clip(`Board: notes between steps (${state.items.length})`, width, ascii), 'accent');
  const filters = activeFilters(state);
  const shown = row(
    clip(`Showing: ${filters.length === 0 ? 'everything' : filters.join(', ')}`, width, ascii),
    'dim',
  );
  const head = [title, ...notices(pane, width, ascii), shown];
  const legend = boardKeyLines(state.mode, ascii).map((line) => row(clip(line, width, ascii), 'dim'));
  const room = Math.max(1, height - head.length - legend.length);

  let body: Row[];
  if (state.mode === 'facts') {
    const facts = factsOf(state).map(({ key, item }) =>
      row(clip(`${safe(key)}: ${safe(item.post.text)}  (${safe(item.post.stepId)})`, width, ascii)),
    );
    body = facts.length === 0 ? [row('No facts yet.', 'dim')] : facts.slice(0, room);
  } else if (state.mode === 'detail') {
    const item = detailOf(state);
    const lines = item === undefined ? [row('Nothing is selected.', 'dim')] : detailLines(item, width, ascii);
    body =
      lines.length <= room
        ? lines
        : [
            ...lines.slice(0, Math.max(0, room - 1)),
            row(
              clip(
                `(${lines.length - room + 1} more lines do not fit; make the terminal taller)`,
                width,
                ascii,
              ),
              'dim',
            ),
          ];
  } else if (entries.length === 0) {
    body = [
      row(state.items.length === 0 ? 'Nothing has been added yet.' : 'No entry matches the filters.', 'dim'),
    ];
  } else {
    // rows are built only for the window: a board of 2000 entries is not sanitised in full on every key press
    const at = selectedIndex(state);
    const first = Math.min(Math.max(0, at - Math.floor(room / 2)), Math.max(0, entries.length - room));
    body = entries
      .slice(first, first + room)
      .map((item, i) => listLine(item, first + i === at, width, ascii));
  }
  return [...head, ...body, ...legend].slice(0, Math.max(1, height));
}

export interface BoardKeyContext {
  /** The step selected in the step list, for the step filter. */
  readonly stepId?: string;
  /** Rows of the board's body, for paging. */
  readonly pageSize: number;
}

/**
 * What a key does while the board has the arrow keys. `undefined` means the key is not the board's: the dashboard
 * handles it (quit, help, tab, and Esc once the board is back at its list).
 */
export function boardKey(
  state: BoardState,
  press: KeyName,
  context: BoardKeyContext,
): BoardState | undefined {
  if (press === 'up') return boardAction(state, { type: 'move', by: -1 });
  if (press === 'down') return boardAction(state, { type: 'move', by: 1 });
  if (press === 'pageup') return boardAction(state, { type: 'move', by: -Math.max(1, context.pageSize) });
  if (press === 'pagedown') return boardAction(state, { type: 'move', by: Math.max(1, context.pageSize) });
  if (press === 'home') return boardAction(state, { type: 'first' });
  if (press === 'end') return boardAction(state, { type: 'last' });
  if (press === 'enter') return boardAction(state, { type: 'open' });
  if (press === 'escape') return state.mode === 'list' ? undefined : boardAction(state, { type: 'close' });
  if (typeof press !== 'object') return undefined;
  switch (press.char) {
    case 'k':
      return boardAction(state, { type: 'move', by: -1 });
    case 'j':
      return boardAction(state, { type: 'move', by: 1 });
    case 'g':
      return boardAction(state, { type: 'first' });
    case 'G':
      return boardAction(state, { type: 'last' });
    case 's': {
      if (context.stepId === undefined) return state;
      return boardAction(state, {
        type: 'step',
        stepId: state.filters.step === context.stepId ? undefined : context.stepId,
      });
    }
    case 't':
      return boardAction(state, { type: 'cycle-kind' });
    case 'r':
      return boardAction(state, { type: 'cycle-sender' });
    case 'x':
      return boardAction(state, { type: 'clear' });
    case 'f':
      return boardAction(state, { type: 'facts' });
    case 'd':
      return boardAction(state, { type: 'toggle-settled' });
    default:
      return undefined;
  }
}
