import { describe, expect, it } from 'vitest';
import { emptyBoard } from '../src/board-state.js';
import {
  buildScreen,
  clampUi,
  computeLayout,
  initialUi,
  type KeyName,
  reduceUi,
  type UiContext,
  type UiState,
} from '../src/index.js';
import { runOf, stepOf } from './panes-fixtures.js';

const ch = (char: string): KeyName => ({ char });
const from = (extra: Partial<UiState>): UiState => ({ ...initialUi(), ...extra });
const text = (rows: readonly { text: string }[] | undefined): string =>
  (rows ?? []).map((r) => r.text).join('\n');
const options = { ascii: false, attached: false };
const state = runOf([stepOf({ id: 'build' }), stepOf({ id: 'test', status: 'PENDING' })]);

const contextFor = (columns: number, rows: number): UiContext => {
  const layout = computeLayout(columns, rows, { dock: true });
  return {
    steps: 2,
    outputLines: 10,
    pageSize: 5,
    attached: false,
    docked: layout.dockWidth > 0,
    hasBoard: true,
  };
};

describe('Tab reaches every area at every width (AC-02, AC-03)', () => {
  it('cycles steps, detail, board and back, and Shift-Tab goes the other way', () => {
    const c = contextFor(100, 30);
    let ui = initialUi();
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      ui = reduceUi(ui, 'tab', c);
      seen.push(ui.focus);
    }
    expect(seen).toEqual(['detail', 'board', 'list', 'detail']);
    expect(reduceUi(initialUi(), 'shift-tab', c).focus).toBe('board');
    expect(reduceUi(reduceUi(initialUi(), 'tab', c), 'shift-tab', c).focus).toBe('list');
  });

  it('shows the board in place of the detail while it has the keys, and gives the detail back after', () => {
    const c = contextFor(100, 30);
    const onBoard = reduceUi(reduceUi(initialUi(), 'tab', c), 'tab', c);
    expect(onBoard).toMatchObject({ focus: 'board', board: true });
    expect(reduceUi(onBoard, 'tab', c)).toMatchObject({ focus: 'list', board: false });
    expect(reduceUi(onBoard, 'shift-tab', c)).toMatchObject({ focus: 'detail', board: false });
  });

  it('docked, the board is a stop of its own and nothing is opened or closed', () => {
    const c = contextFor(200, 30);
    expect(c.docked).toBe(true);
    const onBoard = reduceUi(reduceUi(initialUi(), 'tab', c), 'tab', c);
    expect(onBoard).toMatchObject({ focus: 'board', board: false });
  });

  it('skips the board when the run has none', () => {
    const c: UiContext = { ...contextFor(100, 30), hasBoard: false };
    expect(reduceUi(reduceUi(initialUi(), 'tab', c), 'tab', c).focus).toBe('list');
  });

  it('keeps the board and the focus together after a resize (narrow, wide, narrow)', () => {
    const narrow = contextFor(100, 30);
    const wide = contextFor(200, 30);
    let ui = reduceUi(initialUi(), ch('b'), narrow);
    expect(ui).toMatchObject({ focus: 'board', board: true });
    ui = clampUi(ui, wide);
    expect(ui.board).toBe(false);
    ui = reduceUi(ui, 'tab', wide);
    expect(ui.focus).toBe('list');
    ui = clampUi(ui, narrow);
    expect(ui).toMatchObject({ focus: 'list', board: false });
  });

  it('lets Tab leave the board a run without a board showed with b, and does not skip the steps', () => {
    const c: UiContext = { ...contextFor(100, 30), hasBoard: false };
    const shown = reduceUi(initialUi(), ch('b'), c);
    expect(shown.focus).toBe('board');
    expect(reduceUi(shown, 'tab', c).focus).toBe('list');
  });

  it('keeps the focus on an area that is drawn after any key, at 40, 80, 120 and 160 columns', () => {
    const keys: KeyName[] = [
      'tab',
      'shift-tab',
      'escape',
      'enter',
      'up',
      'down',
      ch('b'),
      ch('?'),
      ch('['),
      ch('z'),
    ];
    for (const columns of [40, 80, 120, 160]) {
      const c: UiContext = { ...contextFor(columns, 24), panes: ['build'], paneCap: 1 };
      let frontier: UiState[] = [initialUi()];
      for (let depth = 0; depth < 3; depth += 1) {
        frontier = frontier.flatMap((ui) => keys.map((k) => reduceUi(ui, k, c)));
        for (const ui of frontier) {
          // a board that is neither docked nor open has no place on the screen to hold the keys
          expect(ui.focus === 'board' ? c.docked === true || ui.board : true).toBe(true);
        }
      }
    }
  });
});

