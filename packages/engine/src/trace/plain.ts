import { sanitize } from './sanitize.js';
import type { RunStatus } from './trace-reader.js';
import type { RunnerView, RunState, StepView } from './view.js';

export interface PlainOptions {
  /** Wrap states in ANSI colour. Colour is never the only carrier of a state: every one also has a glyph and a word. */
  readonly color?: boolean;
  /** ASCII glyphs only, for a terminal that cannot draw the others. */
  readonly ascii?: boolean;
  /** How many of the last output lines of each running or failed step to show. */
  readonly outputLines?: number;
  /** Show output for every step, not only those running or not completed. */
  readonly allOutput?: boolean;
}

interface Look {
  readonly glyph: string;
  readonly ascii: string;
  readonly word: string;
  /** SGR colour code. */
  readonly color: number;
}

const LOOK: Readonly<Record<string, Look>> = {
  PENDING: { glyph: '·', ascii: '.', word: 'pending', color: 90 },
  RUNNING: { glyph: '▶', ascii: '>', word: 'running', color: 36 },
  VALIDATING: { glyph: '◆', ascii: '?', word: 'validating', color: 33 },
  COMPLETED: { glyph: '✔', ascii: '+', word: 'completed', color: 32 },
  FAILED: { glyph: '✖', ascii: 'x', word: 'failed', color: 31 },
  ESCALATED: { glyph: '▲', ascii: '!', word: 'escalated', color: 35 },
  CANCELLED: { glyph: '■', ascii: '-', word: 'cancelled', color: 33 },
};

const RUN_LOOK: Readonly<Record<RunStatus, Look>> = {
  running: { glyph: '▶', ascii: '>', word: 'running', color: 36 },
  completed: { glyph: '✔', ascii: '+', word: 'completed', color: 32 },
  failed: { glyph: '✖', ascii: 'x', word: 'failed', color: 31 },
  escalated: { glyph: '▲', ascii: '!', word: 'escalated', color: 35 },
  cancelled: { glyph: '■', ascii: '-', word: 'cancelled', color: 33 },
  unknown: { glyph: '?', ascii: '?', word: 'ended without a final state', color: 33 },
};

const UNKNOWN_STEP: Look = { glyph: '?', ascii: '?', word: 'unknown', color: 90 };

/** 12s, 2m03s, 1h02m; a dash when there is nothing to measure. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return '-';
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
  }
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * A cost is never shown as zero when it is not known: no agent cost at all is `none`, only unknown costs are
 * `unknown`, and a total that includes an unknown is marked partial.
 */
export function formatCost(cost: RunState['cost']): string {
  const money = `$${cost.usd.toFixed(4)}`;
  if (cost.unknown === 0) {
    return cost.usd === 0 ? 'none' : money;
  }
  return cost.usd === 0 ? 'unknown' : `${money} + ${cost.unknown} unknown`;
}

function elapsed(state: RunState): number | undefined {
  const from = state.startedAt === undefined ? undefined : Date.parse(state.startedAt);
  const toText = state.endedAt ?? state.lastAt;
  const to = toText === undefined ? undefined : Date.parse(toText);
  return from === undefined || to === undefined || Number.isNaN(from) || Number.isNaN(to)
    ? undefined
    : to - from;
}

/** Text from an agent or a command, safe to put on a terminal and on one line. */
function oneLine(value: string): string {
  return sanitize(value).replaceAll('\n', ' ').trim();
}

function mark(look: Look, options: PlainOptions): { glyph: string; word: string } {
  const glyph = options.ascii === true ? look.ascii : look.glyph;
  if (options.color !== true) {
    return { glyph, word: look.word };
  }
  const paint = (text: string): string => `\u001b[${look.color}m${text}\u001b[0m`;
  return { glyph: paint(glyph), word: paint(look.word) };
}

