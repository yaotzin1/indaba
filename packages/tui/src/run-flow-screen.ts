import { describeAttention, type ReadinessItemView, type WorkflowSummary } from '@indaba/engine';
import { clip, type Layout } from './layout.js';
import { type FlowState, isOpen, openItems, type Picking, plain, visibleWorkflows } from './run-flow.js';
import { type Row, type Screen, type Tone, tooSmallRows } from './screen.js';

export interface FlowScreenOptions {
  readonly ascii: boolean;
}

const row = (text: string, tone: Tone = 'normal', selected = false): Row => ({ text, tone, selected });

/** Text from a workflow file or the control: no control sequence, one line, and (in ASCII mode) 7-bit only. */
function safe(text: string, ascii: boolean, limit = 200): string {
  const flat = plain(text, limit);
  return ascii ? flat.replace(/[^\x20-\x7e]/g, '?') : flat;
}

const NONE: Screen = {
  header: row(''),
  list: [],
  detail: [],
  dock: [],
  footer: row(''),
  outputLines: 0,
};

/** Whether this state is drawn as a dialog on the whole width instead of the two panes of the picker. */
export function isDialog(state: FlowState): boolean {
  return state.kind !== 'picking';
}

function workflowLine(w: WorkflowSummary, width: number, ascii: boolean): string {
  const mark = w.valid ? ' ' : ascii ? 'x' : '✗';
  const head = `${safe(w.project, ascii, 30)} / ${safe(w.name, ascii, 60)}`;
  return clip(`${mark} ${w.valid ? head : `${head} (not valid)`}`, width, ascii);
}

function pickerRows(state: Picking, layout: Layout, ascii: boolean): { list: Row[]; detail: Row[] } {
  const shown = visibleWorkflows(state);
  const width = layout.mode === 'split' ? layout.listWidth : layout.columns;
  const rows: Row[] = [];
  if (state.editing || state.filter !== '') {
    rows.push(
      row(
        clip(`filter: ${safe(state.filter, ascii, 40)}${state.editing ? '_' : ''}`, width, ascii),
        'accent',
      ),
    );
  }
  if (state.loading) {
    rows.push(row('looking for workflows...', 'dim'));
  } else if (state.error !== undefined) {
    rows.push(row(clip(safe(state.error, ascii), width, ascii), 'bad'));
  }
  if (!state.loading && shown.length === 0 && state.error === undefined) {
    rows.push(
      row(state.workflows.length === 0 ? 'no workflows found in this project' : 'nothing matches', 'dim'),
    );
  }
  const height = Math.max(
    1,
    (layout.mode === 'split' ? layout.listRows : layout.listRows + layout.detailRows) - rows.length,
  );
  const start = Math.max(0, Math.min(state.selected - Math.floor(height / 2), shown.length - height));
  shown.slice(start, start + height).forEach((w, index) => {
    rows.push(
      row(workflowLine(w, width, ascii), w.valid ? 'normal' : 'bad', start + index === state.selected),
    );
  });
  if (state.truncated) {
    rows.push(row('the list may be incomplete', 'warn'));
  }
  const chosen = shown[state.selected];
  const detail: Row[] =
    layout.mode !== 'split' || chosen === undefined
      ? []
      : [
          row(clip(safe(chosen.name, ascii, 80), layout.detailWidth, ascii), 'accent'),
          row(clip(`project  ${safe(chosen.project, ascii, 60)}`, layout.detailWidth, ascii)),
          row(clip(`file     ${safe(chosen.path, ascii, 120)}`, layout.detailWidth, ascii)),
          ...(chosen.tags !== undefined && chosen.tags.length > 0
            ? [
                row(
                  clip(
                    `tags     ${chosen.tags.map((t) => safe(t, ascii, 30)).join(', ')}`,
                    layout.detailWidth,
                    ascii,
                  ),
                  'dim',
                ),
              ]
            : []),
          ...(chosen.valid
            ? [row('valid', 'good')]
            : chosen.problems
                .slice(0, 5)
                .map((p) => row(clip(`- ${safe(p, ascii, 160)}`, layout.detailWidth, ascii), 'bad'))),
        ];
  return { list: rows, detail };
}

