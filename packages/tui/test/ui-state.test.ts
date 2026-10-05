import { describe, expect, it } from 'vitest';
import { clampUi, initialUi, type KeyName, reduceUi, type UiContext, type UiState } from '../src/index.js';

const ctx = (extra: Partial<UiContext> = {}): UiContext => ({
  steps: 5,
  outputLines: 50,
  pageSize: 10,
  attached: false,
  ...extra,
});

const press = (ui: UiState, key: KeyName, context: UiContext = ctx()): UiState => reduceUi(ui, key, context);
const ch = (char: string): KeyName => ({ char });
const from = (extra: Partial<UiState>): UiState => ({ ...initialUi(), ...extra });

describe('initialUi', () => {
  it('starts on the first step, following the newest output, with the list focused and nothing open', () => {
    expect(initialUi()).toEqual({
      selected: 0,
      scroll: 0,
      follow: true,
      focus: 'list',
      help: false,
      confirmQuit: false,
      quit: 'none',
    });
  });
});

describe('selecting a step', () => {
  it('moves with the arrows and with j and k, and stops at both ends', () => {
    let ui = initialUi();
    ui = press(ui, 'down');
    ui = press(ui, ch('j'));
    expect(ui.selected).toBe(2);
    ui = press(ui, 'up');
    ui = press(ui, ch('k'));
    expect(ui.selected).toBe(0);
    expect(press(ui, 'up').selected).toBe(0);
    expect(press(from({ selected: 4 }), 'down').selected).toBe(4);
  });

  it('jumps to the first and last step with home, end, g and G', () => {
    expect(press(from({ selected: 3 }), 'home').selected).toBe(0);
    expect(press(from({ selected: 3 }), ch('g')).selected).toBe(0);
    expect(press(initialUi(), 'end').selected).toBe(4);
    expect(press(initialUi(), ch('G')).selected).toBe(4);
  });

  it('starts a newly selected step at its newest output', () => {
    const ui = press(from({ selected: 1, scroll: 12, follow: false }), 'down');
    expect(ui).toMatchObject({ selected: 2, scroll: 0, follow: true });
  });

  it('keeps the scroll when the selection did not change', () => {
    const ui = from({ selected: 0, scroll: 12, follow: false });
    expect(press(ui, 'up')).toBe(ui);
  });

  it('copes with a run that has no steps yet', () => {
    expect(press(initialUi(), 'down', ctx({ steps: 0 })).selected).toBe(0);
    expect(press(initialUi(), 'end', ctx({ steps: 0 })).selected).toBe(0);
  });
});

describe('scrolling the output', () => {
  it('pages back with PgUp and u, and forward with PgDn and d, by the height of the pane', () => {
    let ui = press(initialUi(), 'pageup');
    expect(ui.scroll).toBe(10);
    ui = press(ui, ch('u'));
    expect(ui.scroll).toBe(20);
    ui = press(ui, 'pagedown');
    expect(ui.scroll).toBe(10);
    ui = press(ui, ch('d'));
    expect(ui.scroll).toBe(0);
  });

  it('stops following when scrolled back, and follows again on reaching the bottom', () => {
    const back = press(initialUi(), 'pageup');
    expect(back.follow).toBe(false);
    expect(press(back, 'pagedown')).toMatchObject({ scroll: 0, follow: true });
  });

  it('never scrolls past the oldest line or below the newest', () => {
    expect(press(initialUi(), 'pageup', ctx({ outputLines: 5 })).scroll).toBe(4);
    expect(press(initialUi(), 'pagedown').scroll).toBe(0);
    expect(press(initialUi(), 'pageup', ctx({ outputLines: 0 })).scroll).toBe(0);
  });

  it('pages by at least one line, even for a tiny pane', () => {
    expect(press(initialUi(), 'pageup', ctx({ pageSize: 0 })).scroll).toBe(1);
  });

  it('turns following on and off with f, jumping to the newest when it goes on', () => {
    const paused = press(initialUi(), ch('f'));
    expect(paused.follow).toBe(false);
    expect(press(from({ follow: false, scroll: 7 }), ch('f'))).toMatchObject({ follow: true, scroll: 0 });
  });

  it('moves the arrow keys to the output when the detail pane has the focus', () => {
    let ui = press(initialUi(), 'tab');
    expect(ui.focus).toBe('detail');
    ui = press(ui, 'up');
    expect(ui).toMatchObject({ selected: 0, scroll: 1, follow: false });
    ui = press(ui, ch('j'));
    expect(ui).toMatchObject({ scroll: 0, follow: true });
    expect(press(ui, 'tab').focus).toBe('list');
  });
});

