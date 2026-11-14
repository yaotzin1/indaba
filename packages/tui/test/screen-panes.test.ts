import { describe, expect, it } from 'vitest';
import { computeLayout, initialUi, type UiState } from '../src/index.js';
import { buildScreen, outputLinesOf, reasoningLinesOf } from '../src/screen.js';
import { agent, running, runOf, stepOf } from './panes-fixtures.js';

const options = { ascii: false, attached: false };
const from = (extra: Partial<UiState>): UiState => ({ ...initialUi(), ...extra });
const text = (rows: readonly { text: string }[] | undefined): string =>
  (rows ?? []).map((r) => r.text).join('\n');

describe('the reasoning view of the detail pane (3.1, AC-02, AC-03)', () => {
  const thinking = stepOf({
    thoughts: ['first I read the file', 'then I decide'],
    partialThought: 'and now I wr',
    output: ['the answer'],
  });
  const layout = computeLayout(120, 30);

  it('shows the reasoning lines and the one being written instead of the output, and says which it shows', () => {
    const out = buildScreen(runOf([thinking]), from({ panel: 'reasoning' }), layout, options);
    const detail = text(out.detail);
    expect(detail).toContain('reasoning');
    expect(detail).toContain('first I read the file');
    expect(detail).toContain('and now I wr');
    expect(detail).not.toContain('the answer');
    const back = text(buildScreen(runOf([thinking]), from({ panel: 'output' }), layout, options).detail);
    expect(back).toContain('the answer');
    expect(back).not.toContain('first I read');
  });

  it('says there is no reasoning yet, and shows a step that has only the line being written', () => {
    const none = text(buildScreen(runOf([stepOf()]), from({ panel: 'reasoning' }), layout, options).detail);
    expect(none).toContain('(no reasoning yet)');
    const partial = text(
      buildScreen(
        runOf([stepOf({ partialThought: 'half a thou' })]),
        from({ panel: 'reasoning' }),
        layout,
        options,
      ).detail,
    );
    expect(partial).toContain('half a thou');
  });

  it('keeps the redacted text it was given, and removes control sequences', () => {
    const esc = String.fromCharCode(27);
    const step = stepOf({ thoughts: ['key is [redacted]', `bad${esc}[31m red`] });
    const detail = text(buildScreen(runOf([step]), from({ panel: 'reasoning' }), layout, options).detail);
    expect(detail).toContain('key is [redacted]');
    expect(detail).not.toContain(esc);
  });

  it('wraps a long thought, and counts the rows as drawn so scrolling reaches the first one', () => {
    const long = stepOf({ thoughts: ['word '.repeat(80)] });
    const narrow = computeLayout(80, 24);
    const lines = reasoningLinesOf(runOf([long]), initialUi(), narrow.detailWidth);
    expect(lines).toBeGreaterThan(3);
    const top = buildScreen(
      runOf([long]),
      from({ panel: 'reasoning', reasoningScroll: lines - 1 }),
      narrow,
      options,
    );
    expect(top.reasoningLines).toBe(lines);
    expect(text(top.detail)).toContain('word');
    // scrolled to the end of the old text, the divider says how far back it is
    expect(text(top.detail)).toContain('line');
  });

  it('keeps the place in the reasoning apart from the place in the output', () => {
    const step = stepOf({
      output: Array.from({ length: 60 }, (_, i) => `out ${i}`),
      thoughts: Array.from({ length: 60 }, (_, i) => `think ${i}`),
    });
    const small = computeLayout(100, 14);
    const a = buildScreen(
      runOf([step]),
      from({ panel: 'reasoning', scroll: 30, reasoningScroll: 0 }),
      small,
      options,
    );
    expect(text(a.detail)).toContain('think 59');
    const b = buildScreen(
      runOf([step]),
      from({ panel: 'output', scroll: 30, reasoningScroll: 0 }),
      small,
      options,
    );
    expect(text(b.detail)).not.toContain('out 59');
  });

  it('shows a debate result, outcome and rounds, in both views, and nothing before there is one', () => {
    const debate = stepOf({ consensus: { outcome: 'ACCEPTED', rounds: 3 } });
    for (const panel of ['output', 'reasoning'] as const) {
      const detail = text(buildScreen(runOf([debate]), from({ panel }), layout, options).detail);
      expect(detail).toContain('consensus: ACCEPTED after 3 round(s)');
      expect(text(buildScreen(runOf([stepOf()]), from({ panel }), layout, options).detail)).not.toContain(
        'consensus',
      );
    }
  });
});

