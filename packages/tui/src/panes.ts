import { type RunState, type StepView, sanitize, stepMark } from '@indaba/engine';
import { clip, PANE_ROWS, wrap } from './layout.js';
import type { Row, Tone } from './screen.js';

/** Rows of output a pane shows under its title. */
export const TAIL_ROWS = PANE_ROWS - 1;

/**
 * One line of cost for a step: the sum of what its agents cost, the way `runnerText` of the plain output counts it (a shell
 * command costs nothing and is left out). `cost unknown` when no agent has a price, never `$0`; a trailing `+` when only some
 * have, so the figure is not mistaken for the whole. Empty for a step that ran no agent.
 */
export function stepCost(step: StepView): string {
  const agents = step.runners.filter((r) => r.operation !== 'execute_tool');
  if (agents.length === 0) {
    return '';
  }
  const priced = agents.filter((r) => r.costUsd !== undefined);
  if (priced.length === 0) {
    return 'cost unknown';
  }
  const total = priced.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  return `$${total.toFixed(4)}${priced.length < agents.length ? '+' : ''}`;
}

/** One running step, as the block of panes shows it. */
export interface PaneSpec {
  readonly stepId: string;
  readonly glyph: string;
  readonly word: string;
  readonly tone: Tone;
  readonly title: string;
  /** The last rows of its output, cleaned and wrapped; `(no data yet)` when it has printed nothing. */
  readonly tail: readonly string[];
  readonly focused: boolean;
}

/** Ids of the steps that are running now, in the order of the run. */
export function runningIds(run: RunState): readonly string[] {
  return run.steps.filter((s) => s.status === 'RUNNING').map((s) => s.id);
}

export interface PanesInput {
  /** Rows of the block, as `Layout.paneRows` gives them (a whole number of panes). */
  readonly rows: number;
  readonly width: number;
  /** The id of the focused pane's step. */
  readonly focus: string | undefined;
  /** The first running step shown, when there are more than fit. */
  readonly offset: number;
  readonly ascii: boolean;
}

export interface Panes {
  readonly panes: readonly PaneSpec[];
  /** Running steps that are not drawn. */
  readonly hidden: number;
  readonly running: number;
}

const oneLine = (text: string): string =>
  sanitize(text)
    .replace(/[\r\n\t]+/g, ' ')
    .trim();

function tailOf(step: StepView, width: number): string[] {
  const lines = [...step.output, ...(step.partialLine === '' ? [] : [step.partialLine])];
  const wrapped = lines.flatMap((line) => wrap(sanitize(line).replaceAll('\n', ' '), width));
  const last = wrapped.slice(-TAIL_ROWS);
  return last.length === 0 ? ['(no data yet)'] : last;
}

/**
 * The panes to draw: one for each running step, from `offset`, as many as `rows` holds. A pure function of the run and the
 * size, so the same two always give the same panes and nothing in the run is changed.
 */
export function panesFor(run: RunState, input: PanesInput): Panes {
  const running = run.steps.filter((s) => s.status === 'RUNNING');
  const cap = Math.floor(Math.max(0, input.rows) / PANE_ROWS);
  const start = Math.min(Math.max(0, input.offset), Math.max(0, running.length - cap));
  const shown = running.slice(start, start + cap);
  const panes = shown.map((step): PaneSpec => {
    const { glyph, word } = stepMark(step.status, input.ascii);
    const attempt = step.attempts > 1 ? `  attempt ${step.attempts}` : '';
    const cost = stepCost(step);
    return {
      stepId: step.id,
      glyph,
      word,
      tone: 'info',
      title: clip(
        `${glyph} ${word}  ${oneLine(step.id)}${attempt}${cost === '' ? '' : `  ${cost}`}`,
        input.width,
        input.ascii,
      ),
      tail: tailOf(step, input.width),
      focused: step.id === input.focus,
    };
  });
  return { panes, hidden: running.length - shown.length, running: running.length };
}

/** The rows of the block: each pane is its title, then its tail, padded to a whole pane. */
export function paneBlockRows(found: Panes, width: number, ascii: boolean): Row[] {
  const rows: Row[] = [];
  found.panes.forEach((pane, index) => {
    const more = index === 0 && found.hidden > 0 ? `  (+${found.hidden} more: [ ])` : '';
    rows.push({ text: clip(`${pane.title}${more}`, width, ascii), tone: pane.tone, selected: pane.focused });
    for (let i = 0; i < TAIL_ROWS; i += 1) {
      const text = pane.tail[i];
      rows.push({
        text: text === undefined ? '' : clip(text, width, ascii),
        tone: text === '(no data yet)' ? 'dim' : 'normal',
        selected: false,
      });
    }
  });
  return rows;
}
