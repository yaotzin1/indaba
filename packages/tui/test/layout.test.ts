import { describe, expect, it } from 'vitest';
import { clip, computeLayout, fit, MIN_COLUMNS, MIN_ROWS, SPLIT_COLUMNS } from '../src/index.js';

describe('computeLayout', () => {
  it('has a minimum size below which it only shows a notice', () => {
    expect(computeLayout(MIN_COLUMNS - 1, 24).mode).toBe('too-small');
    expect(computeLayout(80, MIN_ROWS - 1).mode).toBe('too-small');
    expect(computeLayout(MIN_COLUMNS, MIN_ROWS).mode).not.toBe('too-small');
    expect(computeLayout(0, 0).mode).toBe('too-small');
  });

  it('puts the panes side by side from 80 columns, and one above the other below', () => {
    expect(computeLayout(SPLIT_COLUMNS - 1, 24).mode).toBe('stacked');
    expect(computeLayout(SPLIT_COLUMNS, 24).mode).toBe('split');
    expect(computeLayout(200, 50).mode).toBe('split');
    expect(computeLayout(MIN_COLUMNS, 24).mode).toBe('stacked');
  });

  it('gives the list about a third, never more than 32 columns, and the rest to the detail', () => {
    const narrow = computeLayout(80, 24);
    expect(narrow.listWidth).toBe(24);
    expect(narrow.detailWidth).toBe(80 - 24 - 1);
    const wide = computeLayout(200, 24);
    expect(wide.listWidth).toBe(32);
    expect(wide.detailWidth).toBe(200 - 32 - 1);
    for (const columns of [80, 100, 133, 200]) {
      const l = computeLayout(columns, 24);
      expect(l.listWidth + 1 + l.detailWidth).toBe(columns);
    }
  });

  it('takes a header and a footer off the height, and gives both panes the rest when side by side', () => {
    const l = computeLayout(100, 30);
    expect(l.listRows).toBe(28);
    expect(l.detailRows).toBe(28);
  });

  it('divides the height between the panes when stacked, leaving a row for the divider', () => {
    const l = computeLayout(60, 24);
    expect(l.mode).toBe('stacked');
    expect(l.listWidth).toBe(60);
    expect(l.detailWidth).toBe(60);
    expect(l.listRows).toBe(7);
    expect(l.detailRows).toBe(22 - 7 - 1);
    const small = computeLayout(60, MIN_ROWS);
    expect(small.listRows).toBeGreaterThanOrEqual(2);
    expect(small.detailRows).toBeGreaterThanOrEqual(1);
  });

  it('treats a size that is not a positive finite number as no size', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      expect(computeLayout(bad, 24).mode).toBe('too-small');
      expect(computeLayout(80, bad).mode).toBe('too-small');
    }
    expect(computeLayout(80.9, 24.9)).toMatchObject({ columns: 80, rows: 24 });
  });

  it('reports the size it was given in the too-small case, for the notice', () => {
    expect(computeLayout(30, 5)).toMatchObject({
      mode: 'too-small',
      columns: 30,
      rows: 5,
      listWidth: 0,
      detailRows: 0,
    });
  });
});

describe('clip and fit', () => {
  it('leaves text that fits and shortens text that does not, ending in an ellipsis', () => {
    expect(clip('hello', 5)).toBe('hello');
    expect(clip('hello', 10)).toBe('hello');
    expect(clip('hello world', 5)).toBe('hell…');
    expect(clip('hello world', 5, true)).toBe('hell~');
    expect(clip('ab', 1)).toBe('…');
  });

  it('gives nothing for a width that is not positive', () => {
    expect(clip('hello', 0)).toBe('');
    expect(clip('hello', -3)).toBe('');
    expect(fit('hello', 0)).toBe('');
  });

  it('counts characters, not UTF-16 units, so an emoji is not cut in half', () => {
    expect(clip('\u{1f600}\u{1f600}\u{1f600}', 3)).toBe('\u{1f600}\u{1f600}\u{1f600}');
    expect(clip('\u{1f600}\u{1f600}\u{1f600}\u{1f600}', 3)).toBe('\u{1f600}\u{1f600}…');
  });

  it('pads to a width with spaces, and clips when longer', () => {
    expect(fit('ab', 5)).toBe('ab   ');
    expect(fit('abcdef', 5)).toBe('abcd…');
    expect(fit('abcde', 5)).toBe('abcde');
    expect(Array.from(fit('éè', 4)).length).toBe(4);
  });
});
