import { describe, expect, it } from 'vitest';
import { buildHomeScreen, costText } from '../src/home-screen.js';
import { type HomeState, initialHome } from '../src/home-state.js';
import { computeLayout } from '../src/layout.js';
import { makeRun, runs } from './home-fixtures.js';

const options = { ascii: false, canOpen: true };
const stateWith = (list: ReturnType<typeof runs>, over: Partial<HomeState> = {}): HomeState => ({
  ...initialHome(),
  runs: list,
  loading: false,
  ...over,
});
const texts = (rows: readonly { text: string }[]): string => rows.map((r) => r.text).join('\n');

describe('Home screen', () => {
  it('says there are no runs yet, and how to start one', () => {
    const screen = buildHomeScreen(stateWith([]), computeLayout(100, 24), options);
    expect(texts(screen.list)).toContain('no runs yet');
    expect(texts(screen.list)).toContain('indaba run');
    expect(screen.header.text).toContain('(0)');
  });

  it('says it is looking while the first list loads', () => {
    const screen = buildHomeScreen(initialHome(), computeLayout(100, 24), options);
    expect(texts(screen.list)).toContain('looking for runs');
    expect(screen.header.text).toContain('loading');
    expect(texts(screen.list)).not.toContain('no runs yet');
  });

  it('shows a failure on one line and keeps the key to try again', () => {
    const screen = buildHomeScreen(stateWith([], { error: 'EACCES' }), computeLayout(100, 24), options);
    expect(texts(screen.list)).toContain('could not list the runs');
    expect(texts(screen.list)).toContain('EACCES');
    expect(texts(screen.list)).toContain('r tries again');
  });

  it('shows a failed refresh above the runs it still has', () => {
    const screen = buildHomeScreen(stateWith(runs(2), { error: 'EBUSY' }), computeLayout(100, 24), options);
    expect(screen.list[0]?.text).toContain('could not refresh');
    expect(screen.list).toHaveLength(3);
  });

  it('gives every status a mark and a word, and a tone', () => {
    const list = (['completed', 'failed', 'running', 'escalated', 'cancelled', 'unknown'] as const).map(
      (status, i) => makeRun({ runId: `r${i}`, status }),
    );
    const screen = buildHomeScreen(stateWith(list), computeLayout(120, 30), options);
    const lines = screen.list.map((r) => r.text);
    for (const [i, status] of [
      'completed',
      'failed',
      'running',
      'escalated',
      'cancelled',
      'unknown',
    ].entries()) {
      expect(lines[i]).toContain(status);
      expect(lines[i]?.trim().length).toBeGreaterThan(status.length);
    }
    expect(screen.list.map((r) => r.tone)).toEqual(['good', 'bad', 'info', 'accent', 'warn', 'warn']);
  });

  it('uses ASCII marks and no non-ASCII character in ASCII mode, even from a trace', () => {
    const list = [makeRun({ workflow: 'revïew \u{1F680}', status: 'failed' })];
    const screen = buildHomeScreen(stateWith(list), computeLayout(120, 30), { ascii: true, canOpen: true });
    const all = texts([screen.header, ...screen.list, ...screen.detail, screen.footer]);
    expect(all).toMatch(/^[\x20-\x7e\n]*$/);
    expect(all).toContain('rev?');
  });

  it('cleans the run id in the details too (a trace is untrusted)', () => {
    const esc = String.fromCharCode(27);
    const state = stateWith([makeRun({ runId: `ab${esc}[2Jc${String.fromCharCode(233)}` })]);
    const wide = buildHomeScreen(state, computeLayout(100, 24), { ascii: true, canOpen: true });
    const shown = texts(wide.detail);
    expect(shown).not.toContain(esc);
    expect(shown.split(String.fromCharCode(10)).every((line) => /^[ -~]*$/.test(line))).toBe(true);
    expect(shown).toContain('run      ab');
  });

  it('removes control sequences that came from a trace', () => {
    const esc = String.fromCharCode(27);
    const list = [makeRun({ workflow: `bad${esc}[31mname` })];
    const screen = buildHomeScreen(stateWith(list), computeLayout(120, 30), options);
    expect(texts(screen.list)).not.toContain(esc);
  });

  it('marks the selected run, and keeps it in view in a long list', () => {
    const state = stateWith(runs(40), { selected: 30 });
    const layout = computeLayout(100, 14);
    const screen = buildHomeScreen(state, layout, options);
    const selected = screen.list.filter((r) => r.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.text).toContain('wf-30');
    expect(screen.list.length).toBeLessThanOrEqual(layout.listRows);
  });

  it('shows the details of the selected run beside the list from 80 columns, and the list alone below', () => {
    const state = stateWith(runs(3), { selected: 1 });
    const wide = buildHomeScreen(state, computeLayout(80, 24), options);
    expect(texts(wide.detail)).toContain('a1');
    expect(texts(wide.detail)).toContain('wf-1');
    const narrow = buildHomeScreen(state, computeLayout(79, 24), options);
    expect(narrow.detail).toEqual([]);
    expect(narrow.list.length).toBe(3);
  });

  it('shows the key line, and the detach question when quitting needs one', () => {
    const plain = buildHomeScreen(stateWith(runs(1)), computeLayout(100, 24), options);
    expect(plain.footer.text).toContain('Enter open the run');
    expect(plain.footer.text).toContain('q quit');
    const without = buildHomeScreen(stateWith(runs(1)), computeLayout(100, 24), {
      ascii: false,
      canOpen: false,
    });
    expect(without.footer.text).not.toContain('Enter');
    const asking = buildHomeScreen(
      stateWith(runs(1), { confirmQuit: true }),
      computeLayout(100, 24),
      options,
    );
    expect(asking.footer.text).toContain('detach');
    expect(asking.footer.text).toContain('stop the run');
  });

  it('replaces the list with the keys when help is open on a narrow terminal', () => {
    const narrow = buildHomeScreen(stateWith(runs(2), { help: true }), computeLayout(60, 24), options);
    expect(texts(narrow.list)).toContain('Keys');
    expect(texts(narrow.list)).not.toContain('wf-0');
  });

  it('draws only a notice below the floor of 40 by 8', () => {
    for (const [c, r] of [
      [39, 24],
      [100, 7],
      [0, 0],
    ] as const) {
      const screen = buildHomeScreen(stateWith(runs(2)), computeLayout(c, r), options);
      expect(texts(screen.detail)).toContain('Terminal too small');
      expect(screen.list).toEqual([]);
    }
  });

  it('fits every line in the width at 40, 80 and 160 columns', () => {
    for (const columns of [40, 80, 160]) {
      const layout = computeLayout(columns, 24);
      const screen = buildHomeScreen(stateWith(runs(5), { error: 'x'.repeat(200) }), layout, options);
      const width = layout.mode === 'split' ? layout.listWidth : columns;
      for (const row of screen.list) {
        expect(Array.from(row.text).length).toBeLessThanOrEqual(width);
      }
      expect(Array.from(screen.footer.text).length).toBeLessThanOrEqual(columns);
      expect(Array.from(screen.header.text).length).toBeLessThanOrEqual(columns);
    }
  });
});

describe('cost text', () => {
  it('shows nothing for a run with no model call, the price when known, and unpriced calls as unpriced', () => {
    expect(costText({ usd: 0, unknown: 0, calls: 0 })).toBe('-');
    expect(costText({ usd: 0.456, unknown: 0, calls: 2 })).toBe('$0.46');
    expect(costText({ usd: 0.1, unknown: 2, calls: 3 })).toBe('$0.10+2 unpriced');
  });
});
