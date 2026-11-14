import {
  attemptLines,
  formatHeader,
  type RunState,
  runnerLines,
  type StepView,
  sanitize,
  stepMark,
  toolsText,
} from '@indaba/engine';
import { type BoardPane, boardHelpRows, boardRows } from './board-screen.js';
import { clip, fit, type Layout, MIN_COLUMNS, MIN_ROWS, wrap } from './layout.js';
import { flatLine, paneBlockRows, panesFor } from './panes.js';
import type { UiState } from './ui-state.js';

/** How a row is drawn when colour is on. State is never shown by tone alone: every row also has a glyph and a word. */
export type Tone = 'normal' | 'dim' | 'good' | 'bad' | 'warn' | 'info' | 'accent';

export interface Row {
  readonly text: string;
  readonly tone: Tone;
  /** The row is the selected step: drawn inverse. */
  readonly selected: boolean;
}

export interface ScreenOptions {
  readonly ascii: boolean;
  /** The screen started the run, so quitting asks what to do with it. */
  readonly attached: boolean;
}

export interface Screen {
  readonly header: Row;
  readonly list: readonly Row[];
  readonly detail: readonly Row[];
  /** The board docked beside the detail pane; empty unless the layout docks it. */
  readonly dock: readonly Row[];
  readonly footer: Row;
  /** Lines of output the selected step has, for the scroll limit. */
  readonly outputLines: number;
  /** The panes of the running steps, drawn above the detail pane; empty when there is no room or nothing runs. */
  readonly panes?: readonly Row[];
  /** Lines of reasoning the shown step has, as drawn (wrapped), for the scroll limit. */
  readonly reasoningLines?: number;
}

const row = (text: string, tone: Tone = 'normal', selected = false): Row => ({ text, tone, selected });

/** Text that came from an agent or a command, safe for a terminal and on one line. */
function safe(text: string): string {
  return sanitize(text).replaceAll('\n', ' ').trim();
}

export function stepTone(status: string): Tone {
  switch (status) {
    case 'COMPLETED':
      return 'good';
    case 'FAILED':
      return 'bad';
    case 'ESCALATED':
      return 'accent';
    case 'CANCELLED':
    case 'VALIDATING':
      return 'warn';
    case 'RUNNING':
      return 'info';
    case 'PENDING':
      return 'dim';
    default:
      return 'normal';
  }
}

function runTone(status: RunState['status']): Tone {
  switch (status) {
    case 'completed':
      return 'good';
    case 'failed':
      return 'bad';
    case 'escalated':
      return 'accent';
    case 'cancelled':
    case 'unknown':
      return 'warn';
    case 'running':
      return 'info';
  }
}

export function stepLine(step: StepView, ascii: boolean): string {
  const { glyph, word } = stepMark(step.status, ascii);
  const attempt = step.attempts > 1 ? ` x${step.attempts}` : '';
  const waiting = step.waitingFor === undefined ? '' : `  waiting for ${safe(step.waitingFor)}`;
  return `${glyph} ${safe(step.id)}  ${word}${attempt}${waiting}`;
}

/** The notice that stands in for the panes on a terminal that is too small to draw them. */
export function tooSmallRows(layout: Layout): Row[] {
  return [
    row('Terminal too small', 'warn'),
    row(`need ${MIN_COLUMNS}x${MIN_ROWS}, have ${layout.columns}x${layout.rows}`, 'dim'),
    row('indaba watch --plain works at any size', 'dim'),
  ];
}

function listRows(run: RunState, ui: UiState, layout: Layout, options: ScreenOptions): Row[] {
  const height = layout.listRows;
  if (run.steps.length === 0) {
    return [row(fit('waiting for steps...', layout.listWidth, options.ascii), 'dim')];
  }
  // a window that keeps the selected step in view, roughly in the middle
  const start = Math.min(
    Math.max(0, ui.selected - Math.floor(height / 2)),
    Math.max(0, run.steps.length - height),
  );
  return run.steps.slice(start, start + height).map((step, i) => {
    const index = start + i;
    const marker = index === ui.selected ? (options.ascii ? '>' : '▸') : ' ';
    return row(
      fit(`${marker} ${stepLine(step, options.ascii)}`, layout.listWidth, options.ascii),
      stepTone(step.status),
      index === ui.selected,
    );
  });
}