function runnerText(runner: RunnerView): string {
  const took =
    runner.endedAt === undefined
      ? ''
      : ` ${formatDuration(Date.parse(runner.endedAt) - Date.parse(runner.startedAt))}`;
  const state = runner.status === 'running' ? 'running' : runner.status === 'ok' ? 'ok' : 'error';
  const cost = runner.costUsd === undefined ? '' : ` $${runner.costUsd.toFixed(4)}`;
  return `${oneLine(runner.name)} ${state}${took}${cost}`;
}

function toolsText(step: StepView): string | undefined {
  const calls = Object.entries(step.toolCalls)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, n]) => `${oneLine(kind)} ${n}`);
  const { allowed, rejected } = step.permissions;
  const parts: string[] = [];
  if (calls.length > 0) {
    parts.push(`tools: ${calls.join(', ')}`);
  }
  if (allowed + rejected > 0) {
    parts.push(`permissions: ${allowed} allowed, ${rejected} rejected`);
  }
  return parts.length === 0 ? undefined : parts.join(' | ');
}

function stepLines(step: StepView, options: PlainOptions, idWidth: number): string[] {
  const { glyph, word } = mark(LOOK[step.status] ?? UNKNOWN_STEP, options);
  const attempts = step.attempts > 1 ? `  attempt ${step.attempts}` : '';
  const lines = [`  ${glyph} ${oneLine(step.id).padEnd(idWidth)}  ${word}${attempts}`];
  const pad = '      ';

  if (step.runners.length > 0) {
    lines.push(`${pad}runners: ${step.runners.map(runnerText).join(' -> ')}`);
  }
  for (const skipped of step.skipped) {
    const why = oneLine(skipped.reason);
    lines.push(`${pad}skipped: ${oneLine(skipped.runner)}${why === '' ? '' : ` (${why})`}`);
  }
  const tools = toolsText(step);
  if (tools !== undefined) {
    lines.push(`${pad}${tools}`);
  }
  if (step.consensus !== undefined) {
    lines.push(`${pad}consensus: ${oneLine(step.consensus.outcome)} after ${step.consensus.rounds} round(s)`);
  }
  if (step.reason !== undefined && step.reason !== '') {
    for (const line of sanitize(step.reason).split('\n').slice(0, 3)) {
      lines.push(`${pad}reason: ${line}`);
    }
  }

  const wanted = options.outputLines ?? 4;
  const showOutput = options.allOutput === true || (step.status !== 'COMPLETED' && step.status !== 'PENDING');
  if (showOutput && wanted > 0) {
    const tail = [...step.output, ...(step.partialLine === '' ? [] : [step.partialLine])].slice(-wanted);
    for (const line of tail) {
      lines.push(`${pad}| ${sanitize(line)}`);
    }
    if (step.outputTruncated) {
      lines.push(`${pad}| (output stored for this run ran out; the rest is not shown)`);
    }
  }
  return lines;
}

/** The whole run as plain lines, for a terminal that is not a screen, for a pipe and for a screen reader. */
export function formatPlain(state: RunState, options: PlainOptions = {}): string {
  const { glyph, word } = mark(RUN_LOOK[state.status], options);
  const name = state.workflow === undefined ? 'run' : oneLine(state.workflow);
  const header = [
    `indaba ${name}`,
    `${glyph} ${word}`,
    `${state.steps.length} step${state.steps.length === 1 ? '' : 's'}`,
    `elapsed ${formatDuration(elapsed(state))}`,
    `cost ${formatCost(state.cost)}`,
  ].join(' | ');

  const idWidth = state.steps.reduce((width, step) => Math.max(width, oneLine(step.id).length), 0);
  const lines = [header, ...state.steps.flatMap((step) => stepLines(step, options, idWidth))];
  for (const text of state.notes) {
    lines.push(`  note: ${oneLine(text)}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The exit status of `watch --plain`: it mirrors the run. 0 completed, 1 failed, 2 escalated, 130 cancelled, and
 * 3 when the files ended without a final state (the run is still going, or it died).
 */
export function watchExitCode(status: RunStatus): number {
  switch (status) {
    case 'completed':
      return 0;
    case 'failed':
      return 1;
    case 'escalated':
      return 2;
    case 'cancelled':
      return 130;
    default:
      return 3;
  }
}
