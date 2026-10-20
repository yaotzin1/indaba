import type { ApiError, ContractResponse, RunSnapshot, RunSummary, ServerStreamEvent } from '@indaba/core';
import { SseParser } from './sse.js';

/** The contract major this page speaks (`specs/web-app/api-surface.md`). A server with a newer one is refused. */
export const CONTRACT_MAJOR = 1;

export const API = '/api/v1';

/** What went wrong, in the terms the page shows: each kind has one screen and one next action. */
export type Failure =
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'newer_contract' }
  | { readonly kind: 'not_found'; readonly message: string }
  | { readonly kind: 'server'; readonly message: string };

export class ApiFailure extends Error {
  constructor(readonly failure: Failure) {
    super(failure.kind);
    this.name = 'ApiFailure';
  }
}

/** The state of a stream, for the badge in the header and the banner of a dropped connection. */
export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'ended';

export interface StreamHandlers<T> {
  onEvent(event: T): void;
  onState(state: StreamState): void;
  /** A failure retrying cannot fix (the token, a missing run); the stream stops. */
  onFailure(failure: Failure): void;
}

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export interface ClientOptions {
  readonly token: string;
  readonly fetch: typeof fetch;
  /** Waits between reconnects; tests replace it. */
  readonly sleep?: Sleep;
  /** The first wait after a drop; doubled up to {@link MAX_RETRY_MS}. Default 500. */
  readonly retryMs?: number;
}

export const MAX_RETRY_MS = 5000;

export interface Client {
  contract(): Promise<ContractResponse>;
  runs(): Promise<readonly RunSummary[]>;
  run(id: string): Promise<RunSnapshot>;
  /** Follows one run until it ends or `signal` aborts, resuming after a drop with the last event id. */
  followRun(id: string, handlers: StreamHandlers<RunSnapshot>, signal: AbortSignal): Promise<void>;
  /** Follows the server-wide stream: a run started or ended. */
  followServer(handlers: StreamHandlers<ServerStreamEvent>, signal: AbortSignal): Promise<void>;
  /** The output of a step as the server keeps it, as plain text. */
  stepLog(runId: string, stepId: string): Promise<string>;
}

const defaultSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isApiError(value: unknown): value is ApiError {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';
}

/** Whether a value has the shape of a run snapshot well enough to render; the server built it, but it crossed a wire. */
export function isRunSnapshot(value: unknown): value is RunSnapshot {
  return (
    isRecord(value) &&
    typeof value.status === 'string' &&
    Array.isArray(value.steps) &&
    Array.isArray(value.notes) &&
    isRecord(value.cost)
  );
}

function isRunSummary(value: unknown): value is RunSummary {
  return isRecord(value) && typeof value.runId === 'string' && typeof value.status === 'string';
}

/** The major of a version such as `1.2.0`; NaN when it has none. */
export function majorOf(version: string): number {
  return Number.parseInt(version.split('.')[0] ?? '', 10);
}

