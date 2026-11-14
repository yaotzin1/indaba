import { describe, expect, it } from 'vitest';
import { computeLayout, PANE_ROWS, paneRowsFor } from '../src/layout.js';
import { paneBlockRows, panesFor, runningIds, stepCost, TAIL_ROWS } from '../src/panes.js';
import { agent, running, runOf, stepOf } from './panes-fixtures.js';

const input = { rows: 12, width: 60, focus: undefined, offset: 0, ascii: false } as const;

describe('stepCost', () => {
  it('adds what the agents cost, with four decimals like the plain output', () => {
    expect(stepCost(stepOf({ runners: [agent(0.1), agent(0.0234)] }))).toBe('$0.1234');
  });

  it('says cost unknown when no agent has a price, never $0', () => {
    expect(stepCost(stepOf({ runners: [agent(undefined)] }))).toBe('cost unknown');
    expect(stepCost(stepOf({ runners: [agent(undefined), agent(undefined)] }))).toBe('cost unknown');
  });

  it('marks a sum that leaves an unpriced agent out, so it is not mistaken for the whole', () => {
    expect(stepCost(stepOf({ runners: [agent(0.5), agent(undefined)] }))).toBe('$0.5000+');
  });

  it('counts a priced agent beside shell commands as whole, because a command costs nothing', () => {
    const command = agent(undefined, { operation: 'execute_tool', name: 'shell' });
    expect(stepCost(stepOf({ runners: [agent(0.25), command] }))).toBe('$0.2500');
    expect(stepCost(stepOf({ runners: [command, command] }))).toBe('');
  });

  it('is empty for a step that has not started a runner', () => {
    expect(stepCost(stepOf())).toBe('');
  });

  it('shows a real zero as zero', () => {
    expect(stepCost(stepOf({ runners: [agent(0)] }))).toBe('$0.0000');
  });
});

describe('the rows of the block of panes', () => {
  it('is a third of the detail pane, in whole panes of four rows, and none when that is not one', () => {
    expect(PANE_ROWS).toBe(4);
    expect(paneRowsFor(11, 3)).toBe(0);
    expect(paneRowsFor(12, 3)).toBe(4);
    expect(paneRowsFor(24, 1)).toBe(4);
    expect(paneRowsFor(24, 3)).toBe(8);
    expect(paneRowsFor(60, 12)).toBe(20);
    expect(paneRowsFor(60, 2)).toBe(8);
    expect(paneRowsFor(24, 0)).toBe(0);
    expect(paneRowsFor(-5, 4)).toBe(0);
  });

  it('is part of the layout, and takes its rows and one row for the rule from the detail pane (AC-01)', () => {
    const none = computeLayout(120, 40);
    expect(none).toMatchObject({ paneRows: 0, paneCap: 0 });
    const some = computeLayout(120, 40, { panes: 2 });
    expect(some.paneRows).toBe(8);
    expect(some.paneCap).toBe(2);
    expect(some.detailRows).toBe(none.detailRows - 8 - 1);
    // nothing else moves
    expect({ ...some, detailRows: 0, paneRows: 0, paneCap: 0 }).toEqual({
      ...none,
      detailRows: 0,
      paneRows: 0,
      paneCap: 0,
    });
  });

  it('leaves the layout as it was when nothing runs, and at every small size', () => {
    for (const [c, r] of [
      [40, 8],
      [60, 12],
      [80, 24],
      [160, 50],
      [30, 5],
    ] as const) {
      const without = computeLayout(c, r);
      expect(computeLayout(c, r, { panes: 0 })).toEqual(without);
    }
    expect(computeLayout(40, 8, { panes: 12 })).toMatchObject({
      paneRows: 0,
      detailRows: computeLayout(40, 8).detailRows,
    });
    expect(computeLayout(30, 5, { panes: 12 })).toMatchObject({ mode: 'too-small', paneRows: 0 });
  });

  it('gives a docked layout its panes too, without moving the dock', () => {
    const plain = computeLayout(200, 50, { dock: true });
    const withPanes = computeLayout(200, 50, { dock: true, panes: 3 });
    expect(withPanes.paneRows).toBeGreaterThan(0);
    expect(withPanes.dockRows).toBe(plain.dockRows);
    expect(withPanes.dockWidth).toBe(plain.dockWidth);
  });
});

