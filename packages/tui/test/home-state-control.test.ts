import { describe, expect, it } from 'vitest';
import {
  type HomeContext,
  type HomeEvent,
  type HomeState,
  initialHome,
  reduceHome,
} from '../src/home-state.js';
import type { FlowState } from '../src/run-flow.js';
import type { KeyName } from '../src/ui-state.js';
import { runs } from './home-fixtures.js';
import { refusal, USE, workflow } from './run-flow-fixtures.js';

const control: HomeContext = {
  attached: false,
  canOpen: true,
  pageSize: 3,
  canControl: true,
  canStop: (id) => id === 'a1',
};
const send = (state: HomeState, event: HomeEvent, c: HomeContext = control): HomeState =>
  reduceHome(state, event, c);
const key = (char: string): HomeEvent => ({ press: { char } });
const named = (press: KeyName): HomeEvent => ({ press });
const loaded = (n = 3): HomeState => send(initialHome(), { runs: runs(n), generation: 1 });
const flowOf = (state: HomeState): FlowState => {
  if (state.flow === undefined) {
    throw new Error('no dialog is open');
  }
  return state.flow;
};
const withPicker = (): HomeState => {
  const open = send(loaded(), key('n'));
  return send(open, { flow: { listed: { workflows: [workflow()], truncated: false } } });
};

describe('Home with a control that starts and stops runs (specs/tui-run-control)', () => {
  it('opens the picker with n, only when a control was supplied', () => {
    const state = loaded();
    expect(send(state, key('n')).flow).toMatchObject({ kind: 'picking', effect: { type: 'list' } });
    expect(send(state, key('n'), { ...control, canControl: false })).toBe(state);
    expect(send(state, key('n'), { attached: false, canOpen: true, pageSize: 3 })).toBe(state);
  });

  it('gives every key to the dialog while it is open, and Escape closes it', () => {
    const state = withPicker();
    // q does not quit, j does not move the runs
    expect(send(state, key('q')).quit).toBe('none');
    expect(send(state, key('j')).selected).toBe(0);
    expect(send(state, named('escape')).flow).toBeUndefined();
  });

  it('opens a run the dialog started, owns it, and shows its dashboard', () => {
    let state = send(withPicker(), named('enter'));
    state = send(state, {
      flow: { refused: refusal('confirmation_required', { contentHash: 'h', use: USE }) },
    });
    state = send(state, key('y'));
    state = send(state, { flow: { started: { startId: 'web-1' } } });
    expect(flowOf(state).kind).toBe('starting');
    state = send(state, { flow: { status: { state: 'running', runId: 'r9' } } });
    expect(state).toMatchObject({ flow: undefined, open: 'r9', owned: ['r9'] });
  });

  it('owns the run once, even when it is opened twice', () => {
    const started = send(withPicker(), named('enter'));
    const step = (s: HomeState): HomeState =>
      send(s, { flow: { status: { state: 'running', runId: 'r9' } } });
    const once = step(send(started, { flow: { started: { startId: 'web-1' } } }));
    expect(once.owned).toEqual(['r9']);
    const again = send(
      { ...once, flow: flowOf(send(started, { flow: { started: { startId: 'web-2' } } })) },
      { flow: { status: { state: 'running', runId: 'r9' } } },
    );
    expect(again.owned).toEqual(['r9']);
  });

  it('says which run started and fetches the list when there is no way to open it', () => {
    const noOpen: HomeContext = { ...control, canOpen: false };
    const started = send(withPicker(), named('enter'), noOpen);
    const running = send(
      send(started, { flow: { started: { startId: 'web-1' } } }, noOpen),
      {
        flow: { status: { state: 'running', runId: 'r9' } },
      },
      noOpen,
    );
    expect(running).toMatchObject({
      open: undefined,
      owned: ['r9'],
      notice: 'Started run r9',
      loading: true,
    });
  });

  it('ignores an event of a dialog that is not open', () => {
    const state = loaded();
    expect(send(state, { flow: { listed: { workflows: [], truncated: false } } })).toBe(state);
  });

  it('refuses to leave while a start is in flight or being waited for, and says so', () => {
    const requesting = send(withPicker(), named('enter'));
    expect(flowOf(requesting).kind).toBe('requesting');
    const blocked = send(requesting, named('ctrl-c'));
    expect(blocked.quit).toBe('none');
    expect(blocked.notice).toContain('A run is starting');
    const starting = send(requesting, { flow: { started: { startId: 'web-1' } } });
    expect(send(starting, named('ctrl-c')).quit).toBe('none');
    // and q does not leave either: the dialog has the keyboard
    expect(send(starting, key('q')).quit).toBe('none');
  });

  it('lets Ctrl+C leave from a dialog that is only asking, as it leaves from the list', () => {
    expect(send(withPicker(), named('ctrl-c')).quit).toBe('close');
    const attached = send(withPicker(), named('ctrl-c'), { ...control, attached: true });
    expect(attached).toMatchObject({ confirmQuit: true, quit: 'none' });
  });

  it('clears the line of news with the next key, and keeps the state when there was none', () => {
    const noted = send(loaded(), key('s'), { ...control, canStop: () => false });
    expect(noted.notice).toContain('not started from this screen');
    expect(send(noted, key('j')).notice).toBeUndefined();
    const quiet = loaded();
    expect(send(quiet, key('z'))).toBe(quiet);
  });

  it('asks about stopping the selected run only when it was started here and is still going', () => {
    const state = send(loaded(), key('j'));
    expect(send(state, key('s')).flow).toMatchObject({ kind: 'stopConfirm', runId: 'a1' });
    const none = loaded(0);
    expect(send(none, key('s'))).toBe(none);
    expect(send(loaded(), key('s')).notice).toContain('cannot be stopped here');
    const noControl = send(loaded(), key('s'), { attached: false, canOpen: true, pageSize: 3 });
    expect(noControl.notice).toBeUndefined();
  });

  it('shows the end of a stop as a line of news and fetches the list again', () => {
    let state = send(send(loaded(), key('j')), key('s'));
    state = send(state, key('y'));
    state = send(state, { flow: { stopped: { state: 'stopping' } } });
    state = send(state, { flow: { alive: false } });
    expect(state).toMatchObject({ flow: undefined, notice: 'The run was stopped', loading: true });
    expect(state.generation).toBeGreaterThan(1);
  });

  it('stays open and says why when the runs could not be stopped for a quit', () => {
    const quitting = send(loaded(), key('q'), { ...control, attached: true });
    const stopping = send(quitting, key('c'), { ...control, attached: true });
    expect(stopping.quit).toBe('cancel');
    const failed = send(stopping, { quitFailed: 'The runs could not be stopped: EPERM' });
    expect(failed).toMatchObject({
      quit: 'none',
      confirmQuit: false,
      notice: 'The runs could not be stopped: EPERM',
    });
  });
});
