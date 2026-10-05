import type { SpanAttributes, SpanAttributeValue } from '@indaba/core';

/**
 * What a run writes to `<traceId>.events.jsonl`, one JSON object per line. The wire names are snake_case, as
 * in the trace file; these types are camelCase. Anything that does not parse becomes an `unknown` record, so a
 * reader never fails on a file.
 */
export const RUN_ID = /^[0-9a-f]{1,64}$/;

/** A run id becomes part of a path: lowercase hexadecimal only, so it can never name another directory. */
export function isRunId(value: string): boolean {
  return RUN_ID.test(value);
}

interface Base {
  readonly at: string;
  readonly traceId: string;
}

export interface SpanStartedRecord extends Base {
  readonly type: 'span_started';
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly name: string;
  readonly attributes: SpanAttributes;
}

export interface SpanEventRecord {
  readonly name: string;
  readonly attributes: SpanAttributes;
}

export interface SpanEndedRecord extends Base {
  readonly type: 'span_ended';
  readonly spanId: string;
  readonly status: string;
  readonly statusMessage: string | undefined;
  readonly attributes: SpanAttributes;
  readonly events: readonly SpanEventRecord[];
}

export interface StepStatusRecord extends Base {
  readonly type: 'step_status';
  readonly taskId: string;
  readonly stepId: string;
  readonly from: string;
  readonly to: string;
  readonly reason: string | undefined;
}

export interface OutputRecord extends Base {
  readonly type: 'output';
  readonly spanId: string;
  readonly seq: number;
  readonly text: string;
  /** The text was longer than one record may be, and was cut. */
  readonly cut: boolean;
}

/** Written once per run when the output allowance ran out; no `output` follows it. */
export interface TruncatedRecord extends Base {
  readonly type: 'truncated';
  readonly spanId: string;
}

/** A line that is not a record this reader knows. `text` is the start of the line, never more than 500 characters. */
export interface UnknownRecord {
  readonly type: 'unknown';
  readonly text: string;
}

export type RunRecord =
  | SpanStartedRecord
  | SpanEndedRecord
  | StepStatusRecord
  | OutputRecord
  | TruncatedRecord
  | UnknownRecord;

const MAX_UNKNOWN_CHARS = 500;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function attributesOf(value: unknown): SpanAttributes {
  if (!isObject(value)) {
    return {};
  }
  const out: Record<string, SpanAttributeValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      out[key] = item;
    }
  }
  return out;
}

function eventsOf(value: unknown): SpanEventRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: SpanEventRecord[] = [];
  for (const item of value as unknown[]) {
    if (isObject(item) && typeof item.name === 'string') {
      out.push({ name: item.name, attributes: attributesOf(item.attributes) });
    }
  }
  return out;
}

function unknown(line: string): UnknownRecord {
  return { type: 'unknown', text: line.length > MAX_UNKNOWN_CHARS ? line.slice(0, MAX_UNKNOWN_CHARS) : line };
}

/** Reads one line. Total: it never throws, whatever the line holds. */
export function parseRecord(line: string): RunRecord {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return unknown(line);
  }
  if (!isObject(data)) {
    return unknown(line);
  }
  const at = text(data.at);
  const traceId = text(data.trace_id);
  if (at === undefined || traceId === undefined) {
    return unknown(line);
  }

  switch (data.type) {
    case 'span_started': {
      const spanId = text(data.span_id);
      const name = text(data.name);
      if (spanId === undefined || name === undefined) {
        return unknown(line);
      }
      return {
        type: 'span_started',
        at,
        traceId,
        spanId,
        parentSpanId: text(data.parent_span_id),
        name,
        attributes: attributesOf(data.attributes),
      };
    }
    case 'span_ended': {
      const spanId = text(data.span_id);
      const status = text(data.status);
      if (spanId === undefined || status === undefined) {
        return unknown(line);
      }
      return {
        type: 'span_ended',
        at,
        traceId,
        spanId,
        status,
        statusMessage: text(data.status_message),
        attributes: attributesOf(data.attributes),
        events: eventsOf(data.events),
      };
    }
    case 'step_status': {
      const taskId = text(data.task_id);
      const stepId = text(data.step_id);
      const from = text(data.from);
      const to = text(data.to);
      if (taskId === undefined || stepId === undefined || from === undefined || to === undefined) {
        return unknown(line);
      }
      return { type: 'step_status', at, traceId, taskId, stepId, from, to, reason: text(data.reason) };
    }
    case 'output': {
      const spanId = text(data.span_id);
      const body = text(data.text);
      const seq = data.seq;
      if (
        spanId === undefined ||
        body === undefined ||
        typeof seq !== 'number' ||
        !Number.isInteger(seq) ||
        seq < 0
      ) {
        return unknown(line);
      }
      return { type: 'output', at, traceId, spanId, seq, text: body, cut: data.cut === true };
    }
    case 'truncated': {
      const spanId = text(data.span_id);
      return spanId === undefined ? unknown(line) : { type: 'truncated', at, traceId, spanId };
    }
    default:
      return unknown(line);
  }
}

/** One line for a record, without the newline. An `unknown` record is not meant to be written. */
export function serializeRecord(record: Exclude<RunRecord, UnknownRecord>): string {
  switch (record.type) {
    case 'span_started':
      return JSON.stringify({
        type: record.type,
        at: record.at,
        trace_id: record.traceId,
        span_id: record.spanId,
        parent_span_id: record.parentSpanId ?? null,
        name: record.name,
        attributes: record.attributes,
      });
    case 'span_ended':
      return JSON.stringify({
        type: record.type,
        at: record.at,
        trace_id: record.traceId,
        span_id: record.spanId,
        status: record.status,
        status_message: record.statusMessage ?? null,
        attributes: record.attributes,
        events: record.events,
      });
    case 'step_status':
      return JSON.stringify({
        type: record.type,
        at: record.at,
        trace_id: record.traceId,
        task_id: record.taskId,
        step_id: record.stepId,
        from: record.from,
        to: record.to,
        ...(record.reason === undefined ? {} : { reason: record.reason }),
      });
    case 'output':
      return JSON.stringify({
        type: record.type,
        at: record.at,
        trace_id: record.traceId,
        span_id: record.spanId,
        seq: record.seq,
        text: record.text,
        ...(record.cut ? { cut: true } : {}),
      });
    case 'truncated':
      return JSON.stringify({
        type: record.type,
        at: record.at,
        trace_id: record.traceId,
        span_id: record.spanId,
      });
  }
}
