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
  readonly focus: 'list' | 'detail' | 'board';
  /** The board pane takes the place of the detail pane (`b`). */
  readonly board: boolean;
  readonly help: boolean;
  /** The "detach or cancel?" question is open (only for a run the screen started). */
  readonly confirmQuit: boolean;
  /** What the person chose to do with the screen. `none` means keep going. */
  readonly quit: 'none' | 'close' | 'detach' | 'cancel';
  /** What the detail pane shows of the step: its output, or its reasoning (`r`, back with `o`). */
  readonly panel: 'output' | 'reasoning';
  /** Lines of reasoning scrolled back; each view keeps its own place. */
  readonly reasoningScroll: number;
  /** The id of the step of the focused pane (a pane is drawn for each running step). A step's id, never an index. */
  readonly pane: string | undefined;
  /** The first running step drawn, when more are running than the panes have room for. */
  readonly paneOffset: number;
  /** The focused pane takes the whole detail pane (`Enter` or `z`), until `Esc`. */
  readonly enlarged: boolean;
  /** One fixed line of news (the enlarged step is no longer running); it goes with the next key. */
  readonly notice: string | undefined;
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
  | 'backspace'
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
  /** The board is docked beside the other panes, so it is always showing and `b` only moves the arrow keys to it. */
  readonly docked?: boolean;
  /** Lines of reasoning the shown step has, as drawn (wrapped). */
  readonly reasoningLines?: number;
  /** The ids of the running steps, in the order of the run: the steps that have a pane. */
  readonly panes?: readonly string[];
  /** How many panes fit in the block at this size. */
  readonly paneCap?: number;
}

