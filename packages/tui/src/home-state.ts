import type { RunSummary } from '@indaba/engine';
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
}

export type HomeEvent =
  | { readonly press: KeyName }
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
  if (press === 'enter' && context.canOpen) {
    const run = state.runs[state.selected];
    return run === undefined ? state : { ...state, open: run.runId };
  }
  return state;
}

export function reduceHome(state: HomeState, event: HomeEvent, context: HomeContext): HomeState {
  if ('press' in event) {
    // while a run is open its dashboard has the keyboard
    return state.open === undefined ? pressed(state, event.press, context) : state;
  }
  if ('left' in event) {
    return state.open === undefined ? state : refetch({ ...state, open: undefined });
  }
  if (event.generation !== state.generation) {
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