function infoRows(step: StepView, width: number, ascii: boolean): Row[] {
  const rows: Row[] = [];
  const add = (text: string, tone: Tone = 'normal'): void => {
    rows.push(row(clip(text, width, ascii), tone));
  };
  for (const line of attemptLines(step)) {
    add(line, 'warn');
  }
  for (const line of runnerLines(step)) {
    add(line);
  }
  for (const skipped of step.skipped) {
    const why = safe(skipped.reason);
    add(`skipped: ${safe(skipped.runner)}${why === '' ? '' : ` (${why})`}`, 'warn');
  }
  const tools = toolsText(step);
  if (tools !== undefined) {
    add(tools);
  }
  const thought = step.thoughts.length + (step.partialThought === '' ? 0 : 1);
  if (thought > 0) {
    // Kept out of the pane on purpose: reasoning is not output, and the pane has no room for both.
    add(`reasoning: ${thought} line(s); indaba watch --plain --thoughts prints them`, 'dim');
  }
  if (step.consensus !== undefined) {
    add(`consensus: ${safe(step.consensus.outcome)} after ${step.consensus.rounds} round(s)`, 'accent');
  }
  for (const line of reasonLines(step)) {
    add(`reason: ${line}`, 'bad');
  }
  return rows;
}

/**
 * The reason a step failed, at most three lines. A failed command's error text is also in the output pane, so the
 * lines the pane already shows are left out here, except the first, which says what happened.
 */
function reasonLines(step: StepView): string[] {
  if (step.reason === undefined || step.reason === '') {
    return [];
  }
  const shown = new Set(step.output.map((line) => sanitize(line).trim()));
  return sanitize(step.reason)
    .split('\n')
    .filter((line, i) => i === 0 || !shown.has(line.trim()))
    .slice(0, 3);
}

const FINISHED = new Set(['COMPLETED', 'FAILED', 'ESCALATED', 'CANCELLED']);

/** The step the detail pane is about: the focused pane's step while it is enlarged, else the selected one. */
export function shownStep(run: RunState, ui: UiState): StepView | undefined {
  return ui.enlarged && ui.pane !== undefined
    ? run.steps.find((s) => s.id === ui.pane)
    : run.steps[ui.selected];
}

/** The model's reasoning of a step as drawn: complete lines and the one being written, cleaned and wrapped. */
function reasoningWrapped(step: StepView, width: number): string[] {
  const lines = [...step.thoughts, ...(step.partialThought === '' ? [] : [step.partialThought])];
  return lines.flatMap((line) => wrap(flatLine(line), width));
}

/** The output of a step as drawn: each line wrapped to the width, so scrolling counts rows and not lines. */
function outputWrapped(step: StepView, width: number): string[] {
  const lines = [...step.output, ...(step.partialLine === '' ? [] : [step.partialLine])];
  return lines.flatMap((line) => wrap(flatLine(line), width));
}

/** How many rows the output of the shown step takes at this width, for the scroll limit. */
export function outputLinesOf(run: RunState, ui: UiState, width: number): number {
  const step = shownStep(run, ui);
  return step === undefined ? 0 : outputWrapped(step, width).length;
}

/** How many rows the reasoning of the shown step takes at this width, for the scroll limit. */
export function reasoningLinesOf(run: RunState, ui: UiState, width: number): number {
  const step = shownStep(run, ui);
  return step === undefined ? 0 : reasoningWrapped(step, width).length;
}