describe('help', () => {
  it('opens and closes with ? or h, and closes with escape', () => {
    let ui = press(initialUi(), ch('?'));
    expect(ui.help).toBe(true);
    ui = press(ui, ch('?'));
    expect(ui.help).toBe(false);
    ui = press(initialUi(), ch('h'));
    expect(ui.help).toBe(true);
    expect(press(ui, 'escape').help).toBe(false);
  });

  it('leaves escape alone when nothing is open', () => {
    const ui = initialUi();
    expect(press(ui, 'escape')).toBe(ui);
  });
});

describe('quitting', () => {
  it.each([[ch('q')], ['ctrl-c' as const]])(
    'closes at once for a run that was only being watched (%j)',
    (key) => {
      expect(press(initialUi(), key).quit).toBe('close');
    },
  );

  it.each([[ch('q')], ['ctrl-c' as const]])('asks what to do with a run the screen started (%j)', (key) => {
    const ui = press(initialUi(), key, ctx({ attached: true }));
    expect(ui).toMatchObject({ confirmQuit: true, quit: 'none' });
  });

  it('detaches on d, cancels on c, and stays on n or escape', () => {
    const asking = from({ confirmQuit: true });
    expect(press(asking, ch('d')).quit).toBe('detach');
    expect(press(asking, ch('c')).quit).toBe('cancel');
    expect(press(asking, ch('n'))).toMatchObject({ confirmQuit: false, quit: 'none' });
    expect(press(asking, 'escape')).toMatchObject({ confirmQuit: false, quit: 'none' });
  });

  it('ignores every other key while the question is open, including the ones that would scroll or select', () => {
    const asking = from({ confirmQuit: true, selected: 2, scroll: 3 });
    for (const key of [
      'up',
      'down',
      'pageup',
      'pagedown',
      'home',
      'end',
      'tab',
      'enter',
      'ctrl-c',
      ch('x'),
      ch('q'),
      ch('j'),
      ch('f'),
    ] as KeyName[]) {
      expect(press(asking, key)).toBe(asking);
    }
  });

  it('does not let d mean "page down" while the question is open', () => {
    expect(press(from({ confirmQuit: true }), ch('d')).scroll).toBe(0);
  });
});

describe('other keys', () => {
  it('ignore a key it does not know', () => {
    const ui = initialUi();
    for (const key of ['enter', ch('x'), ch('Z'), ch('1')] as KeyName[]) {
      expect(press(ui, key)).toBe(ui);
    }
  });
});

describe('clampUi', () => {
  it('pulls the selection and the scroll back inside what exists after the run changed', () => {
    expect(clampUi(from({ selected: 9, scroll: 40 }), ctx({ steps: 3, outputLines: 10 }))).toMatchObject({
      selected: 2,
      scroll: 9,
    });
    expect(clampUi(from({ selected: 2, scroll: 5 }), ctx({ steps: 0, outputLines: 0 }))).toMatchObject({
      selected: 0,
      scroll: 0,
    });
  });

  it('returns the same object when nothing needed clamping', () => {
    const ui = from({ selected: 1, scroll: 2 });
    expect(clampUi(ui, ctx())).toBe(ui);
  });
});
