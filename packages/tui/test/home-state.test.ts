import { describe, expect, it } from 'vitest';
import {
  type HomeContext,
  type HomeEvent,
  type HomeState,
  initialHome,
  reduceHome,
} from '../src/home-state.js';
import type { KeyName } from '../src/ui-state.js';
import { runs } from './home-fixtures.js';

const ctx: HomeContext = { attached: false, canOpen: true, pageSize: 3 };
const send = (state: HomeState, event: HomeEvent, c: HomeContext = ctx): HomeState =>
  reduceHome(state, event, c);
const key = (char: string): HomeEvent => ({ press: { char } });
const named = (press: KeyName): HomeEvent => ({ press });
const loaded = (n: number): HomeState => reduceHome(initialHome(), { runs: runs(n), generation: 1 }, ctx);

describe('Home state', () => {
  it('starts loading the first list', () => {
    expect(initialHome()).toMatchObject({
      loading: true,
      generation: 1,
      selected: 0,
      quit: 'none',
      open: undefined,
    });
  });

  it('takes the list that belongs to the current fetch', () => {
    const s = loaded(3);
    expect(s.runs).toHaveLength(3);
    expect(s.loading).toBe(false);
  });

  it('drops a list or a failure from an older fetch (AC-12)', () => {
    const s = send(loaded(3), key('r'));
    expect(s.generation).toBe(2);
    expect(send(s, { runs: runs(1), generation: 1 })).toBe(s);
    expect(send(s, { failed: 'late', generation: 1 })).toBe(s);
    expect(send(s, { runs: runs(1), generation: 2 }).runs).toHaveLength(1);
  });

  it('refreshing twice leaves only the newest answer valid', () => {
    let s = send(loaded(2), key('r'));
    s = send(s, key('r'));
    expect(s.generation).toBe(3);
    expect(send(s, { runs: runs(1), generation: 2 })).toBe(s);
  });

  it('shows a failure and lets r try again', () => {
    const failed = send(initialHome(), { failed: 'disk', generation: 1 });
    expect(failed).toMatchObject({ loading: false, error: 'disk' });
    expect(send(failed, key('r'))).toMatchObject({ loading: true, error: undefined, generation: 2 });
  });

  it('clamps the selection when the list shrinks', () => {
    let s = send(loaded(5), named('end'));
    expect(s.selected).toBe(4);
    s = send(s, key('r'));
    s = send(s, { runs: runs(2), generation: 2 });
    expect(s.selected).toBe(1);
    s = send(send(s, key('r')), { runs: [], generation: 3 });
    expect(s.selected).toBe(0);
  });

  it('moves with arrows, j, k, g, G, home, end and the page keys, and stops at the ends', () => {
    let s = loaded(6);
    s = send(s, named('up'));
    expect(s.selected).toBe(0);
    s = send(s, key('j'));
    s = send(s, named('down'));
    expect(s.selected).toBe(2);
    s = send(s, key('k'));
    expect(s.selected).toBe(1);
    s = send(s, named('pagedown'));
    expect(s.selected).toBe(4);
    s = send(s, named('pagedown'));
    expect(s.selected).toBe(5);
    s = send(s, named('pageup'));
    expect(s.selected).toBe(2);
    expect(send(s, key('G')).selected).toBe(5);
    expect(send(s, key('g')).selected).toBe(0);
    expect(send(s, named('home')).selected).toBe(0);
    expect(send(s, named('end')).selected).toBe(5);
  });

  it('keeps the same state object for a move that changes nothing', () => {
    const s = loaded(2);
    expect(send(s, key('k'))).toBe(s);
  });

  it('treats an unknown key as nothing', () => {
    const s = loaded(2);
    expect(send(s, key('z'))).toBe(s);
    expect(send(s, named('tab'))).toBe(s);
  });

  it('toggles ? and Escape closes it; other keys are ignored while it is open', () => {
    let s = send(loaded(3), key('?'));
    expect(s.help).toBe(true);
    expect(send(s, key('j'))).toBe(s);
    expect(send(s, key('r'))).toBe(s);
    expect(send(s, named('enter'))).toBe(s);
    s = send(s, named('escape'));
    expect(s.help).toBe(false);
    expect(send(s, named('escape'))).toBe(s);
    expect(send(send(s, key('?')), key('?')).help).toBe(false);
  });

  it('opens the selected run with Enter, and only when a way to open was supplied', () => {
    const s = send(loaded(3), key('j'));
    expect(send(s, named('enter')).open).toBe('a1');
    expect(send(s, named('enter'), { ...ctx, canOpen: false })).toBe(s);
    const none = loaded(0);
    expect(send(none, named('enter'))).toBe(none);
    const opened = send(s, named('enter'));
    // the opened run's dashboard has the keyboard
    expect(send(opened, key('q'))).toBe(opened);
  });

  it('ignores a list or a failure that arrives while a run is open, and fetches again on return (AC-12)', () => {
    const fetching = send(loaded(3), key('r'));
    const opened = send(fetching, named('enter'));
    expect(opened.open).toBe('a0');
    expect(send(opened, { runs: runs(1), generation: opened.generation })).toBe(opened);
    expect(send(opened, { failed: 'late', generation: opened.generation })).toBe(opened);
    const back = send(opened, { left: true });
    expect(back).toMatchObject({ open: undefined, loading: true });
    expect(back.generation).toBe(opened.generation + 1);
  });

  it('refetches when the person comes back from a run', () => {
    const opened = send(loaded(2), named('enter'));
    const back = send(opened, { left: true });
    expect(back).toMatchObject({ open: undefined, loading: true, generation: 2 });
    expect(send(back, { left: true })).toBe(back);
  });

  it('quits at once with q and Ctrl+C when no run was started here (AC-06)', () => {
    expect(send(loaded(1), key('q')).quit).toBe('close');
    expect(send(loaded(1), named('ctrl-c')).quit).toBe('close');
    expect(send(loaded(1), key('q')).confirmQuit).toBe(false);
  });

  it('asks detach or stop when a run was started here (AC-06)', () => {
    const attached = { ...ctx, attached: true };
    const s = send(loaded(1), key('q'), attached);
    expect(s).toMatchObject({ confirmQuit: true, quit: 'none' });
    expect(send(s, key('x'), attached)).toBe(s);
    expect(send(s, named('enter'), attached)).toBe(s);
    expect(send(s, key('d'), attached).quit).toBe('detach');
    expect(send(s, key('c'), attached).quit).toBe('cancel');
    expect(send(s, key('n'), attached).confirmQuit).toBe(false);
    expect(send(s, named('escape'), attached).confirmQuit).toBe(false);
    expect(send(loaded(1), named('ctrl-c'), attached).confirmQuit).toBe(true);
  });
});