/** What stands in the output pane of a step that has not printed anything. */
function emptyOutputText(step: StepView): string {
  if (!FINISHED.has(step.status)) {
    return '(no output yet)';
  }
  const exit = [...step.runners].reverse().find((r) => r.exitCode !== undefined)?.exitCode;
  return exit === undefined ? '(no output)' : `(no output, exit code ${exit})`;
}

function detailRows(
  run: RunState,
  ui: UiState,
  layout: Layout,
  options: ScreenOptions,
): { rows: Row[]; outputLines: number; reasoningLines: number } {
  const step = shownStep(run, ui);
  const width = layout.detailWidth;
  if (step === undefined) {
    const waiting =
      run.status === 'running' ? 'Waiting for the run to start...' : 'Nothing was recorded for this run.';
    return { rows: [row(clip(waiting, width, options.ascii), 'dim')], outputLines: 0, reasoningLines: 0 };
  }

  const { glyph, word } = stepMark(step.status, options.ascii);
  const attempt = step.attempts > 1 ? `  attempt ${step.attempts}` : '';
  const waiting = step.waitingFor === undefined ? '' : `  waiting for ${safe(step.waitingFor)}`;
  const large = ui.enlarged ? '  (enlarged, Esc to return)' : '';
  const title = row(
    clip(`${glyph} ${safe(step.id)}  ${word}${attempt}${waiting}${large}`, width, options.ascii),
    stepTone(step.status),
  );

  // keep at least two rows for the output, so a long list of facts never hides it
  const room = Math.max(0, layout.detailRows - 3);
  const info = infoRows(step, width, options.ascii).slice(0, room);

  // a long line is wrapped over several rows, so scrolling counts rows as they are drawn
  const lines = outputWrapped(step, width);
  const thinking = reasoningWrapped(step, width);
  const reasoning = ui.panel === 'reasoning';
  const shown = reasoning ? thinking : lines;
  const total = shown.length;
  const visible = Math.max(1, layout.detailRows - 1 - info.length - 1);
  const limit = Math.max(0, total - visible);
  const scroll = Math.min(reasoning ? ui.reasoningScroll : ui.scroll, limit);
  const end = total - scroll;
  const window = shown.slice(Math.max(0, end - visible), end);

  const mark = options.ascii ? '-' : '─';
  const state =
    scroll > 0
      ? ` (${scroll} line${scroll === 1 ? '' : 's'} back${reasoning ? '' : ', f to follow'})`
      : ui.follow || reasoning
        ? ''
        : ' (paused, f to follow)';
  const divider = row(
    clip(`${mark} ${reasoning ? 'reasoning' : 'output'}${state} `.padEnd(width, mark), width, options.ascii),
    'dim',
  );
  const output = window.map((line) => row(line, 'normal'));
  if (!reasoning && step.outputTruncated && scroll === 0) {
    output.push(
      row(clip('(stored output for this run ran out; the rest is not shown)', width, options.ascii), 'dim'),
    );
  }
  if (output.length === 0) {
    output.push(row(reasoning ? '(no reasoning yet)' : emptyOutputText(step), 'dim'));
  }
  return {
    rows: [title, ...info, divider, ...output].slice(0, Math.max(1, layout.detailRows)),
    outputLines: lines.length,
    reasoningLines: thinking.length,
  };
}

export function helpRows(width: number, ascii: boolean): Row[] {
  const arrows = ascii ? 'up/down' : '↑/↓';
  return [
    row('Keys', 'accent'),
    row(`${arrows}, j/k   select a step (or scroll, with tab)`, 'normal'),
    row('g / G        first / last step', 'normal'),
    row('PgUp, u      scroll the output back', 'normal'),
    row('PgDn, d      scroll the output forward', 'normal'),
    row('f            follow the newest output', 'normal'),
    row('tab          move the arrow keys between the panes', 'normal'),
    row('?            close this', 'normal'),
    row('b            the board: notes between steps', 'normal'),
    row('r / o        the reasoning / the output of the step', 'normal'),
    row('[ ]          move between the panes of running steps', 'normal'),
    row('Enter, z     enlarge the pane; Esc puts it back', 'normal'),
    row('q, ctrl-c    quit', 'normal'),
  ].map((r) => ({ ...r, text: clip(r.text, width, ascii) }));
}

