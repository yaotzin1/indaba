import type { RunSummary } from '@indaba/engine';
import { sanitize } from '@indaba/engine';
import type { HomeState } from './home-state.js';
import { shippedKeys } from './keymap.js';
import { clip, fit, type Layout } from './layout.js';
import { type Row, type Screen, type Tone, tooSmallRows } from './screen.js';

export interface HomeScreenOptions {
  readonly ascii: boolean;
  /** A way to open a run was supplied, so the key line and `?` name `Enter`. */
  readonly canOpen: boolean;
  /** A control that starts and stops runs was supplied, so the keys `n` and `s` are named. */
  readonly canControl?: boolean;
}

const row = (text: string, tone: Tone = 'normal', selected = false): Row => ({ text, tone, selected });

/** Text that came from a trace, safe for a terminal, on one line, and (in ASCII mode) with no character above 7-bit. */
function safe(text: string, ascii: boolean): string {
  const plain = sanitize(text).replace(/[\r\n\t]+/g, ' ');
  return ascii ? plain.replace(/[^\x20-\x7e]/g, '?') : plain;
}

/** A mark and a word for each state, so colour is never the only sign (epic R-03). */
const MARKS: Readonly<Record<RunSummary['status'], { readonly mark: string; readonly plain: string }>> = {
  completed: { mark: '✓', plain: '+' },
  failed: { mark: '✗', plain: 'x' },
  running: { mark: '●', plain: '*' },
  escalated: { mark: '▲', plain: '!' },
  cancelled: { mark: '○', plain: '-' },
  unknown: { mark: '?', plain: '?' },
};

const TONES: Readonly<Record<RunSummary['status'], Tone>> = {
  completed: 'good',
  failed: 'bad',
  running: 'info',
  escalated: 'accent',
  cancelled: 'warn',
  unknown: 'warn',
};

/** Cost as the run recorded it: a call with no price is said to be unpriced, never counted as free. */
export function costText(cost: RunSummary['cost']): string {
  if (cost.calls === 0) {
    return '-';
  }
  const priced = `$${cost.usd.toFixed(2)}`;
  return cost.unknown > 0 ? `${priced}+${cost.unknown} unpriced` : priced;
}

function startedText(startedAt: string | undefined, ascii: boolean): string {
  return startedAt === undefined ? '-' : safe(startedAt.slice(0, 16).replace('T', ' '), ascii);
}

function runLine(run: RunSummary, width: number, ascii: boolean): string {
  const { mark, plain } = MARKS[run.status];
  const name = run.workflow === undefined ? '(unnamed)' : safe(run.workflow, ascii);
  return clip(
    `${ascii ? plain : mark} ${fit(run.status, 9)} ${fit(name, 18, ascii)} ${fit(startedText(run.startedAt, ascii), 16)}  ${costText(run.cost)}`,
    width,
    ascii,
  );
}

function helpRows(options: HomeScreenOptions): Row[] {
  return [
    row('Keys', 'accent'),
    ...shippedKeys({ openRun: options.canOpen, runs: options.canControl === true }).map((key) =>
      row(`${fit(key.keys, 10)}${key.label}`),
    ),
  ];
}

function detailRows(run: RunSummary | undefined, width: number, ascii: boolean): Row[] {
  if (run === undefined) {
    return [];
  }
  const { mark, plain } = MARKS[run.status];
  return [
    row(clip(`${ascii ? plain : mark} ${run.status}`, width, ascii), TONES[run.status]),
    row(clip(`run      ${safe(run.runId, ascii)}`, width, ascii)),
    row(
      clip(`workflow ${run.workflow === undefined ? '(unnamed)' : safe(run.workflow, ascii)}`, width, ascii),
    ),
    row(clip(`started  ${startedText(run.startedAt, ascii)}`, width, ascii)),
    row(clip(`cost     ${costText(run.cost)}`, width, ascii), 'dim'),
    row(clip(`calls    ${run.cost.calls}`, width, ascii), 'dim'),
  ];
}

function keyLine(state: HomeState, options: HomeScreenOptions, width: number): Row {
  if (state.notice !== undefined) {
    // the footer has the whole width; a list pane is too narrow for a sentence
    return row(clip(safe(state.notice, options.ascii), width, options.ascii), 'info');
  }
  if (state.confirmQuit) {
    return row(clip('d detach (the run goes on)   c stop the run   n stay', width, options.ascii), 'warn');
  }
  const text = shippedKeys({ openRun: options.canOpen, runs: options.canControl === true })
    .filter((key) => key.id !== 'up' && key.id !== 'down')
    .map((key) => `${key.keys} ${key.label}`)
    .join('   ');
  return row(clip(`j k move   ${text}`, width, options.ascii), 'dim');
}

/** A window of the runs that keeps the selected one in view. */
function windowOf(state: HomeState, height: number): { start: number; end: number } {
  const start = Math.max(0, Math.min(state.selected - Math.floor(height / 2), state.runs.length - height));
  return { start, end: Math.min(state.runs.length, start + height) };
}

export function buildHomeScreen(state: HomeState, layout: Layout, options: HomeScreenOptions): Screen {
  const empty: Row = row('');
  if (layout.mode === 'too-small') {
    return {
      header: row('Indaba', 'accent'),
      list: [],
      detail: tooSmallRows(layout),
      dock: [],
      footer: empty,
      outputLines: 0,
    };
  }
  const { ascii } = options;
  const title = state.loading ? 'Indaba - runs (loading...)' : `Indaba - runs (${state.runs.length})`;
  const header = row(clip(title, layout.columns, ascii), 'accent');
  const footer = keyLine(state, options, layout.columns);
  const body = layout.mode === 'split' ? layout.listRows : layout.listRows + layout.detailRows;
  const width = layout.mode === 'split' ? layout.listWidth : layout.columns;

  let list: Row[];
  if (state.help && layout.mode !== 'split') {
    list = helpRows(options);
  } else if (state.runs.length === 0) {
    list = [
      ...(state.error === undefined
        ? [row(state.loading ? 'looking for runs...' : 'no runs yet', 'dim')]
        : [
            row('could not list the runs', 'bad'),
            row(clip(safe(state.error, ascii), width, ascii), 'dim'),
            row('r tries again', 'dim'),
          ]),
      ...(state.loading || state.error !== undefined
        ? []
        : [row(clip('start one with: indaba run <workflow file>', width, ascii), 'dim')]),
    ];
  } else {
    const { start, end } = windowOf(state, body - (state.error === undefined ? 0 : 1));
    list = [
      ...(state.error === undefined
        ? []
        : [row(clip(`could not refresh (r tries again)`, width, ascii), 'bad')]),
      ...state.runs
        .slice(start, end)
        .map((run, index) =>
          row(runLine(run, width, ascii), TONES[run.status], start + index === state.selected),
        ),
    ];
  }

  const detail =
    layout.mode !== 'split'
      ? []
      : state.help
        ? helpRows(options)
        : detailRows(state.runs[state.selected], layout.detailWidth, ascii);
  return { header, list, detail, dock: [], footer, outputLines: 0 };
}
