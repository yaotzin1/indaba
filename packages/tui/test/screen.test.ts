import { describe, expect, it } from 'vitest';
import { buildScreen, computeLayout, initialUi, type Row, stepTone, type UiState } from '../src/index.js';
import { output, root, run, sampleRecords, status, stepStart, T } from './fixtures.js';

const opts = { ascii: false, attached: false };
const text = (rows: readonly Row[]): string => rows.map((r) => r.text).join('\n');
const ui = (extra: Partial<UiState> = {}): UiState => ({ ...initialUi(), ...extra });

describe('buildScreen', () => {
  const state = run(...sampleRecords());

  it('lists every step with a glyph and a word, and marks the selected one in text as well as inverse', () => {
    const s = buildScreen(state, ui(), computeLayout(100, 24), opts);
    expect(s.list).toHaveLength(2);
    expect(s.list[0]?.text).toContain('▸');
    expect(s.list[0]?.text).toContain('plan');
    expect(s.list[0]?.selected).toBe(true);
    expect(s.list[1]?.selected).toBe(false);
    expect(s.list[1]?.text).not.toContain('▸');
  });

  it('draws in plain ASCII when asked, with no non-ASCII character anywhere', () => {
    const s = buildScreen(state, ui(), computeLayout(100, 24), { ascii: true, attached: false });
    const all = [s.header.text, text(s.list), text(s.detail), s.footer.text].join('\n');
    for (const char of all) {
      expect(char === '\n' || (char >= ' ' && char <= '~')).toBe(true);
    }
    expect(s.list[0]?.text).toContain('>');
  });

  it('shows the output of the selected step, and follows its newest lines', () => {
    const s = buildScreen(state, ui({ selected: 1 }), computeLayout(100, 24), opts);
    expect(text(s.detail)).toContain('compiling');
    expect(text(s.detail)).not.toContain('line one');
    expect(s.outputLines).toBe(1);
  });

  it('says when a step has no output yet, and when there are no steps', () => {
    const quiet = run(root(), stepStart('a'), status('a', 'RUNNING'));
    expect(text(buildScreen(quiet, ui(), computeLayout(100, 24), opts).detail)).toContain('(no output yet)');
    const empty = run(root());
    const s = buildScreen(empty, ui(), computeLayout(100, 24), opts);
    expect(text(s.list)).toContain('waiting for steps');
    expect(text(s.detail)).toContain('Waiting for the run to start');
    expect(s.outputLines).toBe(0);
  });

  it('shows what is scrolled back and that following is paused', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `row ${i}`).join('\n');
    const many = run(root(), stepStart('a'), status('a', 'RUNNING'), output('a', 1, `${lines}\n`));
    const layout = computeLayout(100, 24);
    expect(text(buildScreen(many, ui({ scroll: 5, follow: false }), layout, opts).detail)).toContain(
      '5 lines back',
    );
    expect(text(buildScreen(many, ui({ scroll: 1, follow: false }), layout, opts).detail)).toContain(
      '1 line back',
    );
    expect(text(buildScreen(many, ui({ follow: false }), layout, opts).detail)).toContain('paused');
    expect(text(buildScreen(many, ui(), layout, opts).detail)).toContain('row 59');
    expect(text(buildScreen(many, ui({ scroll: 5, follow: false }), layout, opts).detail)).not.toContain(
      'row 59',
    );
  });

  it('never draws more rows than the panes have', () => {
    const many = run(
      root(),
      ...Array.from({ length: 40 }, (_, i) => stepStart(`s${i}`, T(i + 1))),
      output('s0', 1, 'x\n'.repeat(100)),
    );
    for (const [c, r] of [
      [100, 24],
      [60, 24],
      [40, 8],
      [200, 60],
    ] as const) {
      const layout = computeLayout(c, r);
      const s = buildScreen(many, ui(), layout, opts);
      expect(s.list.length).toBeLessThanOrEqual(layout.listRows);
      expect(s.detail.length).toBeLessThanOrEqual(Math.max(1, layout.detailRows));
    }
  });

  it('keeps the selected step inside the list window however far down it is', () => {
    const many = run(root(), ...Array.from({ length: 40 }, (_, i) => stepStart(`s${i}`, T(i + 1))));
    const layout = computeLayout(100, 24);
    for (const selected of [0, 1, 19, 39]) {
      const s = buildScreen(many, ui({ selected }), layout, opts);
      expect(s.list.filter((r) => r.selected)).toHaveLength(1);
      expect(s.list.find((r) => r.selected)?.text).toContain(`s${selected} `);
    }
  });

  it('shows only a notice, and no panes, on a terminal that is too small', () => {
    const s = buildScreen(state, ui(), computeLayout(30, 5), opts);
    expect(s.list).toHaveLength(0);
    expect(text(s.detail)).toContain('Terminal too small');
    expect(text(s.detail)).toContain('have 30x5');
    expect(text(s.detail)).toContain('--plain');
  });

  it('shows the keys instead of the output while help is open', () => {
    const s = buildScreen(state, ui({ help: true }), computeLayout(100, 24), opts);
    expect(text(s.detail)).toContain('Keys');
    expect(text(s.detail)).toContain('q, ctrl-c');
    expect(s.outputLines).toBe(0);
    const a = buildScreen(state, ui({ help: true }), computeLayout(100, 24), {
      ascii: true,
      attached: false,
    });
    expect(text(a.detail)).toContain('up/down');
  });

  it('asks about the run in the footer when the person is quitting one the screen started', () => {
    const s = buildScreen(state, ui({ confirmQuit: true }), computeLayout(100, 24), {
      ascii: false,
      attached: true,
    });
    expect(s.footer.text).toContain('d detach');
    expect(s.footer.text).toContain('c cancel');
    expect(s.footer.tone).toBe('warn');
    expect(buildScreen(state, ui(), computeLayout(100, 24), opts).footer.text).toContain('q quit');
  });

  it('removes terminal control sequences from anything an agent wrote', () => {
    const esc = String.fromCharCode(27);
    const bell = String.fromCharCode(7);
    const hostile = run(
      root(),
      stepStart('evil'),
      status('evil', 'RUNNING'),
      output('evil', 1, `${esc}[2J${esc}]0;owned${bell}clean text\n`),
    );
    const s = buildScreen(hostile, ui(), computeLayout(100, 24), opts);
    const all = [s.header.text, text(s.list), text(s.detail), s.footer.text].join('\n');
    expect(all).toContain('clean text');
    expect(all).not.toContain(esc);
    expect(all).not.toContain(bell);
    expect(all).not.toContain('owned');
  });

  it('is pure: the same input gives the same rows', () => {
    const layout = computeLayout(100, 24);
    expect(buildScreen(state, ui(), layout, opts)).toEqual(buildScreen(state, ui(), layout, opts));
  });
});

describe('stepTone', () => {
  it.each([
    ['COMPLETED', 'good'],
    ['FAILED', 'bad'],
    ['ESCALATED', 'accent'],
    ['CANCELLED', 'warn'],
    ['VALIDATING', 'warn'],
    ['RUNNING', 'info'],
    ['PENDING', 'dim'],
    ['SOMETHING_ELSE', 'normal'],
  ])('%s is %s', (statusName, tone) => {
    expect(stepTone(statusName)).toBe(tone);
  });
});