/** The block of panes of the running steps, with the line that separates it from the detail pane under it. */
function paneBlock(run: RunState, ui: UiState, layout: Layout, options: ScreenOptions): Row[] {
  const found = panesFor(run, {
    rows: layout.paneRows,
    width: layout.detailWidth,
    focus: ui.pane,
    offset: ui.paneOffset,
    ascii: options.ascii,
  });
  const rule = options.ascii ? '-' : '─';
  return [
    ...paneBlockRows(found, layout.detailWidth, options.ascii),
    row(rule.repeat(layout.detailWidth), 'dim'),
  ];
}

function footerRow(ui: UiState, layout: Layout, options: ScreenOptions): Row {
  const arrows = options.ascii ? 'up/down' : '↑↓';
  // the question about a run is never hidden by news: d and c act on it
  if (ui.confirmQuit) {
    return row(
      clip('quit: d detach (the run keeps going)   c cancel the run   n stay', layout.columns, options.ascii),
      'warn',
    );
  }
  if (ui.notice !== undefined) {
    return row(clip(ui.notice, layout.columns, options.ascii), 'info');
  }
  const follow = ui.follow ? 'f follow*' : 'f follow';
  const keys =
    ui.focus === 'board'
      ? `${arrows} board   tab pane   b ${layout.dockWidth > 0 ? 'back to the steps' : 'close board'}   ? help   q quit`
      : `${arrows} select   tab pane   PgUp/PgDn scroll   ${follow}   b board   ? help   q quit`;
  return row(clip(keys, layout.columns, options.ascii), 'dim');
}

/** Everything the screen shows, as rows. Pure: the same run, state and size always give the same rows. */
export function buildScreen(
  run: RunState,
  ui: UiState,
  layout: Layout,
  options: ScreenOptions,
  board?: BoardPane,
): Screen {
  const header = row(
    clip(formatHeader(run, { ascii: options.ascii }), layout.columns, options.ascii),
    runTone(run.status),
  );
  if (layout.mode === 'too-small') {
    return {
      header,
      list: [],
      detail: tooSmallRows(layout),
      dock: [],
      footer: row('', 'dim'),
      outputLines: 0,
      panes: [],
      reasoningLines: 0,
    };
  }
  const list = listRows(run, ui, layout, options);
  // The help and the board in place of the detail pane have the rows the panes would have taken: nothing is drawn there,
  // and the footer must not move up.
  const whole: Layout =
    layout.paneRows > 0
      ? { ...layout, detailRows: layout.detailRows + layout.paneRows + 1, paneRows: 0, paneCap: 0 }
      : layout;
  if (ui.help) {
    return {
      header,
      list,
      detail: [
        ...helpRows(layout.detailWidth, options.ascii),
        ...boardHelpRows(layout.detailWidth, options.ascii),
      ].slice(0, whole.detailRows),
      dock: [],
      footer: footerRow(ui, layout, options),
      outputLines: 0,
    };
  }
  const docked = layout.dockWidth > 0;
  const dock = docked ? boardRows(board, layout.dockWidth, layout.dockRows, { ascii: options.ascii }) : [];
  if (ui.board && !docked) {
    const rows = boardRows(board, layout.detailWidth, whole.detailRows, { ascii: options.ascii });
    return { header, list, detail: rows, dock, footer: footerRow(ui, layout, options), outputLines: 0 };
  }
  const { rows, outputLines, reasoningLines } = detailRows(run, ui, layout, options);
  const panes = layout.paneRows > 0 && !ui.enlarged ? paneBlock(run, ui, layout, options) : [];
  return {
    header,
    list,
    detail: rows,
    dock,
    footer: footerRow(ui, layout, options),
    outputLines,
    reasoningLines,
    panes,
  };
}
