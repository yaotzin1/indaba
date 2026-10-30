import {
  type BoardEntry,
  BoardKind,
  type BoardRecord,
  type BoardSource,
  type SettleOutcome,
} from '@indaba/core';

/**
 * What a run writes to `<traceId>.board.jsonl`, one JSON object per line (specs/run-blackboard/data-model.md).
 * Wire names are snake_case, as in the trace and event files; the types are the core ones. A line that is not a
 * record this reader knows becomes an `unknown` record, so a reader never fails on a file.
 */
export const BOARD_FILE_SUFFIX = '.board.jsonl';

/** A line this reader does not know. `text` is the start of the line, never more than 500 characters. */
export interface UnknownBoardRecord {
  readonly type: 'unknown';
  readonly text: string;
}

export type BoardFileRecord = BoardRecord | UnknownBoardRecord;

const MAX_UNKNOWN_CHARS = 500;
/** The one format version this reader understands; a later one reinterprets fields, so its lines are not read. */
const FORMAT_VERSION = 1;

const KINDS: readonly string[] = Object.values(BoardKind);
const OUTCOMES: readonly string[] = ['accepted', 'discarded', 'superseded'];

/** One line, no newline. Optional fields are left out when absent. */
export function serializeBoardRecord(record: BoardRecord): string {
  switch (record.type) {
    case 'board':
      return JSON.stringify({
        type: 'board',
        v: record.v,
        at: record.at,
        trace_id: record.traceId,
        workflow: record.workflow,
      });
    case 'post':
      return JSON.stringify({
        type: 'post',
        seq: record.seq,
        at: record.at,
        step_id: record.stepId,
        attempt: record.attempt,
        scope: record.scope,
        source: record.source,
        sender: record.sender,
        kind: record.kind,
        ...(record.key !== undefined ? { key: record.key } : {}),
        ...(record.round !== undefined ? { round: record.round } : {}),
        text: record.text,
        cut: record.cut,
      });
    case 'settle':
      return JSON.stringify({
        type: 'settle',
        seq: record.seq,
        at: record.at,
        step_id: record.stepId,
        attempt: record.attempt,
        scope: record.scope,
        outcome: record.outcome,
        ...(record.reason !== undefined ? { reason: record.reason } : {}),
      });
    case 'truncated':
      return JSON.stringify({ type: 'truncated', seq: record.seq, at: record.at, reason: record.reason });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function whole(value: unknown, least: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= least ? value : undefined;
}

function unknown(line: string): UnknownBoardRecord {
  return { type: 'unknown', text: line.length > MAX_UNKNOWN_CHARS ? line.slice(0, MAX_UNKNOWN_CHARS) : line };
}

function isSource(value: unknown): value is BoardSource {
  return value === 'agent' || value === 'engine';
}

function isOutcome(value: unknown): value is SettleOutcome {
  return typeof value === 'string' && OUTCOMES.includes(value);
}

function isKind(value: unknown): value is BoardKind {
  return typeof value === 'string' && KINDS.includes(value);
}

/** Reads one line. Total: it never throws, whatever the line holds. */
export function parseBoardRecord(line: string): BoardFileRecord {
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
  if (at === undefined) {
    return unknown(line);
  }

  switch (data.type) {
    case 'board': {
      const traceId = text(data.trace_id);
      const workflow = text(data.workflow);
      if (data.v !== FORMAT_VERSION || traceId === undefined || workflow === undefined) {
        return unknown(line);
      }
      return { type: 'board', v: FORMAT_VERSION, at, traceId, workflow };
    }
    case 'post': {
      const seq = whole(data.seq, 1);
      const stepId = text(data.step_id);
      const attempt = whole(data.attempt, 1);
      const scope = text(data.scope);
      const sender = text(data.sender);
      const body = text(data.text);
      if (
        seq === undefined ||
        stepId === undefined ||
        attempt === undefined ||
        scope === undefined ||
        sender === undefined ||
        body === undefined ||
        !isSource(data.source) ||
        !isKind(data.kind)
      ) {
        return unknown(line);
      }
      const key = text(data.key);
      const round = whole(data.round, 1);
      const entry: BoardEntry = {
        seq,
        at,
        stepId,
        attempt,
        scope,
        source: data.source,
        sender,
        kind: data.kind,
        ...(key !== undefined ? { key } : {}),
        ...(round !== undefined ? { round } : {}),
        text: body,
        cut: data.cut === true,
      };
      return { type: 'post', ...entry };
    }
    case 'settle': {
      const seq = whole(data.seq, 1);
      const stepId = text(data.step_id);
      const attempt = whole(data.attempt, 1);
      const scope = text(data.scope);
      const reason = text(data.reason);
      if (
        seq === undefined ||
        stepId === undefined ||
        attempt === undefined ||
        scope === undefined ||
        !isOutcome(data.outcome)
      ) {
        return unknown(line);
      }
      return {
        type: 'settle',
        seq,
        at,
        stepId,
        attempt,
        scope,
        outcome: data.outcome,
        ...(reason !== undefined ? { reason } : {}),
      };
    }
    case 'truncated': {
      const seq = whole(data.seq, 1);
      if (seq === undefined || (data.reason !== 'entries' && data.reason !== 'chars')) {
        return unknown(line);
      }
      return { type: 'truncated', seq, at, reason: data.reason };
    }
    default:
      return unknown(line);
  }
}
