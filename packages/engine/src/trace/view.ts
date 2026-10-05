import type { RunRecord, SpanEndedRecord, SpanStartedRecord } from './records.js';
import type { RunStatus } from './trace-reader.js';

/**
 * What a run looks like at one moment, built by feeding it records one at a time. Pure: the same records in
 * the same order always give the same state, and no record, however odd, makes it throw. The plain run view and
 * the terminal UI both render this and nothing else.
 */

/** Lines of output kept per step; older ones are dropped. */
export const MAX_OUTPUT_LINES = 500;
/** Longest line kept; the rest is cut. */
export const MAX_LINE_CHARS = 2000;
/** Records the view could not understand that are kept for display. */
export const MAX_NOTES = 20;

export interface RunnerView {
  readonly spanId: string;
  readonly name: string;
  /** `invoke_agent` for an agent, `execute_tool` for a shell command. */
  readonly operation: string;
  readonly status: 'running' | 'ok' | 'error';
  readonly startedAt: string;
  readonly endedAt: string | undefined;
  readonly exitCode: number | undefined;
  readonly model: string | undefined;
  /** What the runner or the pricing table gave. Undefined means unknown, never zero. */
  readonly costUsd: number | undefined;
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
}

export interface SkippedRunnerView {
  readonly runner: string;
  readonly reason: string;
}

export interface StepView {
  readonly id: string;
  /** The state the step last moved to, as the engine names it (`PENDING`, `RUNNING`, ...). */
  readonly status: string;
  /** How many times it entered `RUNNING`. */
  readonly attempts: number;
  /** Why it last moved, when the engine said (a failure, an escalation). Cleared when it runs again. */
  readonly reason: string | undefined;
  readonly startedAt: string | undefined;
  readonly endedAt: string | undefined;
  readonly runners: readonly RunnerView[];
  readonly skipped: readonly SkippedRunnerView[];
  /** Finished tool calls of an ACP agent, by kind. */
  readonly toolCalls: Readonly<Record<string, number>>;
  readonly permissions: { readonly allowed: number; readonly rejected: number };
  readonly consensus: { readonly outcome: string; readonly rounds: number } | undefined;
  /** Complete lines, oldest first, at most {@link MAX_OUTPUT_LINES}. */
  readonly output: readonly string[];
  /** The line being written, with no newline yet. */
  readonly partialLine: string;
  /** Output stopped being stored for the run (the allowance ran out). */
  readonly outputTruncated: boolean;
}

export interface RunState {
  readonly traceId: string | undefined;
  readonly taskId: string | undefined;
  readonly workflow: string | undefined;
  readonly status: RunStatus;
  readonly startedAt: string | undefined;
  readonly endedAt: string | undefined;
  /** The time of the latest record, for the elapsed time of a run that has not ended. */
  readonly lastAt: string | undefined;
  readonly steps: readonly StepView[];
  /** What the agent runs cost, where known. */
  readonly cost: { readonly usd: number; readonly unknown: number };
  /** Lines the view could not make sense of, newest last. */
  readonly notes: readonly string[];
  /** span id to what it belongs to; internal to the reducer. */
  readonly owners: Readonly<Record<string, SpanOwner>>;
}

interface SpanOwner {
  readonly kind: 'root' | 'step' | 'runner' | 'other';
  readonly stepId: string | undefined;
}

export function emptyRun(): RunState {
  return {
    traceId: undefined,
    taskId: undefined,
    workflow: undefined,
    status: 'running',
    startedAt: undefined,
    endedAt: undefined,
    lastAt: undefined,
    steps: [],
    cost: { usd: 0, unknown: 0 },
    notes: [],
    owners: {},
  };
}

const WORKFLOW_STATUS = 'indaba.workflow.status';
const STATUS_OF: Readonly<Record<string, RunStatus>> = {
  COMPLETED: 'completed',
  FAILED: 'failed',
  ESCALATED: 'escalated',
  CANCELLED: 'cancelled',
};

function newStep(id: string): StepView {
  return {
    id,
    status: 'PENDING',
    attempts: 0,
    reason: undefined,
    startedAt: undefined,
    endedAt: undefined,
    runners: [],
    skipped: [],
    toolCalls: {},
    permissions: { allowed: 0, rejected: 0 },
    consensus: undefined,
    output: [],
    partialLine: '',
    outputTruncated: false,
  };
}

