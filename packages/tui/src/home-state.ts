import type { RunSummary } from '@indaba/engine';
import {
  type FlowEvent,
  type FlowState,
  type FlowStep,
  isBusy,
  openPicker,
  openStop,
  reduceFlow,
} from './run-flow.js';
import type { KeyName } from './ui-state.js';

/**
 * The state of Home: the runs, which one is selected, the help overlay and the question about quitting. Pure: an event
 * and the context in, the next state out. A list is fetched under a `generation`, and an answer that belongs to an older
 * one is dropped, so a slow first answer can never overwrite a newer one (specs/tui-home, AC-12).
 */
export interface HomeState {
  readonly runs: readonly RunSummary[];
  readonly selected: number;
  /** A list is being fetched. */
  readonly loading: boolean;
  /** The fetch the next answer must belong to. */
  readonly generation: number;
  readonly error: string | undefined;
  readonly help: boolean;
  /** The "detach or stop?" question is open (only for a run the screen started). */
  readonly confirmQuit: boolean;
  /** A run the person asked to open; the keyboard belongs to its dashboard until `left`. */
  readonly open: string | undefined;
  readonly quit: 'none' | 'close' | 'detach' | 'cancel';
  /** The dialog in front of Home (picker, confirmation, start, stop), when one is open (specs/tui-run-control). */
  readonly flow: FlowState | undefined;
  /** The runs this screen started, in order: only these can be stopped from here. */
  readonly owned: readonly string[];
  /** One line of news (a run stopped, a refusal); it goes with the next key. */
  readonly notice: string | undefined;
  /** Runs of `owned` that were asked to stop and may not have ended yet: leaving does not ask about them again. */
  readonly stopping: readonly string[];
  /** A start ended with no way to tell whether a run exists, so leaving must ask as it does for a run it knows. */
  readonly unsure: boolean;
}

export type HomeEvent =
  | { readonly press: KeyName }
  | { readonly flow: FlowEvent }
  /** A run started here was asked to stop (from its dashboard). */
  | { readonly stopRequested: string }
  /** Stopping the runs for a quit failed: stay, and say so. */
  | { readonly quitFailed: string }
  | { readonly runs: readonly RunSummary[]; readonly generation: number }
  | { readonly failed: string; readonly generation: number }
  /** The person came back from an opened run: the list is fetched again. */
  | { readonly left: true };

export interface HomeContext {
  /** The screen started a run, so quitting asks what to do with it. */
  readonly attached: boolean;
  /** A way to open a run was supplied, so `Enter` works. */
  readonly canOpen: boolean;
  /** Rows a page key moves by. */
  readonly pageSize: number;
  /** A control that starts and stops runs was supplied, so `n` and `s` work. */
  readonly canControl?: boolean;
  /** This run was started here and is still going. */
  readonly canStop?: (runId: string) => boolean;
}

export function initialHome(): HomeState {
  return {
    runs: [],
    selected: 0,
    loading: true,
    generation: 1,
    error: undefined,
    help: false,
    confirmQuit: false,
    open: undefined,
    quit: 'none',
    flow: undefined,
    owned: [],
    notice: undefined,
    stopping: [],
    unsure: false,
  };
}

function clamp(value: number, count: number): number {
  return Math.min(Math.max(value, 0), Math.max(0, count - 1));
}

const refetch = (state: HomeState): HomeState => ({
  ...state,
  loading: true,
  generation: state.generation + 1,
  error: undefined,
});

function move(state: HomeState, to: number): HomeState {
  const selected = clamp(to, state.runs.length);
  return selected === state.selected ? state : { ...state, selected };
}

/** What a step of the flow does to Home: the dialog moves on or closes, a run it started is owned and opened. */
function applyStep(state: HomeState, step: FlowStep, context: HomeContext): HomeState {
  let next: HomeState = { ...state, flow: step.state, unsure: state.unsure || step.unsure === true };
  if (step.notice !== undefined) {
    next = refetch({ ...next, notice: step.notice });
  }
  if (step.opened !== undefined) {
    const owned = state.owned.includes(step.opened) ? state.owned : [...state.owned, step.opened];
    next = { ...next, owned };
    next = context.canOpen
      ? { ...next, open: step.opened }
      : refetch({ ...next, notice: `Started run ${step.opened}` });
  }
  return next;
}

