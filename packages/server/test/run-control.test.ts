import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLogger,
  type LogRecord,
  type StartRunRequest,
  type StartRunResponse,
  type StartStatusResponse,
  type StopRunResponse,
  type WorkflowListResponse,
} from '@indaba/core';
import { type RunRecord, serializeRecord } from '@indaba/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  MAX_BODY_BYTES,
  MAX_CONCURRENT_RUNS,
  type RunControl,
  RunControlError,
  type ServerHandle,
  startServer,
} from '../src/index.js';

/** specs/web-app-actions, T-02 to T-08: the three resources of Run and Stop, over a run control that is a fake. */

const TOKEN = ['runs', 'w'.repeat(24)].join('_');
const MINE = 'a'.repeat(32);
const THEIRS = 'b'.repeat(32);
const ENDED = 'c'.repeat(32);
const HASH = 'f'.repeat(64);
const START = 'd'.repeat(32);

type Record_ = Exclude<RunRecord, { type: 'unknown' }>;
const rootStart = (traceId: string): Record_ => ({
  type: 'span_started',
  at: '2026-10-22T12:00:00.000Z',
  traceId,
  spanId: 'r'.repeat(16),
  parentSpanId: undefined,
  name: 'indaba.task demo',
  attributes: { 'indaba.task.id': 'task-1', 'indaba.workflow.name': 'demo' },
});

/** What the fake was asked; every request body field that reached it is recorded here and nowhere else. */
interface Calls {
  starts: StartRunRequest[];
  statuses: string[];
  stops: string[];
  stopAll: number;
}

let base: string;
let root: string;
let site: string;
let server: ServerHandle | undefined;
let logged: LogRecord[];
let calls: Calls;
let refusal: RunControlError | Error | undefined;
let alive: Set<string>;

const list: WorkflowListResponse = {
  workflows: [
    { id: 'w1', name: 'demo', path: 'demo.workflow.ai.yml', project: 'project', valid: true, problems: [] },
  ],
  truncated: false,
};

function fakeControl(): RunControl {
  return {
    list: async () => list,
    start: async (req): Promise<StartRunResponse> => {
      calls.starts.push(req);
      if (refusal !== undefined) {
        throw refusal;
      }
      return { startId: START };
    },
    startStatus: (startId): StartStatusResponse | undefined => {
      calls.statuses.push(startId);
      return startId === START ? { state: 'running', runId: MINE } : undefined;
    },
    stop: (runId): StopRunResponse | undefined => {
      calls.stops.push(runId);
      if (runId === MINE) {
        return { state: alive.has(runId) ? 'stopping' : 'ended' };
      }
      return runId === ENDED ? { state: 'ended' } : undefined;
    },
    isAlive: (runId) => alive.has(runId),
    stopAll: async () => {
      calls.stopAll += 1;
    },
  };
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'indaba-runs-'));
  root = join(base, 'project');
  site = join(base, 'site');
  await mkdir(join(root, '.indaba', 'traces'), { recursive: true });
  await mkdir(site, { recursive: true });
  await writeFile(join(site, 'index.html'), '<!doctype html>');
  for (const id of [MINE, THEIRS, ENDED]) {
    await writeFile(
      join(root, '.indaba', 'traces', `${id}.events.jsonl`),
      `${serializeRecord(rootStart(id))}\n`,
    );
  }
  logged = [];
  calls = { starts: [], statuses: [], stops: [], stopAll: 0 };
  refusal = undefined;
  alive = new Set([MINE]);
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(base, { recursive: true, force: true });
});

async function start(withRuns = true): Promise<ServerHandle> {
  server = await startServer({
    roots: [root],
    staticDir: site,
    token: TOKEN,
    logger: createLogger({
      sinks: [{ write: (record) => logged.push(record) }],
      clock: () => new Date('2026-10-22T12:00:00.000Z'),
      level: 'debug',
    }),
    ...(withRuns ? { runs: fakeControl() } : {}),
  });
  return server;
}

