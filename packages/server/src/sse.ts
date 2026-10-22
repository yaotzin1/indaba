import type { ServerResponse } from 'node:http';
import type { RunStreamEvent, ServerStreamEvent } from '@indaba/core';
import { emptyRun, reduceRun, type TraceReader } from '@indaba/engine';
import { SECURITY_HEADERS } from './checks.js';
import type { RunSource } from './runs.js';
import { snapshotOf } from './runs.js';

/** Waits `ms`, or less when the signal aborts. Tests inject a replacement. */
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export const defaultSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
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

export function startEventStream(res: ServerResponse): void {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
}

function frame(res: ServerResponse, id: number, event: string, data: unknown): void {
  if (!res.writableEnded) {
    res.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

export interface RunStreamOptions {
  /** `Last-Event-ID` of the request, or 0. */
  readonly lastEventId: number;
  /** Events that arrive within this many milliseconds of one another are sent as one snapshot. */
  readonly coalesceMs: number;
}

/**
 * Follows one run and sends its state as whole snapshots. The id of an event is the number of records folded into
 * it, so it only rises; a client that resumes with the last id it saw gets the next snapshot and never a repeat of
 * one it has, and because a snapshot is the whole state a dropped event loses nothing. The stream ends when the
 * run's root span does.
 */
export async function streamRun(
  reader: TraceReader,
  runId: string,
  res: ServerResponse,
  signal: AbortSignal,
  options: RunStreamOptions,
): Promise<void> {
  startEventStream(res);
  let state = emptyRun();
  let count = 0;
  let sent = options.lastEventId;
  let timer: NodeJS.Timeout | undefined;

  const flush = (): void => {
    timer = undefined;
    if (count !== sent) {
      sent = count;
      const event: RunStreamEvent = { id: count, run: snapshotOf(state) };
      frame(res, count, 'snapshot', event);
    }
  };

  try {
    for await (const record of reader.follow(runId, signal)) {
      state = reduceRun(state, record);
      count += 1;
      timer ??= setTimeout(flush, options.coalesceMs);
    }
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
  if (!signal.aborted) {
    flush();
    res.write('event: end\ndata: {}\n\n');
    res.end();
  }
}

/**
 * Announces runs that appear or end, by looking at the runs of every root at a fixed interval. It reports changes
 * only: a client that reconnects reads the list again. Ids are per connection.
 */
export async function streamServer(
  source: RunSource,
  res: ServerResponse,
  signal: AbortSignal,
  pollMs: number,
  sleep: Sleep,
): Promise<void> {
  startEventStream(res);
  const known = new Map<string, string>();
  for (const run of await source.list()) {
    known.set(run.runId, run.status);
  }
  let id = 0;
  while (!signal.aborted) {
    await sleep(pollMs, signal);
    if (signal.aborted) {
      break;
    }
    for (const run of await source.list()) {
      const before = known.get(run.runId);
      known.set(run.runId, run.status);
      if (before === undefined) {
        id += 1;
        const started: ServerStreamEvent = { id, kind: 'run_started', run };
        frame(res, id, 'run', started);
      }
      if ((before === undefined || before === 'running') && run.status !== 'running') {
        id += 1;
        const ended: ServerStreamEvent = { id, kind: 'run_ended', run };
        frame(res, id, 'run', ended);
      }
    }
  }
}
