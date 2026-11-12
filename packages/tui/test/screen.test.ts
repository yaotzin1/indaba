import type { RunRecord } from '@indaba/engine';
import { describe, expect, it } from 'vitest';
import { buildScreen, computeLayout, initialUi, type Row, stepTone, type UiState } from '../src/index.js';
import { output, root, run, sampleRecords, status, stepStart, T, TRACE } from './fixtures.js';

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

  it('lists the earlier attempts of a retried step, one row each, and not the current one', () => {
    const retried = run(
      root(),
      stepStart('a'),
      status('a', 'RUNNING', undefined, T(10)),
      status('a', 'FAILED', 'tests red\nsecond line', T(13)),
      status('a', 'RUNNING', undefined, T(20)),
      status('a', 'FAILED', `bad${String.fromCharCode(27)}[31m thing`, T(80)),
      status('a', 'RUNNING', undefined, T(90)),
    );
    const rows = buildScreen(retried, ui(), computeLayout(100, 24), opts).detail.map((r) => r.text);
    expect(rows).toContain('attempt 1: failed after 3s: tests red');
    expect(rows.some((r) => r.startsWith('attempt 2: failed after 1m00s: bad'))).toBe(true);
    expect(rows.some((r) => r.includes('attempt 3:'))).toBe(false);
    expect(rows.join('')).not.toContain(String.fromCharCode(27));
  });

  it('shows no attempt rows for a step that ran once', () => {
    const once = run(root(), stepStart('a'), status('a', 'RUNNING'), status('a', 'FAILED', 'x'));
    expect(text(buildScreen(once, ui(), computeLayout(100, 24), opts).detail)).not.toContain('attempt 1:');
  });

  it('says a finished step printed nothing, with the exit code when a runner reported one', () => {
    const shell = (code: number): RunRecord[] => [
      {
        type: 'span_started',
        at: T(2),
        traceId: TRACE,
        spanId: 'p-a',
        parentSpanId: 's-a',
        name: 'execute_tool shell',
        attributes: { 'indaba.runner': 'shell' },
      },
      {
        type: 'span_ended',
        at: T(3),
        traceId: TRACE,
        spanId: 'p-a',
        status: 'error',
        statusMessage: undefined,
        attributes: { 'indaba.exit_code': code },
        events: [],
      },
    ];
    const layout = computeLayout(100, 24);
    const silent = run(root(), stepStart('a'), status('a', 'RUNNING'), status('a', 'COMPLETED'));
    expect(text(buildScreen(silent, ui(), layout, opts).detail)).toContain('(no output)');
    const failed = run(
      root(),
      stepStart('a'),
      status('a', 'RUNNING'),
      ...shell(7),
      status('a', 'FAILED', 'x'),
    );
    expect(text(buildScreen(failed, ui(), layout, opts).detail)).toContain('(no output, exit code 7)');
  });

  it('does not repeat in the reason what the output pane already shows, but keeps the first line', () => {
    const failed = run(
      root(),
      stepStart('a'),
      status('a', 'RUNNING'),
      output('a', 1, 'boom: file missing\n'),
      status('a', 'FAILED', 'Command `x` exited with code 5.\nboom: file missing\nsomething else'),
    );
    const detail = buildScreen(failed, ui(), computeLayout(100, 24), opts).detail.map((r) => r.text);
    expect(detail.filter((line) => line.includes('boom: file missing'))).toHaveLength(1);
    expect(detail).toContain('reason: Command `x` exited with code 5.');
    expect(detail).toContain('reason: something else');
  });

  it('wraps a long output line over several rows instead of cutting it', () => {
    const long = `${'a'.repeat(60)}${'b'.repeat(60)}END`;
    const wrapped = run(root(), stepStart('a'), status('a', 'RUNNING'), output('a', 1, `${long}\n`));
    const s = buildScreen(wrapped, ui(), computeLayout(100, 24), opts);
    const rows = s.detail.map((r) => r.text);
    expect(rows.join('')).toContain(long);
    expect(rows.some((r) => r.includes('…'))).toBe(false);
    expect(s.outputLines).toBeGreaterThan(1);
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

describe('reasoning in the detail pane', () => {
  const esc = String.fromCharCode(27);
  const thought = (id: string, text: string): RunRecord => ({
    type: 'thought',
    at: T(3),
    traceId: TRACE,
    spanId: `s-${id}`,
    seq: 0,
    text,
    cut: false,
  });

  it('says how many lines of reasoning a step has, and shows none of them in the output', () => {
    const state = run(
      root(),
      stepStart('a'),
      status('a', 'RUNNING'),
      output('a', 1, 'the answer\n'),
      thought('a', `one\ntwo\n${esc}[2Jthree`),
    );
    const detail = text(buildScreen(state, ui(), computeLayout(100, 24), opts).detail);
    expect(detail).toContain('reasoning: 3 line(s)');
    expect(detail).toContain('the answer');
    expect(detail).not.toContain('two');
    expect(detail).not.toContain(esc);
  });

  it('says nothing about reasoning when there was none', () => {
    const state = run(root(), stepStart('a'), status('a', 'RUNNING'), output('a', 1, 'x\n'));
    expect(text(buildScreen(state, ui(), computeLayout(100, 24), opts).detail)).not.toContain('reasoning');
  });
});

describe('steps that run at the same time (specs/parallel-steps, AC-30)', () => {
  const state = run(...sampleRecords());

  it('marks every running step in the list and says how many run in the header', () => {
    const s = buildScreen(state, ui(), computeLayout(100, 24), opts);
    expect(s.list.filter((row) => row.text.includes('running'))).toHaveLength(2);
    expect(s.header.text).toContain('2 running');
  });

  it('marks a step that waits for another in the list and in the detail, with the one it waits for', () => {
    const waiting: RunRecord = {
      type: 'span_started',
      at: T(3),
      traceId: TRACE,
      spanId: 'w-b',
      parentSpanId: undefined,
      name: 'indaba.step.wait',
      attributes: { 'indaba.step.id': 'b', 'indaba.wait.blocker': 'a', 'indaba.wait.count': 1 },
    };
    const records = [...sampleRecords(), { ...waiting, parentSpanId: 'r'.repeat(16) }];
    const state = run(...records);
    const selected = state.steps.findIndex((step) => step.id === 'b');
    expect(selected).toBeGreaterThanOrEqual(0);
    const s = buildScreen(state, ui({ selected }), computeLayout(100, 24), opts);
    expect(s.list.some((row) => row.text.includes('waiting for a'))).toBe(true);
    expect(text(s.detail)).toContain('waiting for a');
  });

  it('keeps the output of each running step apart, whichever is selected', () => {
    const first = buildScreen(state, ui({ selected: 0 }), computeLayout(100, 24), opts);
    const second = buildScreen(state, ui({ selected: 1 }), computeLayout(100, 24), opts);
    expect(text(first.detail)).toContain('line one');
    expect(text(first.detail)).not.toContain('compiling');
    expect(text(second.detail)).toContain('compiling');
    expect(text(second.detail)).not.toContain('line one');
  });
});