describe('the panes on the screen (3.2, 3.3)', () => {
  it('draws no pane when nothing runs, and the list and detail rows are what they were (AC-01)', () => {
    const run = runOf([stepOf({ status: 'COMPLETED', output: ['x'] })]);
    for (const [c, r] of [
      [40, 8],
      [80, 24],
      [160, 50],
    ] as const) {
      const layout = computeLayout(c, r, { panes: 0 });
      const screen = buildScreen(run, initialUi(), layout, options);
      expect(screen.panes ?? []).toEqual([]);
      const base = buildScreen(run, initialUi(), computeLayout(c, r), options);
      expect(screen.list).toEqual(base.list);
      expect(screen.detail).toEqual(base.detail);
    }
  });

  it('draws a pane for the running step above the detail pane, with the rule under it', () => {
    const run = runOf([stepOf({ output: ['alpha', 'beta'] })]);
    const layout = computeLayout(120, 40, { panes: 1 });
    const screen = buildScreen(run, initialUi(), layout, options);
    expect(screen.panes).toHaveLength(layout.paneRows + 1);
    expect(screen.panes?.[0]?.text).toContain('running');
    expect(text(screen.panes)).toContain('beta');
    expect(screen.panes?.at(-1)?.tone).toBe('dim');
    expect(screen.detail.length).toBeLessThanOrEqual(layout.detailRows);
  });

  it('has no pane at 40 by 8, and at 80 by 24 fits as many as a third of the detail allows', () => {
    const small = buildScreen(runOf(running(12)), initialUi(), computeLayout(40, 8, { panes: 12 }), options);
    expect(small.panes ?? []).toEqual([]);
    const layout = computeLayout(80, 24, { panes: 12 });
    const screen = buildScreen(runOf(running(12)), initialUi(), layout, options);
    expect(layout.paneCap).toBe(Math.floor(layout.paneRows / 4));
    expect((screen.panes ?? []).length).toBe(layout.paneRows + 1);
    expect(text(screen.panes)).toContain(`+${12 - layout.paneCap} more`);
  });

  it('with 12 running steps never draws more rows than the layout gave, at 40x8, 80x24 and 160x50 (AC-06)', () => {
    for (const [c, r] of [
      [40, 8],
      [80, 24],
      [160, 50],
    ] as const) {
      const layout = computeLayout(c, r, { panes: 12 });
      const screen = buildScreen(runOf(running(12)), initialUi(), layout, options);
      const drawn = (screen.panes ?? []).length;
      expect(drawn).toBeLessThanOrEqual(layout.paneRows + 1);
      expect(screen.detail.length).toBeLessThanOrEqual(Math.max(1, layout.detailRows));
      for (const row of screen.panes ?? []) {
        expect(Array.from(row.text).length).toBeLessThanOrEqual(layout.detailWidth);
      }
    }
  });

  it('keeps each pane to the tail of its step, bounded by what the view model stores', () => {
    const many = stepOf({ output: Array.from({ length: 500 }, (_, i) => `row ${i}`) });
    const screen = buildScreen(runOf([many]), initialUi(), computeLayout(120, 40, { panes: 1 }), options);
    expect(text(screen.panes)).toContain('row 499');
    expect(text(screen.panes)).not.toContain('row 496');
  });

  it('conveys the state without colour: a glyph and a word, in the title of the pane and in the step list (AC-04)', () => {
    const run = runOf([
      stepOf({ id: 'a' }),
      stepOf({ id: 'b', status: 'FAILED' }),
      stepOf({ id: 'c', status: 'ESCALATED' }),
    ]);
    const screen = buildScreen(run, initialUi(), computeLayout(120, 40, { panes: 1 }), {
      ascii: true,
      attached: false,
    });
    expect(text(screen.panes)).toMatch(/^. running {2}a/);
    const list = screen.list.map((r) => r.text);
    expect(list[1]).toContain('failed');
    expect(list[2]).toContain('escalated');
    // the three states differ in their words, so removing every tone loses nothing
    expect(new Set([list[0], list[1], list[2]].map((l) => l?.replace(/\s+/g, ' ').split(' ')[2])).size).toBe(
      3,
    );
    expect(text([...screen.list, ...(screen.panes ?? [])])).toMatch(/^[\x20-\x7e\n]*$/);
  });

  it('shows the cost of a pane as unknown when no price was given, never as zero', () => {
    const run = runOf([stepOf({ runners: [agent(undefined)] })]);
    const screen = buildScreen(run, initialUi(), computeLayout(120, 40, { panes: 1 }), options);
    expect(screen.panes?.[0]?.text).toContain('cost unknown');
    expect(screen.panes?.[0]?.text).not.toContain('$0');
  });
});