export function initialUi(): UiState {
  return {
    selected: 0,
    scroll: 0,
    follow: true,
    focus: 'list',
    board: false,
    help: false,
    confirmQuit: false,
    quit: 'none',
    panel: 'output',
    reasoningScroll: 0,
    pane: undefined,
    paneOffset: 0,
    enlarged: false,
    notice: undefined,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/** Keeps the selection and the scroll inside what exists now, after the run changed. */
export function clampUi(ui: UiState, context: UiContext): UiState {
  const selected = clamp(ui.selected, 0, context.steps - 1);
  const scroll = clamp(ui.scroll, 0, context.outputLines - 1);
  // the terminal was made narrower: a board that is neither docked nor open cannot hold the arrow keys
  let focus = ui.focus === 'board' && context.docked !== true && !ui.board ? 'list' : ui.focus;
  const reasoningScroll = clamp(ui.reasoningScroll, 0, (context.reasoningLines ?? 0) - 1);
  let pane = ui.pane;
  let paneOffset = ui.paneOffset;
  let enlarged = ui.enlarged;
  let notice = ui.notice;
  if (context.panes !== undefined) {
    const running = context.panes;
    if (pane !== undefined && !running.includes(pane)) {
      pane = undefined;
    }
    if (enlarged && pane === undefined) {
      // the step it showed is no longer running: say so once, and give the keys back to the list
      enlarged = false;
      // not "finished": a step that retries or waits is no longer running either, and the line must be true of all of them
      notice = 'step is no longer running';
      focus = 'list';
    }
    paneOffset = clamp(paneOffset, 0, running.length - (context.paneCap ?? running.length));
  }
  return selected === ui.selected &&
    scroll === ui.scroll &&
    focus === ui.focus &&
    reasoningScroll === ui.reasoningScroll &&
    pane === ui.pane &&
    paneOffset === ui.paneOffset &&
    enlarged === ui.enlarged &&
    notice === ui.notice
    ? ui
    : { ...ui, selected, scroll, focus, reasoningScroll, pane, paneOffset, enlarged, notice };
}

function select(ui: UiState, to: number, context: UiContext): UiState {
  const selected = clamp(to, 0, context.steps - 1);
  // a different step starts at its newest output and its newest reasoning
  return selected === ui.selected ? ui : { ...ui, selected, scroll: 0, reasoningScroll: 0, follow: true };
}

function scrollBy(ui: UiState, lines: number, context: UiContext): UiState {
  if (ui.panel === 'reasoning') {
    return {
      ...ui,
      reasoningScroll: clamp(ui.reasoningScroll + lines, 0, (context.reasoningLines ?? 0) - 1),
    };
  }
  const scroll = clamp(ui.scroll + lines, 0, context.outputLines - 1);
  return { ...ui, scroll, follow: scroll === 0 };
}

/** Moves the focus of the panes by `by`, and the window of them to keep it in sight. Nothing to focus: nothing changes. */
function movePane(ui: UiState, by: number, context: UiContext): UiState {
  const running = context.panes ?? [];
  // with no room for panes (a small terminal) nothing is drawn to move between; an enlarged pane has no block of them either
  if (running.length === 0 || (!ui.enlarged && context.paneCap === 0)) {
    return ui;
  }
  const at = ui.pane === undefined ? -1 : running.indexOf(ui.pane);
  const next = clamp(at < 0 ? (by > 0 ? 0 : running.length - 1) : at + by, 0, running.length - 1);
  const cap = Math.max(1, context.paneCap ?? running.length);
  const paneOffset =
    next < ui.paneOffset ? next : next >= ui.paneOffset + cap ? next - cap + 1 : ui.paneOffset;
  const pane = running[next];
  if (pane === ui.pane && paneOffset === ui.paneOffset) {
    return ui;
  }
  // moving between panes is not reading another step: the place in the selected one is kept, unless the pane is enlarged and
  // another step takes its place
  return ui.enlarged ? { ...ui, pane, paneOffset, scroll: 0, follow: true } : { ...ui, pane, paneOffset };
}

/** Tab moves the arrow keys between the step list and the other pane, which is the board while it is open. */
function nextFocus(ui: UiState, docked: boolean): UiState['focus'] {
  if (docked) {
    return ui.focus === 'list' ? 'detail' : ui.focus === 'detail' ? 'board' : 'list';
  }
  if (ui.focus === 'list') {
    return ui.board ? 'board' : 'detail';
  }
  return 'list';
}

/** A key press and the sizes in, the next state out. A line of news lasts until the next key. */
export function reduceUi(ui: UiState, press: KeyName, context: UiContext): UiState {
  return reduceKey(ui.notice === undefined ? ui : { ...ui, notice: undefined }, press, context);
}

function reduceKey(ui: UiState, press: KeyName, context: UiContext): UiState {
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
    if (ui.help) {
      return { ...ui, help: false };
    }
    if (ui.enlarged) {
      return { ...ui, enlarged: false, focus: 'list', scroll: 0, follow: true };
    }
    if (context.docked === true) {
      return ui.focus === 'board' ? { ...ui, focus: 'list' } : ui;
    }
    return ui.board ? { ...ui, board: false, focus: 'detail' } : ui;
  }
  const char = typeof press === 'object' ? press.char : undefined;
  if (ui.enlarged && (char === 'b' || char === '?' || char === 'h' || char === 'r' || char === 'o')) {
    // the enlarged pane has the screen: no board, help or other view until it is put back
    return ui;
  }
  if (char === '[' || char === ']') {
    return ui.help ? ui : movePane(ui, char === ']' ? 1 : -1, context);
  }
  if ((press === 'enter' || char === 'z') && !ui.help) {
    const running = context.panes ?? [];
    const pane = ui.pane !== undefined && running.includes(ui.pane) ? ui.pane : running[0];
    if (pane === undefined || ui.enlarged) {
      return ui;
    }
    return { ...ui, pane, enlarged: true, focus: 'detail', scroll: 0, follow: true, board: false };
  }
  if (char === 'r' && !ui.help) {
    return { ...ui, panel: 'reasoning' };
  }
  if (char === 'o' && !ui.help) {
    return { ...ui, panel: 'output' };
  }
  if (press === 'tab') {
    return ui.enlarged ? ui : { ...ui, focus: nextFocus(ui, context.docked === true) };
  }
  if (typeof press === 'object' && press.char === 'b' && !ui.help) {
    if (context.docked === true) {
      return { ...ui, focus: ui.focus === 'board' ? 'list' : 'board' };
    }
    return ui.board ? { ...ui, board: false, focus: 'detail' } : { ...ui, board: true, focus: 'board' };
  }
  if (press === 'up' || (typeof press === 'object' && press.char === 'k')) {
    return ui.focus === 'list'
      ? select(ui, ui.selected - 1, context)
      : ui.focus === 'board'
        ? ui
        : scrollBy(ui, 1, context);
  }
  if (press === 'down' || (typeof press === 'object' && press.char === 'j')) {
    return ui.focus === 'list'
      ? select(ui, ui.selected + 1, context)
      : ui.focus === 'board'
        ? ui
        : scrollBy(ui, -1, context);
  }
  // an enlarged pane has the screen: the step list behind it, and its follow mode, are not changed from here
  if (
    ui.enlarged &&
    (press === 'home' ||
      press === 'end' ||
      (typeof press === 'object' && (press.char === 'g' || press.char === 'G' || press.char === 'f')))
  ) {
    return ui;
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