function pressed(state: HomeState, press: KeyName, context: HomeContext): HomeState {
  const char = typeof press === 'object' ? press.char : undefined;
  if (state.confirmQuit) {
    if (char === 'd') {
      return { ...state, quit: 'detach' };
    }
    if (char === 'c') {
      return { ...state, quit: 'cancel' };
    }
    return char === 'n' || press === 'escape' ? { ...state, confirmQuit: false } : state;
  }
  if (state.flow !== undefined) {
    if (press !== 'ctrl-c') {
      return applyStep(state, reduceFlow(state.flow, { press }), context);
    }
    // a start in flight may put a child behind a screen that is gone: leaving waits for it
    if (isBusy(state.flow)) {
      return { ...state, notice: 'A run is starting: wait a moment before you leave' };
    }
  }
  if (press === 'ctrl-c' || char === 'q') {
    return context.attached ? { ...state, confirmQuit: true } : { ...state, quit: 'close' };
  }
  if (char === '?') {
    return { ...state, help: !state.help };
  }
  if (press === 'escape') {
    return state.help ? { ...state, help: false } : state;
  }
  if (state.help) {
    return state;
  }
  if (press === 'up' || char === 'k') {
    return move(state, state.selected - 1);
  }
  if (press === 'down' || char === 'j') {
    return move(state, state.selected + 1);
  }
  if (press === 'home' || char === 'g') {
    return move(state, 0);
  }
  if (press === 'end' || char === 'G') {
    return move(state, state.runs.length - 1);
  }
  if (press === 'pageup') {
    return move(state, state.selected - Math.max(1, context.pageSize));
  }
  if (press === 'pagedown') {
    return move(state, state.selected + Math.max(1, context.pageSize));
  }
  if (char === 'r') {
    return refetch(state);
  }
  if (char === 'n' && context.canControl === true) {
    return { ...state, flow: openPicker() };
  }
  if (char === 's' && context.canControl === true) {
    const run = state.runs[state.selected];
    if (run === undefined) {
      return state;
    }
    return context.canStop?.(run.runId) === true
      ? { ...state, flow: openStop(run.runId) }
      : { ...state, notice: 'That run was not started from this screen, so it cannot be stopped here' };
  }
  if (press === 'enter' && context.canOpen) {
    const run = state.runs[state.selected];
    return run === undefined ? state : { ...state, open: run.runId };
  }
  return state;
}

export function reduceHome(state: HomeState, event: HomeEvent, context: HomeContext): HomeState {
  if ('press' in event) {
    // while a run is open its dashboard has the keyboard; while the runs are being stopped for a quit, nobody does
    if (state.open !== undefined || state.quit !== 'none') {
      return state;
    }
    const heard = state.notice === undefined ? state : { ...state, notice: undefined };
    return pressed(heard, event.press, context);
  }
  if ('stopRequested' in event) {
    return state.stopping.includes(event.stopRequested)
      ? state
      : { ...state, stopping: [...state.stopping, event.stopRequested] };
  }
  if ('quitFailed' in event) {
    return { ...state, quit: 'none', confirmQuit: false, notice: event.quitFailed };
  }
  if ('flow' in event) {
    return state.flow === undefined ? state : applyStep(state, reduceFlow(state.flow, event.flow), context);
  }
  if ('left' in event) {
    return state.open === undefined ? state : refetch({ ...state, open: undefined });
  }
  // A list that belongs to an older fetch, or that arrives while a run is open, changes nothing: coming back from the
  // run fetches again (specs/tui-home, AC-12).
  if (event.generation !== state.generation || state.open !== undefined) {
    return state;
  }
  if ('runs' in event) {
    return {
      ...state,
      runs: event.runs,
      loading: false,
      error: undefined,
      selected: clamp(state.selected, event.runs.length),
    };
  }
  return { ...state, loading: false, error: event.failed };
}
