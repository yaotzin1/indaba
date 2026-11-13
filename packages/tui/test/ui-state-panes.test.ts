import { describe, expect, it } from 'vitest';
import { clampUi, initialUi, type KeyName, reduceUi, type UiContext, type UiState } from '../src/index.js';

const ctx = (extra: Partial<UiContext> = {}): UiContext => ({
  steps: 5,
  outputLines: 50,
  pageSize: 10,
  attached: false,
  reasoningLines: 40,
  panes: ['a', 'b', 'c', 'd', 'e'],
  paneCap: 2,
  ...extra,
});
const press = (ui: UiState, key: KeyName, context: UiContext = ctx()): UiState => reduceUi(ui, key, context);
const ch = (char: string): KeyName => ({ char });
const from = (extra: Partial<UiState>): UiState => ({ ...initialUi(), ...extra });

describe('the reasoning view (3.1)', () => {
  it('shows reasoning with r and output again with o, and keeps the place in each', () => {
    let ui = press(from({ focus: 'detail' }), ch('r'));
    expect(ui.panel).toBe('reasoning');
    ui = press(ui, 'pageup');
    expect(ui).toMatchObject({ reasoningScroll: 10, scroll: 0 });
    ui = press(ui, ch('o'));
    expect(ui).toMatchObject({ panel: 'output', reasoningScroll: 10 });
    ui = press(ui, 'pageup');
    expect(ui).toMatchObject({ scroll: 10, reasoningScroll: 10 });
    expect(press(ui, ch('r'))).toMatchObject({ panel: 'reasoning', reasoningScroll: 10, scroll: 10 });
  });

  it('scrolls reasoning by its own length, and stops at its ends', () => {
    let ui = from({ focus: 'detail', panel: 'reasoning' });
    for (let i = 0; i < 20; i += 1) {
      ui = press(ui, 'pageup');
    }
    expect(ui.reasoningScroll).toBe(39);
    for (let i = 0; i < 20; i += 1) {
      ui = press(ui, 'pagedown');
    }
    expect(ui.reasoningScroll).toBe(0);
    // no reasoning: nowhere to go
    expect(
      press(from({ focus: 'detail', panel: 'reasoning' }), 'pageup', ctx({ reasoningLines: 0 }))
        .reasoningScroll,
    ).toBe(0);
  });

  it('starts a newly selected step at its newest reasoning as well as its newest output', () => {
    const ui = press(from({ selected: 0, scroll: 7, reasoningScroll: 9 }), 'down');
    expect(ui).toMatchObject({ selected: 1, scroll: 0, reasoningScroll: 0 });
  });

  it('leaves the follow key about the output alone while reading reasoning', () => {
    const ui = press(from({ panel: 'reasoning', follow: true }), ch('f'));
    expect(ui.follow).toBe(false);
  });

  it('does not change view while the help is open', () => {
    expect(press(from({ help: true }), ch('r')).panel).toBe('output');
    expect(press(from({ help: true, panel: 'reasoning' }), ch('o')).panel).toBe('reasoning');
  });

  it('shortens a reasoning scroll that no longer fits, after the reasoning shrank', () => {
    expect(clampUi(from({ reasoningScroll: 30 }), ctx({ reasoningLines: 5 })).reasoningScroll).toBe(4);
    const ui = from({ reasoningScroll: 2 });
    expect(clampUi(ui, ctx())).toBe(ui);
  });
});

describe('the focus of the panes (3.4)', () => {
  it('moves through the running steps with ] and [, by their ids', () => {
    let ui = press(initialUi(), ch(']'));
    expect(ui.pane).toBe('a');
    ui = press(ui, ch(']'));
    expect(ui.pane).toBe('b');
    ui = press(ui, ch('['));
    expect(ui.pane).toBe('a');
    expect(press(ui, ch('[')).pane).toBe('a');
    expect(press(initialUi(), ch('[')).pane).toBe('e');
  });

  it('slides the window to keep the focus in sight when more steps run than fit', () => {
    let ui = initialUi();
    for (let i = 0; i < 5; i += 1) {
      ui = press(ui, ch(']'));
    }
    expect(ui).toMatchObject({ pane: 'e', paneOffset: 3 });
    for (let i = 0; i < 4; i += 1) {
      ui = press(ui, ch('['));
    }
    expect(ui).toMatchObject({ pane: 'a', paneOffset: 0 });
  });

  it('does nothing when no step runs, and while the help is open', () => {
    const ui = initialUi();
    expect(press(ui, ch(']'), ctx({ panes: [] }))).toBe(ui);
    expect(press(from({ help: true }), ch(']')).pane).toBeUndefined();
  });

  it('drops a focus on a step that stopped running, and keeps the window inside what exists', () => {
    const ui = from({ pane: 'c', paneOffset: 3 });
    expect(clampUi(ui, ctx({ panes: ['a', 'b', 'd'] }))).toMatchObject({ pane: undefined, paneOffset: 1 });
    expect(clampUi(ui, ctx({ panes: [] }))).toMatchObject({ pane: undefined, paneOffset: 0 });
  });

  it('keeps the same state for the same input (a clamp that changes nothing returns what it was given)', () => {
    const ui = from({ pane: 'a' });
    expect(clampUi(ui, ctx())).toBe(ui);
  });
});