describe('the set of panes (AC-01, AC-06)', () => {
  it('is one pane for each running step, in the order of the run, and nothing for the others', () => {
    const run = runOf([
      stepOf({ id: 'done', status: 'COMPLETED' }),
      stepOf({ id: 'a' }),
      stepOf({ id: 'wait', status: 'PENDING' }),
      stepOf({ id: 'b' }),
      stepOf({ id: 'bad', status: 'FAILED' }),
    ]);
    expect(runningIds(run)).toEqual(['a', 'b']);
    const found = panesFor(run, input);
    expect(found.panes.map((p) => p.stepId)).toEqual(['a', 'b']);
    expect(found).toMatchObject({ hidden: 0, running: 2 });
  });

  it('is empty when nothing runs, and when there is no room', () => {
    expect(panesFor(runOf([stepOf({ status: 'COMPLETED' })]), input)).toEqual({
      panes: [],
      hidden: 0,
      running: 0,
    });
    expect(panesFor(runOf([stepOf()]), { ...input, rows: 3 })).toMatchObject({
      panes: [],
      hidden: 1,
      running: 1,
    });
  });

  it('is a pure function: the same input gives the same panes, and the run is not changed', () => {
    const run = runOf(running(5));
    const before = JSON.stringify(run);
    const a = panesFor(run, input);
    const b = panesFor(run, input);
    expect(a).toEqual(b);
    expect(JSON.stringify(run)).toBe(before);
  });

  it('draws as many as fit and counts the rest, with 12 running steps (AC-06)', () => {
    const run = runOf(running(12));
    const found = panesFor(run, { ...input, rows: 20 });
    expect(found.panes).toHaveLength(5);
    expect(found).toMatchObject({ hidden: 7, running: 12 });
    const rows = paneBlockRows(found, 60, false);
    expect(rows).toHaveLength(20);
    expect(rows[0]?.text).toContain('(+7 more: [ ])');
  });

  it('slides the window with the offset, and keeps it inside what exists', () => {
    const run = runOf(running(12));
    expect(panesFor(run, { ...input, rows: 8, offset: 3 }).panes.map((p) => p.stepId)).toEqual(['s3', 's4']);
    expect(panesFor(run, { ...input, rows: 8, offset: 99 }).panes.map((p) => p.stepId)).toEqual([
      's10',
      's11',
    ]);
    expect(panesFor(run, { ...input, rows: 8, offset: -4 }).panes.map((p) => p.stepId)).toEqual(['s0', 's1']);
  });

  it('marks the focused pane, by the id of its step', () => {
    const run = runOf(running(3));
    const found = panesFor(run, { ...input, focus: 's1' });
    expect(found.panes.map((p) => p.focused)).toEqual([false, true, false]);
    expect(paneBlockRows(found, 60, false).filter((r) => r.selected)).toHaveLength(1);
    expect(panesFor(run, { ...input, focus: 'gone' }).panes.some((p) => p.focused)).toBe(false);
  });

  it('shows the last three rows of the output, and says there is no data yet when there is none', () => {
    const found = panesFor(
      runOf([stepOf({ output: ['1', '2', '3', '4', '5'] }), stepOf({ id: 'quiet' })]),
      input,
    );
    expect(found.panes[0]?.tail).toEqual(['3', '4', '5']);
    expect(TAIL_ROWS).toBe(3);
    expect(found.panes[1]?.tail).toEqual(['(no data yet)']);
    const rows = paneBlockRows(found, 60, false);
    expect(rows[4 + 1]?.text).toBe('(no data yet)');
    expect(rows[4 + 1]?.tone).toBe('dim');
    expect(rows[4 + 2]?.text).toBe('');
  });

  it('includes the line being written', () => {
    const found = panesFor(runOf([stepOf({ output: ['done line'], partialLine: 'still typ' })]), input);
    expect(found.panes[0]?.tail).toEqual(['done line', 'still typ']);
  });

  it('shows the attempt only after the first, and the cost only when there is one to show', () => {
    const [first, retried] = panesFor(
      runOf([stepOf({ id: 'a' }), stepOf({ id: 'b', attempts: 3, runners: [agent(undefined)] })]),
      input,
    ).panes;
    expect(first?.title).not.toContain('attempt');
    expect(first?.title).not.toContain('cost');
    expect(retried?.title).toContain('attempt 3');
    expect(retried?.title).toContain('cost unknown');
  });

  it('names its state in a glyph and a word, and the ASCII glyph is one column of 7-bit', () => {
    const [pane] = panesFor(runOf([stepOf()]), input).panes;
    expect(pane?.word).toBe('running');
    expect(pane?.title).toContain('running');
    const [plain] = panesFor(runOf([stepOf()]), { ...input, ascii: true }).panes;
    expect(plain?.glyph).toMatch(/^[\x20-\x7e]$/);
    expect(plain?.title).toMatch(/^[\x20-\x7e]*$/);
    // the glyph and the word are in the title whatever the tone, so NO_COLOR loses nothing (AC-04)
    expect(plain?.title.startsWith(`${plain.glyph} running`)).toBe(true);
  });

  it('removes control sequences an agent wrote, in the tail and in the id (AC-05)', () => {
    const esc = String.fromCharCode(27);
    const found = panesFor(
      runOf([stepOf({ id: `x${esc}[2Jy`, output: [`red${esc}[31m text`, `bell${String.fromCharCode(7)}`] })]),
      input,
    );
    const all = paneBlockRows(found, 60, false)
      .map((r) => r.text)
      .join('\n');
    expect(all).not.toContain(esc);
    expect(all).not.toContain(String.fromCharCode(7));
  });

  // Known gap (review.md): every wrap in the dashboard counts characters, not terminal columns, so a wide character takes
  // two columns on a terminal and a row of them can run past the edge. This documents it; it is not a promise.
  it('wraps by characters, as the whole dashboard does, so a wide character counts as one', () => {
    const wide = '界'.repeat(25);
    const found = panesFor(runOf([stepOf({ output: [wide] })]), { ...input, width: 10 });
    expect(found.panes[0]?.tail).toEqual(['界界界界界界界界界界', '界界界界界界界界界界', '界界界界界']);
  });

  it('shows a tab as spaces, and a line that is only a line break as a blank row, not as no data', () => {
    const tab = panesFor(runOf([stepOf({ output: [`${String.fromCharCode(9)}indented`] })]), input);
    expect(tab.panes[0]?.tail).toEqual(['  indented']);
    const blank = panesFor(runOf([stepOf({ output: [''] })]), input);
    expect(blank.panes[0]?.tail).toEqual(['']);
  });

  it('keeps the count of the hidden panes in sight when the title is long and the pane is narrow', () => {
    const run = runOf(
      Array.from({ length: 12 }, (_, i) => stepOf({ id: `a-very-long-step-name-number-${i}`, attempts: 3 })),
    );
    const rows = paneBlockRows(panesFor(run, { ...input, rows: 8, width: 40 }), 40, false);
    expect(rows[0]?.text).toContain('(+10 more: [ ])');
    expect(Array.from(rows[0]?.text ?? '').length).toBeLessThanOrEqual(40);
    // and with no hidden pane there is no hint
    expect(paneBlockRows(panesFor(runOf(running(2)), input), 60, false)[0]?.text).not.toContain('more');
  });

  it('keeps every row inside the width', () => {
    const run = runOf([
      stepOf({ id: 'a'.repeat(80), output: ['z'.repeat(200)], attempts: 4, runners: [agent(1)] }),
    ]);
    for (const row of paneBlockRows(panesFor(run, { ...input, width: 24 }), 24, false)) {
      expect(Array.from(row.text).length).toBeLessThanOrEqual(24);
    }
  });
});
