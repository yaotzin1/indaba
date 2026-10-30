import type { BoardFileRecord } from '@indaba/engine';
import { describe, expect, it, vi } from 'vitest';

// as in dashboard.test.ts: the fake terminal must look like one that shows colour, and CI must not make Ink draw only once
vi.hoisted(() => {
  process.env.FORCE_COLOR = '1';
  process.env.CI = 'true';
});

import { emptyBoard, reduceBoard } from '../src/board-state.js';
import { runDashboard } from '../src/dashboard.js';
import {
  buildScreen,
  clampUi,
  computeLayout,
  DOCK_COLUMNS,
  initialUi,
  reduceUi,
  SPLIT_COLUMNS,
  type UiContext,
  type UiState,
} from '../src/index.js';
import { run, sampleRecords, TRACE } from './fixtures.js';
import { FakeStdin, FakeStdout, until } from './terminal.js';

const AT = '2026-10-30T12:00:00.000Z';
const ctx = (docked: boolean): UiContext => ({
  steps: 2,
  outputLines: 5,
  pageSize: 5,
  attached: false,
  docked,
});
const press = (state: UiState, key: Parameters<typeof reduceUi>[1], docked = true): UiState =>
  reduceUi(state, key, ctx(docked));
const ch = (char: string) => ({ char });

const board: readonly BoardFileRecord[] = [
  { type: 'board', v: 1, at: AT, traceId: TRACE, workflow: 'demo' },
  {
    type: 'post',
    seq: 1,
    at: AT,
    stepId: 'plan',
    attempt: 1,
    scope: 'step',
    source: 'agent',
    sender: 'plan',
    kind: 'note',
    text: 'the API is paged',
    cut: false,
  },
];

describe('the layout with a docked board (AC-33, C-13)', () => {
  it('docks the board only on a wide terminal and only when there is a board', () => {
    expect(computeLayout(DOCK_COLUMNS - 1, 30, { dock: true }).dockWidth).toBe(0);
    expect(computeLayout(DOCK_COLUMNS, 30, { dock: true }).dockWidth).toBeGreaterThan(0);
    expect(computeLayout(200, 30).dockWidth).toBe(0);
    expect(computeLayout(200, 30, { dock: false }).dockWidth).toBe(0);
    expect(computeLayout(SPLIT_COLUMNS, 30, { dock: true }).mode).toBe('split');
    expect(computeLayout(60, 30, { dock: true }).dockWidth).toBe(0);
  });

  it('gives every column its width, and the three plus two separators fill the terminal', () => {
    for (const columns of [DOCK_COLUMNS, 170, 200, 301]) {
      const l = computeLayout(columns, 30, { dock: true });
      expect(l.listWidth + l.detailWidth + l.dockWidth + 2).toBe(columns);
      expect(l.listWidth).toBeLessThanOrEqual(28);
      expect(l.dockWidth).toBeGreaterThanOrEqual(40);
      expect(l.detailWidth).toBeGreaterThanOrEqual(40);
      expect(l.dockRows).toBe(28);
    }
  });

  it('leaves the layout of a terminal with no board exactly as it was', () => {
    expect(computeLayout(200, 24)).toMatchObject({
      listWidth: 32,
      detailWidth: 167,
      dockWidth: 0,
      dockRows: 0,
    });
  });
});

describe('the docked board on the screen', () => {
  const state = run(...sampleRecords());
  const pane = { state: [...board].reduce(reduceBoard, emptyBoard()), degraded: false };

  it('shows the board beside the steps and the output without a key press', () => {
    const layout = computeLayout(160, 24, { dock: true });
    const s = buildScreen(state, initialUi(), layout, { ascii: false, attached: false }, pane);
    expect(s.dock.map((r) => r.text).join('\n')).toContain('the API is paged');
    expect(s.dock.map((r) => r.text).join('\n')).toContain('Board: notes between steps (1)');
    expect(s.detail.map((r) => r.text).join('\n')).toContain('line two');
    for (const row of s.dock) {
      expect(Array.from(row.text).length).toBeLessThanOrEqual(layout.dockWidth);
    }
  });

  it('keeps the detail pane when b has the arrow keys, and says there is no board without a source', () => {
    const layout = computeLayout(160, 24, { dock: true });
    const focused = buildScreen(
      state,
      { ...initialUi(), board: true, focus: 'board' },
      layout,
      { ascii: false, attached: false },
      pane,
    );
    expect(focused.detail.map((r) => r.text).join('\n')).toContain('line two');
    expect(focused.footer.text).toContain('b back to the steps');
    const none = buildScreen(state, initialUi(), layout, { ascii: false, attached: false });
    expect(none.dock.map((r) => r.text).join('\n')).toContain('There is no board for this run.');
  });

  it('has no dock on a narrow terminal, where the pane still replaces the detail', () => {
    const layout = computeLayout(100, 24, { dock: true });
    const s = buildScreen(
      state,
      { ...initialUi(), board: true, focus: 'board' },
      layout,
      { ascii: false, attached: false },
      pane,
    );
    expect(s.dock).toEqual([]);
    expect(s.detail.map((r) => r.text).join('\n')).toContain('Board: notes between steps');
  });
});

describe('the keys when the board is docked', () => {
  it('moves the arrow keys to the board and back with b, and leaves the pane showing', () => {
    const on = press(initialUi(), ch('b'));
    expect(on).toMatchObject({ focus: 'board', board: false });
    expect(press(on, ch('b'))).toMatchObject({ focus: 'list' });
  });

  it('goes round the list, the detail and the board with tab', () => {
    const a = press(initialUi(), 'tab');
    const b = press(a, 'tab');
    const c = press(b, 'tab');
    expect([a.focus, b.focus, c.focus]).toEqual(['detail', 'board', 'list']);
  });

  it('gives the arrow keys back to the steps with Esc, after help', () => {
    const board = press(initialUi(), ch('b'));
    expect(press(board, 'escape').focus).toBe('list');
    expect(press(initialUi(), 'escape').focus).toBe('list');
    expect(press(press(board, ch('?')), 'escape')).toMatchObject({ help: false, focus: 'board' });
  });

  it('takes the arrow keys off the board when the terminal gets too narrow for the dock', () => {
    const on = press(initialUi(), ch('b'));
    expect(clampUi(on, ctx(true)).focus).toBe('board');
    expect(clampUi(on, ctx(false)).focus).toBe('list');
    const open = press(initialUi(), ch('b'), false);
    expect(clampUi(open, ctx(false)).focus).toBe('board');
  });
});

describe('the docked board in the dashboard', () => {
  it('shows the board as soon as it has entries, on a wide terminal, with no key pressed', async () => {
    async function* endless<T>(items: readonly T[]): AsyncGenerator<T> {
      yield* items;
      await new Promise<void>(() => {});
    }
    const stdout = new FakeStdout(160, 24);
    const stdin = new FakeStdin();
    const done = runDashboard({
      source: endless(sampleRecords()),
      board: endless(board),
      attached: false,
      ascii: false,
      color: false,
      stdout: stdout as unknown as NodeJS.WritableStream,
      stdin: stdin as unknown as NodeJS.ReadableStream,
      flushMs: 5,
    });
    await until(() => stdout.text.includes('the API is paged'));
    expect(stdout.text).toContain('line two');
    stdin.type('q');
    await done;
  });
});