function withStep(state: RunState, id: string, change: (step: StepView) => StepView): RunState {
  const found = state.steps.some((s) => s.id === id);
  const steps = found
    ? state.steps.map((s) => (s.id === id ? change(s) : s))
    : [...state.steps, change(newStep(id))];
  return { ...state, steps };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function note(state: RunState, message: string): RunState {
  const cut = message.length > 200 ? `${message.slice(0, 200)}...` : message;
  return { ...state, notes: [...state.notes, cut].slice(-MAX_NOTES) };
}

function startedSpan(state: RunState, record: SpanStartedRecord): RunState {
  const base: RunState = { ...state, lastAt: record.at };

  if (record.parentSpanId === undefined) {
    const named =
      text(record.attributes['indaba.workflow.name']) ?? record.name.replace(/^indaba\.task\s+/, '');
    return {
      ...base,
      traceId: record.traceId,
      taskId: text(record.attributes['indaba.task.id']),
      workflow: named,
      startedAt: record.at,
      status: 'running',
      owners: { ...base.owners, [record.spanId]: { kind: 'root', stepId: undefined } },
    };
  }

  if (record.name.startsWith('step ')) {
    const id = record.name.slice('step '.length);
    return withStep(
      { ...base, owners: { ...base.owners, [record.spanId]: { kind: 'step', stepId: id } } },
      id,
      (step) => ({ ...step, startedAt: step.startedAt ?? record.at }),
    );
  }

  const parent = base.owners[record.parentSpanId];
  if (parent?.kind === 'step' && parent.stepId !== undefined) {
    const space = record.name.indexOf(' ');
    const operation = space < 0 ? record.name : record.name.slice(0, space);
    const named =
      text(record.attributes['indaba.runner']) ?? (space < 0 ? record.name : record.name.slice(space + 1));
    const runner: RunnerView = {
      spanId: record.spanId,
      name: named,
      operation,
      status: 'running',
      startedAt: record.at,
      endedAt: undefined,
      exitCode: undefined,
      model: undefined,
      costUsd: undefined,
      inputTokens: undefined,
      outputTokens: undefined,
    };
    const stepId = parent.stepId;
    return withStep(
      { ...base, owners: { ...base.owners, [record.spanId]: { kind: 'runner', stepId } } },
      stepId,
      (step) => ({ ...step, runners: [...step.runners, runner] }),
    );
  }

  return { ...base, owners: { ...base.owners, [record.spanId]: { kind: 'other', stepId: parent?.stepId } } };
}

function countEvents(events: SpanEndedRecord['events']): {
  toolCalls: Record<string, number>;
  allowed: number;
  rejected: number;
} {
  const toolCalls: Record<string, number> = {};
  let allowed = 0;
  let rejected = 0;
  for (const event of events) {
    const a = event.attributes;
    if (event.name === 'indaba.acp.tool_call') {
      const status = text(a['acp.tool.status']);
      if (status === 'completed' || status === 'failed') {
        const kind = text(a['acp.tool.kind']) ?? 'other';
        toolCalls[kind] = (toolCalls[kind] ?? 0) + 1;
      }
    }
    if (event.name === 'indaba.acp.permission') {
      if (text(a['acp.permission.decision']) === 'allowed') {
        allowed += 1;
      } else {
        rejected += 1;
      }
    }
  }
  return { toolCalls, allowed, rejected };
}

function endedSpan(state: RunState, record: SpanEndedRecord): RunState {
  const base: RunState = { ...state, lastAt: record.at };
  const owner = base.owners[record.spanId];
  const attributes = record.attributes;

  if (owner?.kind === 'root') {
    const named = text(attributes[WORKFLOW_STATUS]);
    return {
      ...base,
      endedAt: record.at,
      status: named === undefined ? 'unknown' : (STATUS_OF[named] ?? 'unknown'),
    };
  }

  if (owner?.kind === 'step' && owner.stepId !== undefined) {
    const outcome = text(attributes['indaba.consensus.outcome']);
    const rounds = number(attributes['indaba.consensus.rounds']);
    const skipped = record.events
      .filter((e) => e.name === 'indaba.runner.skipped')
      .map((e) => ({
        runner: text(e.attributes['indaba.runner']) ?? '?',
        reason: text(e.attributes['indaba.runner.skip_reason']) ?? '',
      }));
    return withStep(base, owner.stepId, (step) => ({
      ...step,
      endedAt: record.at,
      skipped: [...step.skipped, ...skipped],
      consensus: outcome === undefined ? step.consensus : { outcome, rounds: rounds ?? 0 },
    }));
  }

  if (owner?.kind === 'runner' && owner.stepId !== undefined) {
    const cost = number(attributes['indaba.cost.usd']);
    const counted = countEvents(record.events);
    const exit = number(attributes['indaba.exit_code']);
    const stepId = owner.stepId;
    const operation = base.steps
      .find((s) => s.id === stepId)
      ?.runners.find((r) => r.spanId === record.spanId)?.operation;
    // A shell command costs nothing worth reporting; an agent whose cost is not known counts as unknown.
    const priced = operation === 'execute_tool' ? undefined : cost;
    const unknownAdded = operation === 'execute_tool' || cost !== undefined ? 0 : 1;
    const withRunner = withStep(base, stepId, (step) => ({
      ...step,
      runners: step.runners.map((r) =>
        r.spanId === record.spanId
          ? {
              ...r,
              status: record.status === 'error' ? 'error' : 'ok',
              endedAt: record.at,
              exitCode: exit,
              model: text(attributes['gen_ai.request.model']),
              costUsd: cost,
              inputTokens: number(attributes['gen_ai.usage.input_tokens']),
              outputTokens: number(attributes['gen_ai.usage.output_tokens']),
            }
          : r,
      ),
      toolCalls: mergeCounts(step.toolCalls, counted.toolCalls),
      permissions: {
        allowed: step.permissions.allowed + counted.allowed,
        rejected: step.permissions.rejected + counted.rejected,
      },
    }));
    return {
      ...withRunner,
      cost: { usd: withRunner.cost.usd + (priced ?? 0), unknown: withRunner.cost.unknown + unknownAdded },
    };
  }

  return base;
}

function mergeCounts(
  current: Readonly<Record<string, number>>,
  added: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const out: Record<string, number> = { ...current };
  for (const [kind, n] of Object.entries(added)) {
    out[kind] = (out[kind] ?? 0) + n;
  }
  return out;
}

function appendOutput(step: StepView, chunk: string): StepView {
  const parts = (step.partialLine + chunk).split('\n');
  const partial = parts.pop() ?? '';
  const complete = parts.map((line) => (line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line));
  const output = complete.length === 0 ? step.output : [...step.output, ...complete].slice(-MAX_OUTPUT_LINES);
  return {
    ...step,
    output,
    partialLine: partial.length > MAX_LINE_CHARS ? partial.slice(0, MAX_LINE_CHARS) : partial,
  };
}

/** The next state after one more record. Never throws. */
export function reduceRun(state: RunState, record: RunRecord): RunState {
  switch (record.type) {
    case 'span_started':
      return startedSpan(state, record);
    case 'span_ended':
      return endedSpan(state, record);
    case 'step_status':
      return withStep({ ...state, lastAt: record.at }, record.stepId, (step) => ({
        ...step,
        status: record.to,
        attempts: record.to === 'RUNNING' ? step.attempts + 1 : step.attempts,
        reason: record.to === 'RUNNING' ? undefined : (record.reason ?? step.reason),
      }));
    case 'output': {
      const owner = state.owners[record.spanId];
      if (owner?.stepId === undefined) {
        return { ...state, lastAt: record.at };
      }
      return withStep({ ...state, lastAt: record.at }, owner.stepId, (step) =>
        appendOutput(step, record.text),
      );
    }
    case 'truncated': {
      const owner = state.owners[record.spanId];
      const marked: RunState = { ...state, lastAt: record.at };
      return owner?.stepId === undefined
        ? marked
        : withStep(marked, owner.stepId, (step) => ({ ...step, outputTruncated: true }));
    }
    case 'unknown':
      return note(state, record.text);
  }
}

/** The state after a whole list of records. */
export function reduceAll(records: readonly RunRecord[]): RunState {
  return records.reduce(reduceRun, emptyRun());
}