async function failureOf(response: Response): Promise<Failure> {
  if (response.status === 401) {
    return { kind: 'unauthorized' };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const message = isApiError(body) ? body.message : `The server answered ${response.status}.`;
  return response.status === 404 ? { kind: 'not_found', message } : { kind: 'server', message };
}

export function createClient(options: ClientOptions): Client {
  const sleep = options.sleep ?? defaultSleep;
  const firstRetry = options.retryMs ?? 500;
  const headers = (extra: Readonly<Record<string, string>> = {}): Record<string, string> => ({
    Authorization: `Bearer ${options.token}`,
    ...extra,
  });

  const request = async (path: string, signal?: AbortSignal): Promise<Response> => {
    let response: Response;
    try {
      response = await options.fetch(`${API}${path}`, { headers: headers(), ...(signal ? { signal } : {}) });
    } catch {
      throw new ApiFailure({ kind: 'unreachable' });
    }
    if (!response.ok) {
      throw new ApiFailure(await failureOf(response));
    }
    return response;
  };

  const json = async (path: string): Promise<unknown> => {
    const response = await request(path);
    try {
      return await response.json();
    } catch {
      throw new ApiFailure({ kind: 'server', message: 'The server sent something this page cannot read.' });
    }
  };

  /** One stream, reconnecting after a drop until it ends, fails for good or is aborted. */
  const follow = async <T>(
    path: string,
    read: (event: string, data: unknown) => T | undefined,
    resume: boolean,
    handlers: StreamHandlers<T>,
    signal: AbortSignal,
  ): Promise<void> => {
    let lastId = 0;
    let wait = firstRetry;
    let first = true;
    while (!signal.aborted) {
      handlers.onState(first ? 'connecting' : 'reconnecting');
      first = false;
      let response: Response | undefined;
      try {
        response = await options.fetch(`${API}${path}`, {
          headers: headers(resume && lastId > 0 ? { 'Last-Event-ID': String(lastId) } : {}),
          signal,
        });
      } catch {
        response = undefined;
      }
      if (signal.aborted) {
        return;
      }
      if (response !== undefined && (response.status === 401 || response.status === 404)) {
        handlers.onFailure(await failureOf(response));
        return;
      }
      if (response?.ok === true && response.body !== null) {
        handlers.onState('live');
        wait = firstRetry;
        const parser = new SseParser();
        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }
            for (const event of parser.push(decoder.decode(value, { stream: true }))) {
              if (event.event === 'end') {
                handlers.onState('ended');
                return;
              }
              let data: unknown;
              try {
                data = JSON.parse(event.data);
              } catch {
                continue;
              }
              const item = read(event.event, data);
              if (item !== undefined) {
                lastId = event.id ?? lastId;
                handlers.onEvent(item);
              }
            }
          }
        } catch {
          // The connection dropped mid-stream: reconnect below.
        }
      }
      if (signal.aborted) {
        return;
      }
      handlers.onState('reconnecting');
      await sleep(wait, signal);
      wait = Math.min(wait * 2, MAX_RETRY_MS);
    }
  };

  return {
    async contract() {
      const body = await json('/contract');
      if (!isRecord(body) || typeof body.contractVersion !== 'string') {
        throw new ApiFailure({ kind: 'server', message: 'The server did not say which contract it speaks.' });
      }
      if (majorOf(body.contractVersion) > CONTRACT_MAJOR) {
        throw new ApiFailure({ kind: 'newer_contract' });
      }
      return { contractVersion: body.contractVersion };
    },

    async runs() {
      const body = await json('/runs');
      const list: unknown = isRecord(body) ? body.runs : undefined;
      const items: readonly unknown[] = Array.isArray(list) ? list : [];
      return items.filter(isRunSummary);
    },

    async run(id) {
      const body = await json(`/runs/${encodeURIComponent(id)}`);
      const run: unknown = isRecord(body) ? body.run : undefined;
      if (!isRunSnapshot(run)) {
        throw new ApiFailure({ kind: 'server', message: 'The server sent a run this page cannot read.' });
      }
      return run;
    },

    followRun(id, handlers, signal) {
      return follow<RunSnapshot>(
        `/runs/${encodeURIComponent(id)}/events`,
        (event, data) => {
          const run: unknown = event === 'snapshot' && isRecord(data) ? data.run : undefined;
          return isRunSnapshot(run) ? run : undefined;
        },
        true,
        handlers,
        signal,
      );
    },

    followServer(handlers, signal) {
      return follow<ServerStreamEvent>(
        '/events',
        (event, data) => {
          if (event !== 'run' || !isRecord(data) || typeof data.id !== 'number' || !isRunSummary(data.run)) {
            return undefined;
          }
          const { id, kind, run } = data;
          return kind === 'run_started' || kind === 'run_ended' ? { id, kind, run } : undefined;
        },
        false,
        handlers,
        signal,
      );
    },

    async stepLog(runId, stepId) {
      const response = await request(
        `/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/log`,
      );
      return response.text();
    },
  };
}