describe('enlarging a pane (3.4)', () => {
  it('takes the focused pane with Enter or z, gives it the arrow keys, and returns with Esc', () => {
    for (const key of ['enter', ch('z')] as const) {
      const big = press(from({ pane: 'b', scroll: 4 }), key);
      expect(big).toMatchObject({ enlarged: true, pane: 'b', focus: 'detail', scroll: 0, follow: true });
      expect(press(big, 'escape')).toMatchObject({ enlarged: false, focus: 'list' });
    }
  });

  it('takes the first running step when no pane was focused, and the first when the focus is stale', () => {
    expect(press(initialUi(), 'enter')).toMatchObject({ enlarged: true, pane: 'a' });
    expect(press(from({ pane: 'gone' }), 'enter')).toMatchObject({ enlarged: true, pane: 'a' });
  });

  it('does nothing with no running step, and nothing twice', () => {
    const ui = initialUi();
    expect(press(ui, 'enter', ctx({ panes: [] }))).toBe(ui);
    const big = press(ui, 'enter');
    expect(press(big, 'enter')).toBe(big);
    expect(press(big, ch('z'))).toBe(big);
  });

  it('does not open from the help', () => {
    const ui = from({ help: true });
    expect(press(ui, 'enter')).toBe(ui);
  });

  it('closes the board it was opened over, so it is what the person sees', () => {
    expect(press(from({ board: true, focus: 'board' }), 'enter')).toMatchObject({
      enlarged: true,
      board: false,
    });
  });

  it('blocks the board, the help, the views and the tab key while it is enlarged', () => {
    const big = press(initialUi(), 'enter');
    for (const key of [ch('b'), ch('?'), ch('h'), ch('r'), ch('o'), 'tab'] as const) {
      expect(press(big, key)).toBe(big);
    }
  });

  it('scrolls the enlarged pane with the arrow keys, and can move to the next pane', () => {
    const big = press(initialUi(), 'enter');
    expect(press(big, 'pageup').scroll).toBe(10);
    expect(press(big, ch(']'))).toMatchObject({ pane: 'b', enlarged: true, scroll: 0 });
  });

  it('unwinds in order: the help (which cannot be open here), the quit question, the pane, then the board', () => {
    const big = from({ enlarged: true, pane: 'a', focus: 'detail' });
    expect(press(big, 'escape')).toMatchObject({ enlarged: false });
    // the quit question is answered before anything else
    const asking = press(big, ch('q'), ctx({ attached: true }));
    expect(asking.confirmQuit).toBe(true);
    expect(press(asking, 'escape')).toMatchObject({ confirmQuit: false, enlarged: true });
    // a board opened later is the next thing Esc closes
    const board = press(press(big, 'escape'), ch('b'));
    expect(board.board).toBe(true);
    expect(press(board, 'escape')).toMatchObject({ board: false });
  });

  it('closes when its step stops running, says so once, and gives the keys back to the list', () => {
    const big = from({ enlarged: true, pane: 'a', focus: 'detail' });
    const closed = clampUi(big, ctx({ panes: ['b', 'c'] }));
    expect(closed).toMatchObject({
      enlarged: false,
      pane: undefined,
      focus: 'list',
      notice: 'step finished',
    });
    // the notice goes with the next key
    expect(press(closed, ch('j')).notice).toBeUndefined();
    expect(press(from({ notice: 'x' }), ch('z')).notice).toBeUndefined();
  });

  it('keeps the same step when the terminal is resized, because focus is the id and not a place', () => {
    const big = from({ enlarged: true, pane: 'c', focus: 'detail', paneOffset: 2 });
    expect(clampUi(big, ctx({ paneCap: 1 }))).toMatchObject({ enlarged: true, pane: 'c' });
    // the retry of a step is the same id, so the pane does not jump to another step
    expect(clampUi(from({ pane: 'c' }), ctx({ panes: ['c'] })).pane).toBe('c');
  });

  it('still quits from an enlarged pane', () => {
    const big = from({ enlarged: true, pane: 'a', focus: 'detail' });
    expect(press(big, ch('q')).quit).toBe('close');
    expect(press(big, 'ctrl-c').quit).toBe('close');
  });
});

describe('the keys that were there before keep their meaning', () => {
  it('still toggles the board with b and the help with ?', () => {
    expect(press(initialUi(), ch('b')).board).toBe(true);
    expect(press(initialUi(), ch('?')).help).toBe(true);
    expect(press(initialUi(), ch('h')).help).toBe(true);
  });
});