interface Answer {
  readonly status: number;
  readonly allow: string | undefined;
  readonly body: unknown;
}

interface SendOptions {
  readonly method?: string;
  readonly body?: string;
  readonly type?: string;
  /** Default on a write: the page's own; `null` leaves the header out. */
  readonly origin?: string | null;
  readonly auth?: boolean;
  readonly host?: string;
}

function send(path: string, options: SendOptions = {}): Promise<Answer> {
  const method = options.method ?? 'GET';
  const origin =
    options.origin === undefined
      ? method === 'GET'
        ? undefined
        : `http://127.0.0.1:${server?.port}`
      : options.origin;
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: server?.port,
        method,
        path,
        headers: {
          Host: options.host ?? `127.0.0.1:${server?.port}`,
          ...(options.auth === false ? {} : { Authorization: `Bearer ${TOKEN}` }),
          ...(options.type === undefined ? {} : { 'Content-Type': options.type }),
          ...(origin === null || origin === undefined ? {} : { Origin: origin }),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: unknown = text;
          try {
            body = JSON.parse(text);
          } catch {
            // not JSON
          }
          resolve({ status: res.statusCode ?? 0, allow: res.headers.allow, body });
        });
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

const json = (value: unknown) => ({ body: JSON.stringify(value), type: 'application/json' });
const post = (path: string, extra: SendOptions = {}) => send(path, { method: 'POST', ...extra });