describe('an enlarged pane (3.4)', () => {
  const run = runOf([
    stepOf({ id: 'first', output: ['first output'] }),
    stepOf({ id: 'second', output: ['second output'], thoughts: ['second thinking'] }),
  ]);

  it('shows the step of the focused pane whatever the list has selected, over the whole detail pane', () => {
    const layout = computeLayout(120, 40);
    const ui = from({ selected: 0, enlarged: true, pane: 'second', focus: 'detail' });
    const screen = buildScreen(run, ui, layout, options);
    expect(text(screen.detail)).toContain('second output');
    expect(text(screen.detail)).not.toContain('first output');
    expect(text(screen.detail)).toContain('enlarged, Esc to return');
    expect(screen.panes ?? []).toEqual([]);
    // the other view of the same step is still reachable
    expect(text(buildScreen(run, { ...ui, panel: 'reasoning' }, layout, options).detail)).toContain(
      'second thinking',
    );
    expect(reasoningLinesOf(run, ui, layout.detailWidth)).toBe(1);
  });

  it('shows the selected step again once it is put back', () => {
    const ui = from({ selected: 0, enlarged: false, pane: 'second' });
    expect(text(buildScreen(run, ui, computeLayout(120, 40), options).detail)).toContain('first output');
  });

  it('says what it is showing when the step is gone, instead of failing', () => {
    const ui = from({ enlarged: true, pane: 'gone', focus: 'detail' });
    const screen = buildScreen(run, ui, computeLayout(120, 40), options);
    expect(screen.detail.length).toBeGreaterThan(0);
  });

  it('says in the footer that the step is no longer running, once, and only then', () => {
    const noted = buildScreen(
      run,
      from({ notice: 'step is no longer running' }),
      computeLayout(120, 40),
      options,
    );
    expect(noted.footer.text).toBe('step is no longer running');
    expect(buildScreen(run, initialUi(), computeLayout(120, 40), options).footer.text).toContain('q quit');
  });
});

describe('what the review of the first version found', () => {
  const layout = computeLayout(80, 24, { panes: 12 });
  const run = runOf(running(12));

  it('gives the help and a board in place of the detail pane the rows the panes would have had', () => {
    const none = computeLayout(80, 24);
    const help = buildScreen(run, from({ help: true }), layout, options);
    expect(help.detail.length).toBeGreaterThan(layout.detailRows);
    expect(help.detail.length).toBeLessThanOrEqual(none.detailRows);
    const board = buildScreen(run, from({ board: true, focus: 'board' }), layout, options);
    expect(board.panes ?? []).toEqual([]);
  });

  it('shows the question about a run before any news, because d and c answer it', () => {
    const both = buildScreen(
      run,
      from({ confirmQuit: true, notice: 'step is no longer running' }),
      layout,
      options,
    );
    expect(both.footer.text).toContain('d detach');
    expect(both.footer.text).not.toContain('no longer running');
  });

  it('counts the rows of the output as drawn, so a long wrapped line can be scrolled to its start', () => {
    const long = stepOf({ output: ['x'.repeat(800)] });
    const narrow = computeLayout(80, 10);
    const lines = outputLinesOf(runOf([long]), initialUi(), narrow.detailWidth);
    expect(lines).toBe(Math.ceil(800 / narrow.detailWidth));
    expect(lines).toBeGreaterThan(narrow.detailRows);
    const top = buildScreen(runOf([long]), from({ scroll: lines - 1, follow: false }), narrow, options);
    expect(top.outputLines).toBe(lines);
    expect(text(top.detail)).toContain('back, f to follow');
  });

  it('shows the exact row at the top of a scrolled reasoning, and how far back it is', () => {
    const step = stepOf({ thoughts: Array.from({ length: 40 }, (_, i) => `thought number ${i}`) });
    const small = computeLayout(100, 14);
    expect(reasoningLinesOf(runOf([step]), initialUi(), small.detailWidth)).toBe(40);
    const back = buildScreen(runOf([step]), from({ panel: 'reasoning', reasoningScroll: 5 }), small, options);
    expect(text(back.detail)).toContain('5 lines back');
    expect(text(back.detail)).toContain('thought number 34');
    expect(text(back.detail)).not.toContain('thought number 39');
  });

  it('removes control sequences from every text a pane or the detail shows: partial lines, thoughts, waiting-for, outcome', () => {
    const esc = String.fromCharCode(27);
    const step = stepOf({
      output: [`o${esc}[31m`],
      partialLine: `p${esc}]0;title`,
      thoughts: [`t${esc}[2J`],
      partialThought: `q${esc}[0m`,
      waitingFor: `w${esc}[1m`,
      consensus: { outcome: `ok${esc}[0m`, rounds: 2 },
    });
    for (const panel of ['output', 'reasoning'] as const) {
      const screen = buildScreen(
        runOf([step]),
        from({ panel }),
        computeLayout(120, 40, { panes: 1 }),
        options,
      );
      expect(text([...screen.list, ...screen.detail, ...(screen.panes ?? []), screen.footer])).not.toContain(
        esc,
      );
    }
  });

  it('never shows an unknown cost as zero, in a pane or on the detail', () => {
    const unknown = runOf([stepOf({ runners: [agent(undefined)] })]);
    const screen = buildScreen(unknown, initialUi(), computeLayout(120, 40, { panes: 1 }), options);
    const shown = text([...(screen.panes ?? []), ...screen.detail]);
    expect(shown).toContain('cost unknown');
    expect(shown).not.toContain('$0');
  });
});

describe('the help', () => {
  it('names the new keys', () => {
    const screen = buildScreen(runOf([stepOf()]), from({ help: true }), computeLayout(120, 40), options);
    const help = text(screen.detail);
    expect(help).toContain('r / o');
    expect(help).toContain('[ ]');
    expect(help).toContain('Enter, z');
  });
});