describe('the titles of the areas (AC-01, AC-06, AC-07)', () => {
  it('marks the focused area and only that one, with a word, so colour is not needed', () => {
    const layout = computeLayout(100, 30, { dock: true });
    for (const focus of ['list', 'detail'] as const) {
      const titles = buildScreen(state, from({ focus }), layout, options).titles;
      expect(titles?.list.selected).toBe(focus === 'list');
      expect(titles?.detail.selected).toBe(focus === 'detail');
      expect(titles?.list.text.startsWith(focus === 'list' ? '▶ Steps' : '  Steps')).toBe(true);
      expect(titles?.detail.text.startsWith(focus === 'detail' ? '▶ Detail' : '  Detail')).toBe(true);
    }
  });

  it('uses > and plain words in ASCII mode', () => {
    const layout = computeLayout(100, 30, { dock: true });
    const titles = buildScreen(state, initialUi(), layout, { ascii: true, attached: false }).titles;
    expect(titles?.list.text).toMatch(/^> Steps \(2\)/);
    expect(titles?.detail.text).toMatch(/^ {2}Detail: build/);
  });

  it('says the board replaces the detail where it is not docked, and marks the board when docked', () => {
    const narrow = computeLayout(100, 30, { dock: true });
    const replaced = buildScreen(state, from({ focus: 'board', board: true }), narrow, options).titles;
    expect(replaced?.detail.text).toContain('Board (replaces Detail)');
    expect(replaced?.detail.selected).toBe(true);
    const wide = computeLayout(200, 30, { dock: true });
    const docked = buildScreen(state, from({ focus: 'board' }), wide, options).titles;
    expect(docked?.dock.selected).toBe(true);
    expect(docked?.detail.selected).toBe(false);
  });

  it('draws no titles under 12 rows, and the footer then carries the marker and the name', () => {
    const layout = computeLayout(100, 11);
    expect(layout.titleRows).toBe(0);
    const screen = buildScreen(state, initialUi(), layout, options);
    expect(screen.titles).toBeUndefined();
    expect(screen.footer.text.startsWith('▶ Steps')).toBe(true);
  });

  it('leaves the screens that draw no titles (Home) the rows they had', () => {
    const home = computeLayout(100, 30, { titles: false });
    expect(home.titleRows).toBe(0);
    expect(home.listRows).toBe(28);
    expect(home.detailRows).toBe(28);
  });

  it('takes one row for the title of each area from 12 rows up, and none below', () => {
    const plain = computeLayout(100, 11);
    const titled = computeLayout(100, 12);
    expect(titled.titleRows).toBe(1);
    // one row taller, one row less each for its title: the lists keep the same height
    expect(titled.listRows).toBe(plain.listRows);
    expect(titled.detailRows).toBe(plain.detailRows);
  });
});

describe('the bottom line names the area and the next stop (AC-04, AC-05)', () => {
  const layout = computeLayout(120, 30, { dock: true });
  const withBoard = { state: emptyBoard(), degraded: false };
  const footer = (ui: UiState, run = state, board = true): string =>
    buildScreen(run, ui, layout, options, board ? withBoard : undefined).footer.text;

  it('names the focused area, the key to the next one, and what the arrows do there', () => {
    expect(footer(initialUi())).toMatch(/^▶ Steps {3}Tab Detail {3}↑↓ choose a step/);
    expect(footer(from({ focus: 'detail' }))).toMatch(/^▶ Detail .*Tab Board/);
    expect(footer(from({ focus: 'board', board: true }))).toMatch(/^▶ Board .*Tab Steps/);
  });

  it('says Tab goes back to the steps from the detail when the run has no board', () => {
    expect(footer(from({ focus: 'detail' }), state, false)).toMatch(/Tab Steps/);
  });

  it('keeps the Tab hint on a narrow screen, where the line is cut from the right', () => {
    for (const ascii of [false, true]) {
      for (const columns of [40, 50]) {
        const narrow = computeLayout(columns, 24);
        for (const focus of ['list', 'detail'] as const) {
          const row = buildScreen(state, from({ focus }), narrow, { ascii, attached: false }).footer.text;
          expect(row).toMatch(/Tab (Detail|Board|Steps)/);
        }
      }
    }
  });

  it('mentions [ ] only while a step runs', () => {
    expect(footer(initialUi())).toContain('[ ] running steps');
    const idle = runOf([stepOf({ id: 'a', status: 'COMPLETED' })]);
    expect(footer(initialUi(), idle)).not.toContain('[ ]');
  });

  it('is one row and never longer than the screen', () => {
    for (const columns of [40, 60, 100]) {
      const narrow = computeLayout(columns, 24);
      const row = buildScreen(state, initialUi(), narrow, options).footer.text;
      expect(Array.from(row).length).toBeLessThanOrEqual(columns);
    }
  });
});

describe('the block of running steps names itself apart from the area focus (AC-05)', () => {
  it('labels the line under the block, in ASCII too', () => {
    const layout = computeLayout(120, 40, { panes: 1 });
    const out = buildScreen(state, initialUi(), layout, options);
    expect(out.panes?.at(-1)?.text).toMatch(/Running steps 1 of 1 {3}\[ \] move/);
    const ascii = buildScreen(state, initialUi(), layout, { ascii: true, attached: false });
    expect(text(ascii.panes)).toMatch(/-- Running steps 1 of 1 {3}\[ \] move --/);
  });
});