describe('the run resources over HTTP', () => {
  it('says the contract version', async () => {
    await start();
    expect(CONTRACT_VERSION).toBe('1.5.0');
    expect((await send('/api/v1/contract')).body).toEqual({ contractVersion: '1.5.0' });
  });

  it('lists the workflows the control found (AC-01)', async () => {
    await start();
    const answer = await send('/api/v1/workflows');
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(list);
  });

  it('starts a workflow by id and answers 202 with the start id (AC-03)', async () => {
    await start();
    const answer = await post('/api/v1/runs', json({ workflowId: 'w1' }));
    expect(answer.status).toBe(202);
    expect(answer.body).toEqual({ startId: START });
    expect(calls.starts).toEqual([{ workflowId: 'w1' }]);
  });

  it('hands on a confirmation hash and nothing else from the body (AC-04, AC-16)', async () => {
    await start();
    const answer = await post(
      '/api/v1/runs',
      json({ workflowId: 'w1', confirmedHash: HASH, taskId: '../x', path: '/etc/passwd', cwd: '/' }),
    );
    expect(answer.status).toBe(202);
    expect(calls.starts).toEqual([{ workflowId: 'w1', confirmedHash: HASH }]);
  });

  it('maps every refusal of the control to its status and plain words, never the control’s own text', async () => {
    await start();
    const cases: [RunControlError, number][] = [
      [new RunControlError('workflow_not_found', 'secret /home/a'), 404],
      [new RunControlError('workflow_invalid', 'secret /home/a', { problems: ['steps is missing', 7] }), 422],
      [new RunControlError('not_saved', 'EACCES /home/a/.config'), 409],
      [new RunControlError('too_many_runs', 'secret'), 429],
      [new RunControlError('start_failed', 'spawn ENOENT /usr/bin/x'), 500],
    ];
    for (const [error, status] of cases) {
      refusal = error;
      const answer = await post('/api/v1/runs', json({ workflowId: 'w1' }));
      expect(answer.status).toBe(status);
      expect(answer.body).toMatchObject({ code: error.code });
      expect(JSON.stringify(answer.body)).not.toMatch(/secret|\/home|ENOENT|EACCES/);
    }
    refusal = new RunControlError('workflow_invalid', 'x', { problems: ['steps is missing', 7] });
    expect((await post('/api/v1/runs', json({ workflowId: 'w1' }))).body).toMatchObject({
      problems: ['steps is missing'],
    });
    refusal = new RunControlError('too_many_runs', 'x');
    expect(JSON.stringify((await post('/api/v1/runs', json({ workflowId: 'w1' }))).body)).toContain(
      String(MAX_CONCURRENT_RUNS),
    );
    expect(logged.filter((r) => r.message === 'start refused').map((r) => r.fields?.code)).toContain(
      'start_failed',
    );
  });

  it('recognises a refusal by its name and code, so a control from another package copy works', async () => {
    await start();
    const foreign = Object.assign(new Error('x'), { name: 'RunControlError', code: 'too_many_runs' });
    refusal = foreign;
    expect((await post('/api/v1/runs', json({ workflowId: 'w1' }))).status).toBe(429);
    refusal = Object.assign(new Error('x'), { name: 'RunControlError', code: 7 });
    expect((await post('/api/v1/runs', json({ workflowId: 'w1' }))).status).toBe(500);
  });

  it('asks for a confirmation with the hash and the summary of use (AC-04)', async () => {
    await start();
    const use = {
      runners: ['shell'],
      commands: ['npm test'],
      permissions: ['build: x'],
      needsPerson: [],
      fullAccessSteps: [],
    };
    refusal = new RunControlError('confirmation_required', 'x', { contentHash: HASH, use });
    const answer = await post('/api/v1/runs', json({ workflowId: 'w1' }));
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ code: 'confirmation_required', contentHash: HASH, use });
  });

  it('hands on the hash of the full-access confirmation, beside the other one (AC-05)', async () => {
    await start();
    const other = 'e'.repeat(64);
    const answer = await post(
      '/api/v1/runs',
      json({
        workflowId: 'w1',
        confirmedHash: HASH,
        fullAccessConfirmedHash: other,
        allow: '--allow-full-access',
      }),
    );
    expect(answer.status).toBe(202);
    expect(calls.starts).toEqual([{ workflowId: 'w1', confirmedHash: HASH, fullAccessConfirmedHash: other }]);
  });

  it('answers 409 full_access_required with the steps, and takes no word of the control’s own (AC-05)', async () => {
    await start();
    const steps = [{ stepId: 'build', runners: ['claude-code'] }];
    refusal = new RunControlError('full_access_required', 'secret /home/a', { contentHash: HASH, steps });
    const answer = await post('/api/v1/runs', json({ workflowId: 'w1' }));
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ code: 'full_access_required', contentHash: HASH, steps });
    expect(JSON.stringify(answer.body)).not.toMatch(/secret|\/home/);
    refusal = new RunControlError('full_access_required', 'x');
    expect((await post('/api/v1/runs', json({ workflowId: 'w1' }))).status).toBe(500);
  });

  it('treats an unknown refusal, or a confirmation without its detail, as a fault of the server', async () => {
    await start();
    refusal = new RunControlError('confirmation_required', 'x');
    expect((await post('/api/v1/runs', json({ workflowId: 'w1' }))).status).toBe(500);
    refusal = new RunControlError('surprise', 'x');
    expect((await post('/api/v1/runs', json({ workflowId: 'w1' }))).status).toBe(500);
    refusal = new Error('boom');
    const answer = await post('/api/v1/runs', json({ workflowId: 'w1' }));
    expect(answer.status).toBe(500);
    expect(answer.body).toMatchObject({ code: 'internal' });
  });

  it('answers the state of a start, and 404 for one it did not issue (AC-08, AC-15)', async () => {
    await start();
    const known = await send(`/api/v1/starts/${START}`);
    expect(known.status).toBe(200);
    expect(known.body).toEqual({ state: 'running', runId: MINE });
    const unknown = await send(`/api/v1/starts/${'e'.repeat(32)}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ code: 'start_not_found' });
  });

  it('stops a run it started: 202 while alive, 200 once ended (AC-09)', async () => {
    await start();
    const stopping = await post(`/api/v1/runs/${MINE}/stop`);
    expect(stopping.status).toBe(202);
    expect(stopping.body).toEqual({ state: 'stopping' });
    expect((await post(`/api/v1/runs/${MINE}/stop`)).status).toBe(202);
    alive.delete(MINE);
    const ended = await post(`/api/v1/runs/${MINE}/stop`);
    expect(ended.status).toBe(200);
    expect(ended.body).toEqual({ state: 'ended' });
    expect(logged.filter((r) => r.message === 'run stop requested')).toHaveLength(3);
  });

  it('never stops a run it did not start, and says no run has an unknown id (AC-09)', async () => {
    await start();
    const theirs = await post(`/api/v1/runs/${THEIRS}/stop`);
    expect(theirs.status).toBe(409);
    expect(theirs.body).toMatchObject({ code: 'not_started_here' });
    const none = await post(`/api/v1/runs/${'0'.repeat(32)}/stop`);
    expect(none.status).toBe(404);
    expect(none.body).toMatchObject({ code: 'run_not_found' });
  });

  it('says canStop only for a live run it started (AC-10)', async () => {
    await start();
    const mine = await send(`/api/v1/runs/${MINE}`);
    expect(mine.body).toMatchObject({ canStop: true });
    expect((await send(`/api/v1/runs/${THEIRS}`)).body).toMatchObject({ canStop: false });
  });

  it('stops every run before it closes (AC-11)', async () => {
    const handle = await start();
    await handle.close();
    server = undefined;
    expect(calls.stopAll).toBe(1);
  });

  it('closes even when stopping the runs fails, and says so', async () => {
    const control = fakeControl();
    server = await startServer({
      roots: [root],
      staticDir: site,
      token: TOKEN,
      logger: createLogger({
        sinks: [{ write: (record) => logged.push(record) }],
        clock: () => new Date('2026-10-22T12:00:00.000Z'),
        level: 'debug',
      }),
      runs: {
        ...control,
        stopAll: async () => {
          throw new Error('could not');
        },
      },
    });
    await server.close();
    server = undefined;
    expect(logged.map((r) => r.message)).toContain('the runs could not all be stopped');
  });
});

describe('a server without a run control (T-03)', () => {
  it('stays the read-only one: the resources answer 404 and a POST is not allowed', async () => {
    await start(false);
    const workflows = await send('/api/v1/workflows');
    expect(workflows.status).toBe(404);
    expect(workflows.body).toMatchObject({ code: 'runs_unavailable' });
    expect((await send(`/api/v1/starts/${START}`)).status).toBe(404);
    const startRun = await post('/api/v1/runs', json({ workflowId: 'w1' }));
    expect(startRun.status).toBe(405);
    expect(startRun.allow).toBe('GET');
    const stop = await post(`/api/v1/runs/${MINE}/stop`);
    expect(stop.status).toBe(405);
    expect((await send(`/api/v1/runs/${MINE}`)).body).toMatchObject({ canStop: false });
  });
});

describe('hostile input (T-08, AC-16)', () => {
  it('takes no write without the page’s own Origin, even with the token', async () => {
    await start();
    expect((await post('/api/v1/runs', { origin: null, ...json({ workflowId: 'w1' }) })).status).toBe(403);
    expect(
      (await post('/api/v1/runs', { origin: 'https://evil.test', ...json({ workflowId: 'w1' }) })).status,
    ).toBe(403);
    expect((await post(`/api/v1/runs/${MINE}/stop`, { origin: null })).status).toBe(403);
    expect((await post(`/api/v1/runs/${MINE}/stop`, { origin: 'http://localhost:1' })).status).toBe(403);
    expect(calls.starts).toEqual([]);
    expect(calls.stops).toEqual([]);
  });

  it('takes nothing without the token, or from another Host', async () => {
    await start();
    expect((await post('/api/v1/runs', { auth: false, ...json({ workflowId: 'w1' }) })).status).toBe(401);
    expect((await send('/api/v1/workflows', { auth: false })).status).toBe(401);
    expect((await send(`/api/v1/starts/${START}`, { auth: false })).status).toBe(401);
    expect((await post(`/api/v1/runs/${MINE}/stop`, { auth: false })).status).toBe(401);
    expect((await post('/api/v1/runs', { host: 'evil.test', ...json({ workflowId: 'w1' }) })).status).toBe(
      421,
    );
    expect(calls.starts).toEqual([]);
    expect(calls.stops).toEqual([]);
  });

  it('refuses a body of the wrong type, size or shape before the control sees it', async () => {
    await start();
    const bodies: [SendOptions, number][] = [
      [{ body: 'workflowId=w1', type: 'application/x-www-form-urlencoded' }, 415],
      [{ body: 'x'.repeat(MAX_BODY_BYTES + 1), type: 'application/json' }, 413],
      [{ body: '{"workflowId":', type: 'application/json' }, 400],
      [json(['w1']), 400],
      [json('w1'), 400],
      [json(null), 400],
      [json({}), 400],
      [json({ workflowId: 7 }), 400],
      [json({ workflowId: '' }), 400],
      [json({ workflowId: 'w'.repeat(10 * 1024) }), 400],
      [json({ workflowId: 'w1', confirmedHash: 'not hex' }), 400],
      [json({ workflowId: 'w1', confirmedHash: HASH.toUpperCase() }), 400],
      [json({ workflowId: 'w1', confirmedHash: 64 }), 400],
      [json({ workflowId: 'w1', fullAccessConfirmedHash: 'not hex' }), 400],
      [json({ workflowId: 'w1', fullAccessConfirmedHash: HASH.toUpperCase() }), 400],
      [json({ workflowId: 'w1', fullAccessConfirmedHash: 64 }), 400],
    ];
    for (const [body, status] of bodies) {
      expect((await post('/api/v1/runs', body)).status).toBe(status);
    }
    expect(calls.starts).toEqual([]);
  });

  it('hands a hostile workflow id to the control only as a string to match, and logs none of it', async () => {
    await start();
    refusal = new RunControlError('workflow_not_found', 'x');
    const nul = String.fromCharCode(0);
    const hostile = ['../../etc/passwd', 'a/b', 'a\\b', `w${nul}1`, '..', '%2e%2e'];
    for (const workflowId of hostile) {
      expect((await post('/api/v1/runs', json({ workflowId }))).status).toBe(404);
    }
    expect(calls.starts.map((s) => s.workflowId)).toEqual(hostile);
    const text = JSON.stringify(logged);
    for (const workflowId of hostile) {
      expect(text).not.toContain(JSON.stringify(workflowId).slice(1, -1));
    }
  });

  it('looks up no id of the wrong shape from a URL', async () => {
    await start();
    for (const id of ['..', 'ABC', 'a'.repeat(65), '%2e%2e', 'a%20b', `${'a'.repeat(32)}%00`]) {
      expect((await send(`/api/v1/starts/${id}`)).status).toBe(404);
    }
    for (const id of ['..', 'ABCDEF', 'g'.repeat(32), '%2e%2e', 'a'.repeat(65)]) {
      // `..` folds the address into another one, which takes no POST: refused either way, never looked up.
      expect([404, 405]).toContain((await post(`/api/v1/runs/${id}/stop`)).status);
    }
    expect(calls.stops).toEqual([]);
    expect(calls.statuses.every((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id))).toBe(true);
  });

  it('accepts only the methods each address takes, and names them', async () => {
    await start();
    const del = await send('/api/v1/runs', { method: 'DELETE' });
    expect(del.status).toBe(405);
    expect(del.allow).toBe('GET, POST');
    const getStop = await send(`/api/v1/runs/${MINE}/stop`);
    expect(getStop.status).toBe(405);
    expect(getStop.allow).toBe('POST');
    const postWorkflows = await post('/api/v1/workflows', json({}));
    expect(postWorkflows.status).toBe(405);
  });
});
