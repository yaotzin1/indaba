import {
  formatHeader,
  type RunState,
  runnerText,
  type StepView,
  sanitize,
  stepMark,
  toolsText,
} from '@indaba/engine';
import { clip, fit, type Layout, MIN_COLUMNS, MIN_ROWS } from './layout.js';
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
  readonly footer: Row;
  /** Lines of output the selected step has, for the scroll limit. */
  readonly outputLines: number;
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
  return `${glyph} ${safe(step.id)}  ${word}${attempt}`;
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
  if (step.runners.length > 0) {
    add(`runners: ${step.runners.map(runnerText).join(' -> ')}`);
  }
  for (const skipped of step.skipped) {
    const why = safe(skipped.reason);
    add(`skipped: ${safe(skipped.runner)}${why === '' ? '' : ` (${why})`}`, 'warn');
  }
  const tools = toolsText(step);
  if (tools !== undefined) {
    add(tools);
  }
  if (step.consensus !== undefined) {
    add(`consensus: ${safe(step.consensus.outcome)} after ${step.consensus.rounds} round(s)`, 'accent');
  }
  if (step.reason !== undefined && step.reason !== '') {
    for (const line of sanitize(step.reason).split('\n').slice(0, 3)) {
      add(`reason: ${line}`, 'bad');
    }
  }
  return rows;
}

function detailRows(
  run: RunState,
  ui: UiState,
  layout: Layout,
  options: ScreenOptions,
): { rows: Row[]; outputLines: number } {
  const step = run.steps[ui.selected];
  const width = layout.detailWidth;
  if (step === undefined) {
    const waiting =
      run.status === 'running' ? 'Waiting for the run to start...' : 'Nothing was recorded for this run.';
    return { rows: [row(clip(waiting, width, options.ascii), 'dim')], outputLines: 0 };
  }

  const { glyph, word } = stepMark(step.status, options.ascii);
  const attempt = step.attempts > 1 ? `  attempt ${step.attempts}` : '';
  const title = row(
    clip(`${glyph} ${safe(step.id)}  ${word}${attempt}`, width, options.ascii),
    stepTone(step.status),
  );

  // keep at least two rows for the output, so a long list of facts never hides it
  const room = Math.max(0, layout.detailRows - 3);
  const info = infoRows(step, width, options.ascii).slice(0, room);

  const lines = [...step.output, ...(step.partialLine === '' ? [] : [step.partialLine])];
  const total = lines.length;
  const visible = Math.max(1, layout.detailRows - 1 - info.length - 1);
  const limit = Math.max(0, total - visible);
  const scroll = Math.min(ui.scroll, limit);
  const end = total - scroll;
  const window = lines.slice(Math.max(0, end - visible), end);

  const mark = options.ascii ? '-' : '─';
  const state =
    scroll > 0
      ? ` (${scroll} line${scroll === 1 ? '' : 's'} back, f to follow)`
      : ui.follow
        ? ''
        : ' (paused, f to follow)';
  const divider = row(clip(`${mark} output${state} `.padEnd(width, mark), width, options.ascii), 'dim');
  const output = window.map((line) =>
    row(clip(sanitize(line).replaceAll('\n', ' '), width, options.ascii), 'normal'),
  );
  if (step.outputTruncated && scroll === 0) {
    output.push(
      row(clip('(stored output for this run ran out; the rest is not shown)', width, options.ascii), 'dim'),
    );
  }
  if (output.length === 0) {
    output.push(row('(no output yet)', 'dim'));
  }
  return {
    rows: [title, ...info, divider, ...output].slice(0, Math.max(1, layout.detailRows)),
    outputLines: total,
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
    row('q, ctrl-c    quit', 'normal'),
  ].map((r) => ({ ...r, text: clip(r.text, width, ascii) }));
}

function footerRow(ui: UiState, layout: Layout, options: ScreenOptions): Row {
  const arrows = options.ascii ? 'up/down' : '↑↓';
  if (ui.confirmQuit) {
    return row(
      clip('quit: d detach (the run keeps going)   c cancel the run   n stay', layout.columns, options.ascii),
      'warn',
    );
  }
  const follow = ui.follow ? 'f follow*' : 'f follow';
  const keys = `${arrows} select   tab pane   PgUp/PgDn scroll   ${follow}   ? help   q quit`;
  return row(clip(keys, layout.columns, options.ascii), 'dim');
}

/** Everything the screen shows, as rows. Pure: the same run, state and size always give the same rows. */
export function buildScreen(run: RunState, ui: UiState, layout: Layout, options: ScreenOptions): Screen {
  const header = row(
    clip(formatHeader(run, { ascii: options.ascii }), layout.columns, options.ascii),
    runTone(run.status),
  );
  if (layout.mode === 'too-small') {
    return { header, list: [], detail: tooSmallRows(layout), footer: row('', 'dim'), outputLines: 0 };
  }
  const list = listRows(run, ui, layout, options);
  if (ui.help) {
    return {
      header,
      list,
      detail: helpRows(layout.detailWidth, options.ascii).slice(0, layout.detailRows),
      footer: footerRow(ui, layout, options),
      outputLines: 0,
    };
  }
  const { rows, outputLines } = detailRows(run, ui, layout, options);
  return { header, list, detail: rows, footer: footerRow(ui, layout, options), outputLines };
}
