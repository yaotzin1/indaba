import type { RunSnapshot, ServerStreamEvent } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  ApiFailure,
  CONTRACT_MAJOR,
  createClient,
  type Failure,
  isRunSnapshot,
  majorOf,
  type StreamState,
} from '../src/client.js';
import { liveRun } from './fixtures.js';

const COST = { usd: 0.25, unknown: 1, calls: 3 };

// Built from parts so no file holds a string shaped like a credential (the security audit reads tests too).
const TOKEN = ['test', 'token', '0123456789'].join('-');

interface Call {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

type Reply = Response | Error | ((signal: AbortSignal | undefined) => Response);

/** A fetch that answers from a list, in order, and records what it was asked. */
function fakeFetch(replies: Reply[]): { readonly fetch: typeof fetch; readonly calls: Call[] } {
  const calls: Call[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
    const reply = replies.shift();
    if (reply === undefined || reply instanceof Error) {
      throw reply ?? new TypeError('no reply');
    }
    return typeof reply === 'function' ? reply(init?.signal ?? undefined) : reply;
  };
  return { fetch: fn as typeof fetch, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A stream response that sends these chunks, then ends (or stays open until aborted). */
function sse(chunks: readonly string[], stayOpen = false): (signal: AbortSignal | undefined) => Response {
  return (signal) => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        if (!stayOpen) {
          controller.close();
        } else {
          signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
        }
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
}

const frame = (id: number, event: string, data: unknown): string =>
  `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const noSleep = async (): Promise<void> => undefined;

function recorder<T>() {
  const events: T[] = [];
  const states: StreamState[] = [];
  const failures: Failure[] = [];
  return {
    events,
    states,
    failures,
    handlers: {
      onEvent: (e: T) => events.push(e),
      onState: (s: StreamState) => states.push(s),
      onFailure: (f: Failure) => failures.push(f),
    },
  };
}

async function failureOf(promise: Promise<unknown>): Promise<Failure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiFailure) {
      return error.failure;
    }
    throw error;
  }
  throw new Error('expected a failure');
}

describe('the client', () => {
  it('sends the token on every request, as a header', async () => {
    const { fetch, calls } = fakeFetch([json({ runs: [] })]);
    await createClient({ token: TOKEN, fetch }).runs();
    expect(calls[0]).toEqual({ url: '/api/v1/runs', headers: { Authorization: `Bearer ${TOKEN}` } });
  });

  it('accepts its own contract major and refuses a newer one', async () => {
    const ok = fakeFetch([json({ contractVersion: `${CONTRACT_MAJOR}.4.0` })]);
    await expect(createClient({ token: TOKEN, fetch: ok.fetch }).contract()).resolves.toEqual({
      contractVersion: '1.4.0',
    });
    const newer = fakeFetch([json({ contractVersion: `${CONTRACT_MAJOR + 1}.0.0` })]);
    expect(await failureOf(createClient({ token: TOKEN, fetch: newer.fetch }).contract())).toEqual({
      kind: 'newer_contract',
    });
    const silent = fakeFetch([json({})]);
    expect((await failureOf(createClient({ token: TOKEN, fetch: silent.fetch }).contract())).kind).toBe(
      'server',
    );
    expect(majorOf('2.0.1')).toBe(2);
    expect(majorOf('x')).toBeNaN();
  });

  it('names each failure the page has a screen for', async () => {
    const replies = fakeFetch([
      json({ code: 'unauthorized', message: 'no' }, 401),
      json({ code: 'run_not_found', message: 'No run has this id.' }, 404),
      json({ code: 'internal', message: 'The server could not answer.' }, 500),
      new Response('not json', { status: 502 }),
      new TypeError('connection refused'),
      new Response('not json', { status: 200 }),
    ]);
    const client = createClient({ token: TOKEN, fetch: replies.fetch });
    expect(await failureOf(client.runs())).toEqual({ kind: 'unauthorized' });
    expect(await failureOf(client.run('x'))).toEqual({ kind: 'not_found', message: 'No run has this id.' });
    expect(await failureOf(client.runs())).toEqual({
      kind: 'server',
      message: 'The server could not answer.',
    });
    expect(await failureOf(client.runs())).toEqual({ kind: 'server', message: 'The server answered 502.' });
    expect(await failureOf(client.runs())).toEqual({ kind: 'unreachable' });
    expect((await failureOf(client.runs())).kind).toBe('server');
  });

  it('keeps only the runs and the run it can read', async () => {
    const run = liveRun();
    const replies = fakeFetch([
      json({
        runs: [
          { runId: 'a', status: 'running', cost: COST },
          { nope: true },
          'x',
          { runId: 'no-cost', status: 'running' },
          { runId: 'negative', status: 'running', cost: { ...COST, usd: -1 } },
          { runId: 'fraction', status: 'running', cost: { ...COST, calls: 1.5 } },
          { runId: 'nan', status: 'running', cost: { ...COST, usd: Number.NaN } },
          { runId: 'text', status: 'running', cost: { ...COST, unknown: '1' } },
        ],
      }),
      json({ nope: true }),
      json({ run }),
      json({ run: { status: 'running' } }),
    ]);
    const client = createClient({ token: TOKEN, fetch: replies.fetch });
    expect(await client.runs()).toEqual([{ runId: 'a', status: 'running', cost: COST }]);
    expect(await client.runs()).toEqual([]);
    expect(await client.run('id with space')).toEqual({ run, canStop: false });
    expect(replies.calls[2]?.url).toBe('/api/v1/runs/id%20with%20space');
    expect((await failureOf(client.run('x'))).kind).toBe('server');
    expect(isRunSnapshot(null)).toBe(false);
  });

  it('reads a step log as text', async () => {
    const replies = fakeFetch([new Response('line 1\nline 2\n', { status: 200 })]);
    expect(await createClient({ token: TOKEN, fetch: replies.fetch }).stepLog('r', 'verify')).toBe(
      'line 1\nline 2\n',
    );
    expect(replies.calls[0]?.url).toBe('/api/v1/runs/r/steps/verify/log');
  });
});

describe('following a run', () => {
  it('delivers snapshots and stops at the end of the run', async () => {
    const first = liveRun();
    const last = liveRun({ status: 'completed' });
    const replies = fakeFetch([
      sse([
        ': connected\n\n',
        frame(3, 'snapshot', { id: 3, run: first }),
        frame(9, 'snapshot', { id: 9, run: last }),
        'event: end\ndata: {}\n\n',
      ]),
    ]);
    const seen = recorder<RunSnapshot>();
    await createClient({ token: TOKEN, fetch: replies.fetch }).followRun(
      'r',
      seen.handlers,
      new AbortController().signal,
    );
    expect(seen.events.map((r) => r.status)).toEqual(['running', 'completed']);
    expect(seen.states).toEqual(['connecting', 'live', 'ended']);
  });

  it('resumes after a drop from the last event it saw, without the token in the address', async () => {
    const replies = fakeFetch([
      sse([frame(4, 'snapshot', { id: 4, run: liveRun() })]),
      new TypeError('reset'),
      sse([frame(7, 'snapshot', { id: 7, run: liveRun({ status: 'failed' }) }), 'event: end\ndata: {}\n\n']),
    ]);
    const waits: number[] = [];
    const seen = recorder<RunSnapshot>();
    await createClient({
      token: TOKEN,
      fetch: replies.fetch,
      retryMs: 100,
      sleep: async (ms) => {
        waits.push(ms);
      },
    }).followRun('r', seen.handlers, new AbortController().signal);
    expect(replies.calls.map((c) => c.headers['Last-Event-ID'])).toEqual([undefined, '4', '4']);
    expect(replies.calls.every((c) => !c.url.includes(TOKEN))).toBe(true);
    expect(waits).toEqual([100, 200]);
    expect(seen.states).toEqual([
      'connecting',
      'live',
      'reconnecting',
      'reconnecting',
      'reconnecting',
      'reconnecting',
      'live',
      'ended',
    ]);
    expect(seen.events.map((r) => r.status)).toEqual(['running', 'failed']);
  });

  it('skips events it cannot read and keeps going', async () => {
    const replies = fakeFetch([
      sse([
        'event: snapshot\ndata: not json\n\n',
        frame(1, 'snapshot', { id: 1, run: { status: 1 } }),
        frame(2, 'other', {}),
        frame(3, 'snapshot', { id: 3, run: liveRun() }),
        'event: end\ndata: {}\n\n',
      ]),
    ]);
    const seen = recorder<RunSnapshot>();
    await createClient({ token: TOKEN, fetch: replies.fetch }).followRun(
      'r',
      seen.handlers,
      new AbortController().signal,
    );
    expect(seen.events).toHaveLength(1);
  });

  it('stops for good on a refused token or a run that does not exist', async () => {
    for (const [status, kind] of [
      [401, 'unauthorized'],
      [404, 'not_found'],
    ] as const) {
      const replies = fakeFetch([json({ code: 'x', message: 'gone' }, status)]);
      const seen = recorder<RunSnapshot>();
      await createClient({ token: TOKEN, fetch: replies.fetch, sleep: noSleep }).followRun(
        'r',
        seen.handlers,
        new AbortController().signal,
      );
      expect(seen.failures.map((f) => f.kind)).toEqual([kind]);
      expect(replies.calls).toHaveLength(1);
    }
  });

  it('caps the wait between reconnects and ends when aborted', async () => {
    const controller = new AbortController();
    const replies = fakeFetch(Array.from({ length: 8 }, () => new Response('', { status: 503 })));
    const waits: number[] = [];
    const seen = recorder<RunSnapshot>();
    await createClient({
      token: TOKEN,
      fetch: replies.fetch,
      sleep: async (ms) => {
        waits.push(ms);
        if (waits.length === 6) {
          controller.abort();
        }
      },
    }).followRun('r', seen.handlers, controller.signal);
    expect(waits).toEqual([500, 1000, 2000, 4000, 5000, 5000]);
  });

  it('stops asking a server that does not answer, and says it is unavailable', async () => {
    const replies = fakeFetch(Array.from({ length: 10 }, () => new TypeError('refused')));
    const waits: number[] = [];
    const seen = recorder<RunSnapshot>();
    await createClient({
      token: TOKEN,
      fetch: replies.fetch,
      giveUpAfter: 3,
      sleep: async (ms) => {
        waits.push(ms);
      },
    }).followRun('r', seen.handlers, new AbortController().signal);
    expect(replies.calls).toHaveLength(3);
    expect(waits).toHaveLength(2);
    expect(seen.states.at(-1)).toBe('unavailable');
    expect(seen.failures).toEqual([]);
  });

  it('counts only failures in a row: a stream that comes back starts the count again', async () => {
    const replies = fakeFetch([
      new TypeError('down'),
      sse([frame(1, 'snapshot', { id: 1, run: liveRun() })]),
      new TypeError('down'),
      sse([frame(2, 'snapshot', { id: 2, run: liveRun() }), 'event: end\ndata: {}\n\n']),
    ]);
    const seen = recorder<RunSnapshot>();
    await createClient({ token: TOKEN, fetch: replies.fetch, giveUpAfter: 3, sleep: noSleep }).followRun(
      'r',
      seen.handlers,
      new AbortController().signal,
    );
    expect(seen.states).not.toContain('unavailable');
    expect(seen.states.at(-1)).toBe('ended');
  });

  it('ends quietly when aborted while a stream is open', async () => {
    const controller = new AbortController();
    const replies = fakeFetch([sse([frame(1, 'snapshot', { id: 1, run: liveRun() })], true)]);
    const seen = recorder<RunSnapshot>();
    const done = createClient({ token: TOKEN, fetch: replies.fetch, sleep: noSleep }).followRun(
      'r',
      {
        ...seen.handlers,
        onEvent: (e) => {
          seen.events.push(e);
          controller.abort();
        },
      },
      controller.signal,
    );
    await done;
    expect(seen.events).toHaveLength(1);
    expect(seen.states.at(-1)).toBe('live');
  });

  it('waits with a timer by default, and stops waiting when aborted', async () => {
    const controller = new AbortController();
    const replies = fakeFetch([new TypeError('down')]);
    const seen = recorder<RunSnapshot>();
    const done = createClient({ token: TOKEN, fetch: replies.fetch, retryMs: 60_000 }).followRun(
      'r',
      seen.handlers,
      controller.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await done;
    expect(seen.states).toEqual(['connecting', 'reconnecting']);
  });
});

describe('following the server', () => {
  it('announces runs that start and end, and nothing else', async () => {
    const summary = { runId: 'r1', status: 'running', startedAt: undefined, workflow: 'w', cost: COST };
    const replies = fakeFetch([
      sse([
        frame(1, 'run', { id: 1, kind: 'run_started', run: summary }),
        frame(2, 'run', { id: 2, kind: 'renamed', run: summary }),
        frame(3, 'run', { kind: 'run_ended', run: summary }),
        frame(4, 'snapshot', {}),
        frame(5, 'run', { id: 5, kind: 'run_ended', run: { ...summary, status: 'completed' } }),
        'event: end\ndata: {}\n\n',
      ]),
    ]);
    const seen = recorder<ServerStreamEvent>();
    await createClient({ token: TOKEN, fetch: replies.fetch }).followServer(
      seen.handlers,
      new AbortController().signal,
    );
    expect(seen.events.map((e) => [e.id, e.kind])).toEqual([
      [1, 'run_started'],
      [5, 'run_ended'],
    ]);
    expect(replies.calls[0]?.url).toBe('/api/v1/events');
  });
});

describe('the discussion of a debate step', () => {
  const view = {
    stepId: 'debate',
    outcome: 'stalled',
    rounds: 1,
    messages: [{ round: 1, sender: 'a', type: 'CRITIQUE', content: 'x' }],
  };

  it('asks for the run and the step, with the token only in the header', async () => {
    const replies = fakeFetch([json({ discussion: view })]);
    const found = await createClient({ token: TOKEN, fetch: replies.fetch }).discussion('r 1', 'de bate');
    expect(found).toEqual(view);
    expect(replies.calls[0]?.url).toBe('/api/v1/runs/r%201/steps/de%20bate/discussion');
    expect(replies.calls[0]?.url).not.toContain(TOKEN);
  });

  it('is undefined when the run kept none, and an error for anything else', async () => {
    const none = fakeFetch([json({ code: 'discussion_not_found', message: 'none' }, 404)]);
    expect(await createClient({ token: TOKEN, fetch: none.fetch }).discussion('r', 's')).toBeUndefined();
    const broken = fakeFetch([json({ code: 'x', message: 'boom' }, 500)]);
    await expect(
      createClient({ token: TOKEN, fetch: broken.fetch }).discussion('r', 's'),
    ).rejects.toBeInstanceOf(ApiFailure);
    const unreadable = fakeFetch([json({ discussion: { outcome: 1 } })]);
    await expect(
      createClient({ token: TOKEN, fetch: unreadable.fetch }).discussion('r', 's'),
    ).rejects.toBeInstanceOf(ApiFailure);
    const wrong = fakeFetch([json({ nothing: true })]);
    await expect(
      createClient({ token: TOKEN, fetch: wrong.fetch }).discussion('r', 's'),
    ).rejects.toBeInstanceOf(ApiFailure);
  });
});

describe('the client: Run and Stop (T-15)', () => {
  const USE = {
    runners: ['shell'],
    commands: ['build: npm test'],
    permissions: ['build: x'],
    needsPerson: [],
  };
  const WORKFLOW = {
    id: 'w1',
    name: 'demo',
    path: 'demo.workflow.ai.yml',
    project: 'p',
    valid: true,
    problems: [],
  };

  it('reads the workflows, keeps only those it can read, and says when the server starts none', async () => {
    const replies = fakeFetch([
      json({ workflows: [WORKFLOW, { id: 'w2' }, 'x', { ...WORKFLOW, problems: [1] }], truncated: true }),
      json({ code: 'runs_unavailable', message: 'no' }, 404),
      json({ nope: true }),
    ]);
    const client = createClient({ token: TOKEN, fetch: replies.fetch });
    expect(await client.workflows()).toEqual({ workflows: [WORKFLOW], truncated: true });
    expect(await client.workflows()).toBeUndefined();
    await expect(client.workflows()).rejects.toBeInstanceOf(ApiFailure);
    expect(replies.calls[0]?.url).toBe('/api/v1/workflows');
  });

  it('starts a run, asks for a confirmation, or names a refusal by its code', async () => {
    const replies = fakeFetch([
      json({ code: 'confirmation_required', message: 'm', contentHash: 'h'.repeat(64), use: USE }, 409),
      json({ startId: 'web-1' }, 202),
      json({ code: 'workflow_invalid', message: 'm', problems: ['steps is missing', 3] }, 422),
      json({ code: 'too_many_runs', message: 'm' }, 429),
      json({ code: 'confirmation_required', message: 'm', contentHash: 'h', use: { runners: 'x' } }, 409),
      new Response('not json', { status: 500 }),
    ]);
    const client = createClient({ token: TOKEN, fetch: replies.fetch });
    expect(await client.startRun('w1')).toEqual({ kind: 'confirm', contentHash: 'h'.repeat(64), use: USE });
    expect(await client.startRun('w1', 'h'.repeat(64))).toEqual({ kind: 'started', startId: 'web-1' });
    expect(await client.startRun('w1')).toEqual({
      kind: 'refused',
      code: 'workflow_invalid',
      problems: ['steps is missing'],
    });
    expect(await client.startRun('w1')).toEqual({ kind: 'refused', code: 'too_many_runs', problems: [] });
    expect(await client.startRun('w1')).toEqual({
      kind: 'refused',
      code: 'confirmation_required',
      problems: [],
    });
    expect(await client.startRun('w1')).toEqual({ kind: 'refused', code: 'other', problems: [] });
    expect(replies.calls[0]).toEqual({
      url: '/api/v1/runs',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    });
  });

  it('treats a missing token as fatal and a dead server as unreachable, on every write', async () => {
    const replies = fakeFetch([
      json({ code: 'unauthorized', message: 'm' }, 401),
      new TypeError('network'),
      json({ code: 'unauthorized', message: 'm' }, 401),
    ]);
    const client = createClient({ token: TOKEN, fetch: replies.fetch });
    await expect(client.startRun('w1')).rejects.toMatchObject({ failure: { kind: 'unauthorized' } });
    await expect(client.startRun('w1')).rejects.toMatchObject({ failure: { kind: 'unreachable' } });
    await expect(client.stopRun('a')).rejects.toMatchObject({ failure: { kind: 'unauthorized' } });
  });

  it('reads where a start is, and refuses an answer of the wrong shape', async () => {
    const replies = fakeFetch([
      json({ state: 'starting' }),
      json({ state: 'running', runId: 'abc' }),
      json({ state: 'failed', failure: 'bad key' }),
      json({ state: 'gone' }),
      json({ code: 'start_not_found', message: 'm' }, 404),
    ]);
    const client = createClient({ token: TOKEN, fetch: replies.fetch });
    expect(await client.startStatus('web-1')).toEqual({ state: 'starting' });
    expect(await client.startStatus('web-1')).toEqual({ state: 'running', runId: 'abc' });
    expect(await client.startStatus('web-1')).toEqual({ state: 'failed', failure: 'bad key' });
    await expect(client.startStatus('web-1')).rejects.toMatchObject({ failure: { kind: 'server' } });
    await expect(client.startStatus('web-1')).rejects.toMatchObject({ failure: { kind: 'not_found' } });
    expect(replies.calls[0]?.url).toBe('/api/v1/starts/web-1');
  });

  it('stops a run: stopping, ended, or a refusal by its code', async () => {
    const replies = fakeFetch([
      json({ state: 'stopping' }, 202),
      json({ state: 'ended' }, 200),
      json({ code: 'not_started_here', message: 'm' }, 409),
      json({ state: 'stopping' }, 200),
    ]);
    const client = createClient({ token: TOKEN, fetch: replies.fetch });
    expect(await client.stopRun('a b')).toEqual({ kind: 'stopping' });
    expect(await client.stopRun('a')).toEqual({ kind: 'ended' });
    expect(await client.stopRun('a')).toEqual({ kind: 'refused', code: 'not_started_here' });
    expect(await client.stopRun('a')).toEqual({ kind: 'refused', code: 'other' });
    expect(replies.calls[0]).toEqual({
      url: '/api/v1/runs/a%20b/stop',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
  });

  it('says a run can be stopped only when the server says so', async () => {
    const run = liveRun();
    const replies = fakeFetch([json({ run, canStop: true }), json({ run, canStop: 'yes' })]);
    const client = createClient({ token: TOKEN, fetch: replies.fetch });
    expect((await client.run('a')).canStop).toBe(true);
    expect((await client.run('a')).canStop).toBe(false);
  });
});

describe('the client: the source of a workflow (T-09)', () => {
  const WF = {
    id: 'w1',
    name: 'demo',
    path: 'demo.workflow.ai.yml',
    project: 'p',
    valid: true,
    problems: [],
  };

  it('reads a source, keeping only the problems it can read', async () => {
    const replies = fakeFetch([
      json({
        workflow: WF,
        text: 'x',
        contentHash: 'h',
        problems: [{ message: 'a', line: 1, column: 2 }, { line: 1 }, { message: 'b', line: -1 }],
      }),
      json({ workflow: { id: 'w1' }, text: 'x' }),
      json({ code: 'workflow_not_found', message: 'This workflow is no longer in the project.' }, 404),
    ]);
    const client = createClient({ token: TOKEN, fetch: replies.fetch });
    expect(await client.workflowSource('w1')).toEqual({
      workflow: WF,
      text: 'x',
      contentHash: 'h',
      problems: [{ message: 'a', line: 1, column: 2 }],
    });
    await expect(client.workflowSource('w1')).rejects.toMatchObject({ failure: { kind: 'server' } });
    await expect(client.workflowSource('w1')).rejects.toMatchObject({
      failure: { kind: 'not_found', message: 'This workflow is no longer in the project.' },
    });
    expect(replies.calls[0]?.url).toBe('/api/v1/workflows/w1/source');
  });

  it('saves: saved, a conflict with the disk’s version, or a refusal by its code', async () => {
    const replies = fakeFetch([
      json({ contentHash: 'n', problems: [] }),
      json({ code: 'changed_on_disk', message: 'm', current: { text: 'disk', contentHash: 'd' } }, 409),
      json({ code: 'changed_on_disk', message: 'm', current: { text: 3 } }, 409),
      json({ code: 'not_saved', message: 'm' }, 409),
      new Response('nope', { status: 500 }),
    ]);
    const client = createClient({ token: TOKEN, fetch: replies.fetch });
    expect(await client.saveWorkflowSource('w1', 'text', 'base')).toEqual({
      kind: 'saved',
      contentHash: 'n',
      problems: [],
    });
    expect(await client.saveWorkflowSource('w1', 'text', 'base')).toEqual({
      kind: 'changed',
      current: { text: 'disk', contentHash: 'd' },
    });
    expect(await client.saveWorkflowSource('w1', 'text', 'base')).toEqual({
      kind: 'refused',
      code: 'changed_on_disk',
    });
    expect(await client.saveWorkflowSource('w1', 'text', 'base')).toEqual({
      kind: 'refused',
      code: 'not_saved',
    });
    expect(await client.saveWorkflowSource('w1', 'text', 'base')).toEqual({ kind: 'refused', code: 'other' });
    expect(replies.calls[0]?.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    });
  });

  it('checks a draft, and says when the server does not open files', async () => {
    const replies = fakeFetch([
      json({ problems: [{ message: 'p', line: 3, column: 1 }] }),
      json({ code: 'source_unavailable', message: 'm' }, 404),
      json({ code: 'method_not_allowed', message: 'm' }, 405),
      json({ nope: true }),
    ]);
    const client = createClient({ token: TOKEN, fetch: replies.fetch });
    expect(await client.checkWorkflow('x')).toEqual([{ message: 'p', line: 3, column: 1 }]);
    expect(await client.checkWorkflow('x')).toBeUndefined();
    expect(await client.checkWorkflow('x')).toBeUndefined();
    expect(await client.checkWorkflow('x')).toEqual([]);
  });
});