function lines(
  title: string,
  tone: Tone,
  body: readonly Row[],
  keys: string,
  width: number,
  ascii: boolean,
): Screen {
  return {
    header: row(clip(title, width, ascii), tone),
    list: [],
    // every row is held to the width here, so no section label or sentence can run past the edge
    detail: [
      ...body.map((r) => ({ ...r, text: clip(r.text, width, ascii) })),
      row(''),
      row(clip(keys, width, ascii), 'dim'),
    ],
    dock: [],
    footer: row(''),
    outputLines: 0,
  };
}

function listed(label: string, items: readonly string[], width: number, ascii: boolean): Row[] {
  if (items.length === 0) {
    return [];
  }
  return [
    row(`${label}`, 'accent'),
    ...items.slice(0, 12).map((item) => row(clip(`  ${safe(item, ascii, 160)}`, width, ascii))),
    ...(items.length > 12 ? [row(`  ...and ${items.length - 12} more`, 'dim')] : []),
  ];
}

/** Breaks one line of words into lines of at most `width` characters, at spaces, at most `max` lines. */
function wrap(text: string, width: number, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ').filter((w) => w !== '')) {
    const next = line === '' ? word : `${line} ${word}`;
    if (Array.from(next).length <= width || line === '') {
      line = next;
    } else {
      out.push(line);
      line = word;
    }
  }
  if (line !== '') {
    out.push(line);
  }
  return out.slice(0, max);
}

const toneOf = (item: ReadinessItemView): Tone =>
  item.critical && item.state === 'missing'
    ? 'bad'
    : item.state === 'missing' || item.state === 'needs-confirmation'
      ? 'warn'
      : 'dim';

/** The report as rows: ready items one count, then what is open with the selected item's words in full (AC-13). */
function readinessRows(
  state: Extract<FlowState, { kind: 'readiness' }>,
  width: number,
  ascii: boolean,
  height: number,
): Row[] {
  const open = openItems(state.report);
  const ready = state.report.items.filter((item) => !isOpen(item)).length;
  const out: Row[] = [row(`${ready} ready, ${open.length} to look at`, 'dim')];
  if (state.error !== undefined) {
    out.push(
      row(clip(`The readiness could not be checked: ${safe(state.error, ascii)}`, width, ascii), 'warn'),
    );
  }
  if (open.length === 0 && state.error === undefined) {
    out.push(row('Nothing is left to look at.', 'good'));
  }
  // The items drawn fit the terminal: the header, the count, the keys and the words of how to fix take the rest, so the
  // selected item is always one of the rows drawn and the key line is never pushed off the screen.
  const room = Math.max(1, Math.min(10, height - 12));
  const start = Math.max(0, Math.min(state.selected - Math.floor(room / 2), open.length - room));
  if (start > 0) {
    out.push(row(`...${start} above`, 'dim'));
  }
  open.slice(start, start + room).forEach((item, index) => {
    const full = safe(describeAttention(item), ascii, 400);
    const head = full.split(' How: ')[0] ?? full;
    out.push(row(clip(head, width, ascii), toneOf(item), start + index === state.selected));
  });
  if (start + room < open.length) {
    out.push(row(`...and ${open.length - start - room} more below`, 'dim'));
  }
  const chosen = open[state.selected];
  if (chosen?.how !== undefined && chosen.how !== '') {
    out.push(row(''));
    for (const line of wrap(`How: ${safe(chosen.how, ascii, 400)}`, width, 3)) {
      out.push(row(line, 'normal'));
    }
  }
  return out;
}

