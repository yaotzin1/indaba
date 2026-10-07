/**
 * The screen's own state: which step is selected, how far the output is scrolled, which pane has the arrow keys,
 * and whether a question about quitting is open. Pure: a key press and the sizes in, the next state out.
 */
export interface UiState {
  readonly selected: number;
  /** Lines scrolled back from the newest output; 0 is the bottom. */
  readonly scroll: number;
  /** Stay at the newest output as it arrives. */
  readonly follow: boolean;
  readonly focus: 'list' | 'detail';
  readonly help: boolean;
  /** The "detach or cancel?" question is open (only for a run the screen started). */
  readonly confirmQuit: boolean;
  /** What the person chose to do with the screen. `none` means keep going. */
  readonly quit: 'none' | 'close' | 'detach' | 'cancel';
}

/** A key press, named so that nothing here depends on Ink. */
export type KeyName =
  | 'up'
  | 'down'
  | 'pageup'
  | 'pagedown'
  | 'home'
  | 'end'
  | 'tab'
  | 'escape'
  | 'enter'
  | 'ctrl-c'
  | { readonly char: string };

export interface UiContext {
  readonly steps: number;
  /** Lines of output the selected step has. */
  readonly outputLines: number;
  /** Rows of the detail pane's body, for paging. */
  readonly pageSize: number;
  /** The screen started the run, so quitting must ask what to do with it. */
  readonly attached: boolean;
}

export function initialUi(): UiState {
  return {
    selected: 0,
    scroll: 0,
    follow: true,
    focus: 'list',
    help: false,
    confirmQuit: false,
    quit: 'none',
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/** Keeps the selection and the scroll inside what exists now, after the run changed. */
export function clampUi(ui: UiState, context: UiContext): UiState {
  const selected = clamp(ui.selected, 0, context.steps - 1);
  const scroll = clamp(ui.scroll, 0, context.outputLines - 1);
  return selected === ui.selected && scroll === ui.scroll ? ui : { ...ui, selected, scroll };
}

function select(ui: UiState, to: number, context: UiContext): UiState {
  const selected = clamp(to, 0, context.steps - 1);
  // a different step starts at its newest output
  return selected === ui.selected ? ui : { ...ui, selected, scroll: 0, follow: true };
}

function scrollBy(ui: UiState, lines: number, context: UiContext): UiState {
  const scroll = clamp(ui.scroll + lines, 0, context.outputLines - 1);
  return { ...ui, scroll, follow: scroll === 0 };
}

export function reduceUi(ui: UiState, press: KeyName, context: UiContext): UiState {
  if (ui.confirmQuit) {
    if (typeof press === 'object') {
      if (press.char === 'd') {
        return { ...ui, quit: 'detach' };
      }
      if (press.char === 'c') {
        return { ...ui, quit: 'cancel' };
      }
      if (press.char === 'n') {
        return { ...ui, confirmQuit: false };
      }
      return ui;
    }
    return press === 'escape' ? { ...ui, confirmQuit: false } : ui;
  }

  if (press === 'ctrl-c' || (typeof press === 'object' && press.char === 'q')) {
    return context.attached ? { ...ui, confirmQuit: true } : { ...ui, quit: 'close' };
  }
  if (press === 'escape') {
    return ui.help ? { ...ui, help: false } : ui;
  }
  if (press === 'tab') {
    return { ...ui, focus: ui.focus === 'list' ? 'detail' : 'list' };
  }
  if (press === 'up' || (typeof press === 'object' && press.char === 'k')) {
    return ui.focus === 'list' ? select(ui, ui.selected - 1, context) : scrollBy(ui, 1, context);
  }
  if (press === 'down' || (typeof press === 'object' && press.char === 'j')) {
    return ui.focus === 'list' ? select(ui, ui.selected + 1, context) : scrollBy(ui, -1, context);
  }
  if (press === 'home' || (typeof press === 'object' && press.char === 'g')) {
    return select(ui, 0, context);
  }
  if (press === 'end' || (typeof press === 'object' && press.char === 'G')) {
    return select(ui, context.steps - 1, context);
  }
  if (press === 'pageup' || (typeof press === 'object' && press.char === 'u')) {
    return scrollBy(ui, Math.max(1, context.pageSize), context);
  }
  if (press === 'pagedown' || (typeof press === 'object' && press.char === 'd')) {
    return scrollBy(ui, -Math.max(1, context.pageSize), context);
  }
  if (typeof press === 'object' && press.char === 'f') {
    return ui.follow ? { ...ui, follow: false } : { ...ui, follow: true, scroll: 0 };
  }
  if (typeof press === 'object' && (press.char === '?' || press.char === 'h')) {
    return { ...ui, help: !ui.help };
  }
  return ui;
}
