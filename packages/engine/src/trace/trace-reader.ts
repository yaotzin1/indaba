import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { isRunId, parseRecord, type RunRecord } from './records.js';

export type RunStatus = 'running' | 'completed' | 'failed' | 'escalated' | 'cancelled' | 'unknown';

export interface RunSummary {
  readonly runId: string;
  readonly startedAt: string | undefined;
  readonly status: RunStatus;
}

export interface TraceReaderOptions {
  /** How often `follow` looks for new lines. */
  readonly pollMs?: number;
  /** Replaces the wait between polls; resolves early when the signal aborts. Tests inject one. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const DEFAULT_POLL_MS = 100;
const WORKFLOW_STATUS = 'indaba.workflow.status';
const STATUS_OF: Readonly<Record<string, RunStatus>> = {
  COMPLETED: 'completed',
  FAILED: 'failed',
  ESCALATED: 'escalated',
  CANCELLED: 'cancelled',
};

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Where a run stands, from its records. A run is over when its root span has ended. */
export function summariseRun(records: readonly RunRecord[]): {
  startedAt: string | undefined;
  status: RunStatus;
} {
  const roots = new Set<string>();
  let startedAt: string | undefined;
  let status: RunStatus = 'running';
  for (const record of records) {
    if (record.type === 'span_started' && record.parentSpanId === undefined) {
      roots.add(record.spanId);
      startedAt ??= record.at;
    }
    if (record.type === 'span_ended' && roots.has(record.spanId)) {
      const named = record.attributes[WORKFLOW_STATUS];
      status = typeof named === 'string' ? (STATUS_OF[named] ?? 'unknown') : 'unknown';
    }
  }
  return { startedAt, status };
}

/**
 * Records from a trace file written before the event stream existed: its lines are spans that have ended, so each
 * becomes a start and an end. There are no step states and no output in such a run.
 */
function recordsFromTrace(text: string): RunRecord[] {
  const out: RunRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    let span: unknown;
    try {
      span = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof span !== 'object' || span === null) {
      continue;
    }
    const s = span as Record<string, unknown>;
    if (typeof s.trace_id !== 'string' || typeof s.span_id !== 'string' || typeof s.name !== 'string') {
      continue;
    }
    const start = typeof s.start === 'string' ? s.start : '';
    const end = typeof s.end === 'string' ? s.end : start;
    const started = parseRecord(
      JSON.stringify({
        type: 'span_started',
        at: start,
        trace_id: s.trace_id,
        span_id: s.span_id,
        parent_span_id: s.parent_span_id,
        name: s.name,
        attributes: s.attributes,
      }),
    );
    const ended = parseRecord(
      JSON.stringify({
        type: 'span_ended',
        at: end,
        trace_id: s.trace_id,
        span_id: s.span_id,
        status: s.status,
        status_message: s.status_message,
        attributes: s.attributes,
        events: s.events,
      }),
    );
    out.push(started, ended);
  }
  return out;
}

/**
 * Reads a run's files into records. No UI imports: the plain command, the terminal UI and the future web app all
 * read through it. A line that is not a record becomes an `unknown` record; a half-written last line waits.
 */
export class TraceReader {
  private readonly pollMs: number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(
    private readonly directory: string,
    options: TraceReaderOptions = {},
  ) {
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.sleep = options.sleep ?? defaultSleep;
  }

  private eventsFile(runId: string): string {
    return join(this.directory, `${runId}.events.jsonl`);
  }

  private traceFile(runId: string): string {
    return join(this.directory, `${runId}.jsonl`);
  }

  private check(runId: string): void {
    if (!isRunId(runId)) {
      throw new RangeError('A run id is lowercase hexadecimal.');
    }
  }

  /** Everything written so far. A run with no event file is read from its trace file, if it has one. */
  async readAll(runId: string): Promise<RunRecord[]> {
    this.check(runId);
    try {
      return completeLines(await readFile(this.eventsFile(runId), 'utf8')).map(parseRecord);
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
    try {
      return recordsFromTrace(await readFile(this.traceFile(runId), 'utf8'));
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
      return [];
    }
  }

  /**
   * Records as they are written, from the first one, until the run's root span ends or the signal aborts. A file
   * that does not exist yet is waited for.
   */
  async *follow(runId: string, signal?: AbortSignal): AsyncGenerator<RunRecord> {
    this.check(runId);
    const file = this.eventsFile(runId);
    const decoder = new StringDecoder('utf8');
    const roots = new Set<string>();
    let offset = 0;
    let tail = '';

    while (signal?.aborted !== true) {
      const size = await sizeOf(file);
      if (size !== undefined && size < offset) {
        offset = 0; // the file was replaced by a shorter one: start over
        tail = '';
      }
      if (size !== undefined && size > offset) {
        const chunk = await readRange(file, offset, size);
        offset = size;
        const lines = (tail + decoder.write(chunk)).split('\n');
        tail = lines.pop() ?? '';
        for (const line of lines) {
          if (line === '') {
            continue;
          }
          const record = parseRecord(line);
          yield record;
          if (record.type === 'span_started' && record.parentSpanId === undefined) {
            roots.add(record.spanId);
          }
          if (record.type === 'span_ended' && roots.has(record.spanId)) {
            return;
          }
        }
        continue; // more may have arrived while this was read
      }
      await this.sleep(this.pollMs, signal);
    }
  }

  /** The runs in the directory, newest first. A run is whatever has a trace file or an event file. */
  async listRuns(): Promise<RunSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }
      throw error;
    }
    const ids = new Set<string>();
    for (const name of names) {
      const match = name.match(/^([0-9a-f]{1,64})(?:\.events)?\.jsonl$/);
      if (match?.[1] !== undefined) {
        ids.add(match[1]);
      }
    }

    const runs: { summary: RunSummary; time: number }[] = [];
    for (const runId of ids) {
      let records: RunRecord[];
      try {
        records = await this.readAll(runId);
      } catch {
        continue; // something named like a run that cannot be read (a folder, no permission) is not a run
      }
      const { startedAt, status } = summariseRun(records);
      const time = (await modified(this.eventsFile(runId))) ?? (await modified(this.traceFile(runId))) ?? 0;
      runs.push({ summary: { runId, startedAt, status }, time });
    }
    return runs
      .sort((a, b) => b.time - a.time || a.summary.runId.localeCompare(b.summary.runId))
      .map((r) => r.summary);
  }
}

/** The lines that are complete: a last line with no newline after it is still being written. */
function completeLines(text: string): string[] {
  const lines = text.split('\n');
  lines.pop();
  return lines.filter((line) => line !== '');
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function sizeOf(file: string): Promise<number | undefined> {
  try {
    return (await stat(file)).size;
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

async function modified(file: string): Promise<number | undefined> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return undefined;
  }
}

async function readRange(file: string, from: number, to: number): Promise<Buffer> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(to - from);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