export function buildFlowScreen(state: FlowState, layout: Layout, options: FlowScreenOptions): Screen {
  const { ascii } = options;
  if (layout.mode === 'too-small') {
    return { ...NONE, header: row('Indaba', 'accent'), detail: tooSmallRows(layout) };
  }
  const width = layout.columns;
  switch (state.kind) {
    case 'picking': {
      const { list, detail } = pickerRows(state, layout, ascii);
      return {
        header: row(clip('Start a workflow', width, ascii), 'accent'),
        list,
        detail,
        dock: [],
        footer: row(
          clip(
            state.editing
              ? 'type to filter   Enter or Esc done   Backspace delete'
              : 'j k move   Enter start   / filter   h hidden   r reload   Esc back',
            width,
            ascii,
          ),
          'dim',
        ),
        outputLines: 0,
      };
    }
    case 'checking':
      return lines(
        `Starting ${safe(state.name, ascii, 60)}`,
        'info',
        [row('looking at what this run needs...', 'dim')],
        'Esc cancel',
        width,
        ascii,
      );
    case 'readiness': {
      const open = openItems(state.report);
      const selected = open[state.selected];
      const canConfirm = selected?.state === 'needs-confirmation';
      return lines(
        `${safe(state.name, ascii, 60)}: what this run needs`,
        state.report.criticalMissing > 0 ? 'bad' : open.length > 0 ? 'warn' : 'info',
        readinessRows(state, width, ascii, layout.rows),
        `Enter start${open.length > 0 ? ' anyway' : ''}   ${open.length > 1 ? 'j k move   ' : ''}${canConfirm ? 'c confirm for this run   ' : ''}n cancel`,
        width,
        ascii,
      );
    }
    case 'requesting':
      return lines(
        `Starting ${safe(state.name, ascii, 60)}`,
        'info',
        [row('asking the control...', 'dim')],
        'please wait',
        width,
        ascii,
      );
    case 'confirming': {
      const use = state.use;
      return lines(
        `Confirm what ${safe(state.name, ascii, 60)} will use`,
        'warn',
        [
          ...(state.changed ? [row('This file changed since you looked. Read it again.', 'bad')] : []),
          ...listed('Runners', use.runners, width, ascii),
          ...listed('Commands', use.commands, width, ascii),
          ...listed('What agents may change', use.permissions, width, ascii),
          ...listed(
            'Needs a person (the run has no terminal, so it will stop there)',
            use.needsPerson,
            width,
            ascii,
          ),
        ],
        'y confirm and start   n cancel',
        width,
        ascii,
      );
    }
    case 'fullAccess':
      return lines(
        `${safe(state.name, ascii, 60)} has steps with FULL access`,
        'bad',
        [
          ...(state.changed ? [row('This file changed since you looked. Read it again.', 'bad')] : []),
          row('These steps may do anything the agent can do on this machine:'),
          ...state.steps
            .slice(0, 12)
            .map((step) =>
              row(
                clip(
                  `  ${safe(step.stepId, ascii, 60)}  (${step.runners.map((r) => safe(r, ascii, 30)).join(', ')})`,
                  width,
                  ascii,
                ),
                'bad',
              ),
            ),
        ],
        'a allow full access and start   n cancel',
        width,
        ascii,
      );
    case 'starting':
      return lines(
        `Starting ${safe(state.name, ascii, 60)}`,
        'info',
        [row(`waiting for the run to appear (${state.polls})`, 'dim')],
        'please wait: leaving now would leave a run behind',
        width,
        ascii,
      );
    case 'failed':
      return lines(
        'The run did not start',
        'bad',
        [row(clip(safe(state.message, ascii), width, ascii), 'bad')],
        'any key to go back',
        width,
        ascii,
      );
    case 'stopConfirm':
      return lines(
        'Stop this run?',
        'warn',
        [
          row(`run ${safe(state.runId, ascii, 40)}`),
          row('It is asked to stop as Ctrl+C stops it, and its worktree is torn down.', 'dim'),
        ],
        'y stop it   n keep it running',
        width,
        ascii,
      );
    case 'stopping':
      return lines(
        'Stopping',
        'warn',
        [row(`run ${safe(state.runId, ascii, 40)}`), row('waiting for it to end...', 'dim')],
        'please wait',
        width,
        ascii,
      );
  }
}
