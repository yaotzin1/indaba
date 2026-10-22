import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger, type LogRecord } from '@indaba/core';
import { type RunRecord, serializeRecord } from '@indaba/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ServerHandle, startServer } from '../src/index.js';
import { loggedPath } from '../src/server.js';

/** specs/logging, AC-09: what the server of `indaba ui` records, and what it never does. */

const TOKEN = ['logged', 'v'.repeat(24)].join('_');
const RUN = 'a'.repeat(32);
const AT = '2026-10-21T12:00:00.000Z';
type Writable = Exclude<RunRecord, { type: 'unknown' }>;
const records: Writable[] = [
  {
    type: 'span_started',
    at: AT,
    traceId: RUN,
    spanId: '1'.repeat(16),
    parentSpanId: undefined,
    name: 'indaba.task logged',
    attributes: { 'indaba.workflow.name': 'logged' },
  },
  {
    type: 'span_ended',
    at: AT,
    traceId: RUN,
    spanId: '1'.repeat(16),
    status: 'ok',
    statusMessage: undefined,
    attributes: { 'indaba.workflow.status': 'COMPLETED' },
    events: [],
  },
];

let base: string;
let root: string;
let site: string;
let server: ServerHandle | undefined;
let logged: LogRecord[];

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'indaba-logging-'));
  root = join(base, 'project');
  site = join(base, 'site');
  await mkdir(join(root, '.indaba', 'traces'), { recursive: true });
  await mkdir(site, { recursive: true });
  await writeFile(join(site, 'index.html'), '<!doctype html>');
  await writeFile(
    join(root, '.indaba', 'traces', `${RUN}.events.jsonl`),
    records.map((r) => `${serializeRecord(r)}\n`).join(''),
  );
  logged = [];
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(base, { recursive: true, force: true });
});

async function start(level: 'info' | 'debug' = 'debug', roots = [root]): Promise<ServerHandle> {
  const logger = createLogger({
    sinks: [{ write: (record) => logged.push(record) }],
    clock: () => new Date(AT),
    level,
    pid: 1,
  });
  server = await startServer({ roots, staticDir: site, token: TOKEN, pollMs: 10, coalesceMs: 5, logger });
  return server;
}

function send(
  path: string,
  options: { method?: string; host?: string; auth?: string } = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: server?.port,
        method: options.method ?? 'GET',
        path,
        headers: {
          Host: options.host ?? `127.0.0.1:${server?.port}`,
          ...(options.auth === undefined ? {} : { Authorization: options.auth }),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    // A body only where one belongs: the refused POST must not get it into the log either.
    req.end(options.method === 'POST' ? 'a body that must not be logged' : undefined);
  });
}

const named = (message: string): LogRecord[] => logged.filter((r) => r.message === message);

describe('the log of the server', () => {
  it('says when it starts and stops, with its address and never its token', async () => {
    const handle = await start();
    expect(named('server started')).toEqual([
      expect.objectContaining({
        level: 'info',
        component: 'server.http',
        fields: { address: `http://127.0.0.1:${handle.port}/`, roots: 1 },
      }),
    ]);
    await handle.close();
    server = undefined;
    expect(named('server stopped')).toEqual([
      expect.objectContaining({ level: 'info', fields: { port: handle.port } }),
    ]);
    expect(JSON.stringify(logged)).not.toContain(TOKEN);
  });

  it('records every refused request with its method, path, status and reason, at info', async () => {
    await start();
    const port = server?.port ?? 0;
    expect(await send(`/api/v1/runs?token=${TOKEN}#frag`)).toBe(401);
    expect(await send('/api/v1/runs', { auth: `Bearer ${TOKEN}x` })).toBe(401);
    expect(await send('/api/v1/runs', { host: `evil.example:${port}`, auth: `Bearer ${TOKEN}` })).toBe(421);
    expect(await send('/api/v1/runs', { method: 'POST', auth: `Bearer ${TOKEN}` })).toBe(405);
    expect(await send('//[', { auth: `Bearer ${TOKEN}` })).toBe(400);
    expect(named('request refused').map((r) => [r.level, r.fields])).toEqual([
      ['info', { method: 'GET', path: '/api/v1/runs', status: 401, reason: 'unauthorized' }],
      ['info', { method: 'GET', path: '/api/v1/runs', status: 401, reason: 'unauthorized' }],
      ['info', { method: 'GET', path: '/api/v1/runs', status: 421, reason: 'host_not_allowed' }],
      ['info', { method: 'POST', path: '/api/v1/runs', status: 405, reason: 'method_not_allowed' }],
      ['info', { method: 'GET', path: '(not a valid address)', status: 400, reason: 'bad_request' }],
    ]);
    const all = JSON.stringify(logged);
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain('Bearer');
    expect(all).not.toContain('a body that must not be logged');
    expect(all).not.toContain('evil.example');
  });

  it('records what it did not find at debug only', async () => {
    await start('info');
    expect(await send(`/api/v1/runs/${'b'.repeat(32)}`, { auth: `Bearer ${TOKEN}` })).toBe(404);
    expect(named('nothing found')).toEqual([]);
    await server?.close();
    logged = [];
    await start('debug');
    expect(await send(`/api/v1/runs/${'b'.repeat(32)}`, { auth: `Bearer ${TOKEN}` })).toBe(404);
    expect(named('nothing found')).toEqual([
      expect.objectContaining({
        level: 'debug',
        fields: { method: 'GET', path: `/api/v1/runs/${'b'.repeat(32)}`, reason: 'run_not_found' },
      }),
    ]);
  });

  it('records a stream opening and closing, and whether the run ended it or the page went away', async () => {
    await start();
    const done = await fetch(`http://127.0.0.1:${server?.port}/api/v1/runs/${RUN}/events`, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Last-Event-ID': '1' },
    });
    await done.text();
    const controller = new AbortController();
    const live = await fetch(`http://127.0.0.1:${server?.port}/api/v1/events`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: controller.signal,
    });
    await live.body?.getReader().read();
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(named('stream opened').map((r) => r.fields)).toEqual([
      { stream: 'run', runId: RUN, resumedFrom: 1 },
      { stream: 'server' },
    ]);
    expect(named('stream closed').map((r) => r.fields)).toEqual([
      { stream: 'run', runId: RUN, resumedFrom: 1, ended: true },
      { stream: 'server', ended: false },
    ]);
  });

  it('records a request that failed as an error, with what went wrong, while the answer names nothing', async () => {
    const broken = join(base, 'broken');
    await mkdir(join(broken, '.indaba'), { recursive: true });
    await writeFile(join(broken, '.indaba', 'traces'), 'a file where a folder should be');
    await start('info', [broken]);
    expect(await send('/api/v1/runs', { auth: `Bearer ${TOKEN}` })).toBe(500);
    const [failed] = named('request failed');
    expect(failed).toMatchObject({
      level: 'error',
      component: 'server.http',
      fields: { method: 'GET', path: '/api/v1/runs' },
    });
    expect(String(failed?.fields?.error)).toMatch(/^Error: /);
  });

  it('logs nothing when it is given no logger', async () => {
    server = await startServer({ roots: [root], staticDir: site, token: TOKEN });
    expect(await send('/api/v1/runs')).toBe(401);
    expect(logged).toEqual([]);
  });
});

describe('the path a record keeps', () => {
  it('has no query or fragment, a bounded length, and a word for an address that is not one', () => {
    expect(loggedPath('/api/v1/runs?token=x#y')).toBe('/api/v1/runs');
    expect(loggedPath(undefined)).toBe('/');
    expect(loggedPath(`/${'x'.repeat(300)}`)).toBe(`/${'x'.repeat(199)}…`);
    expect(loggedPath('//[')).toBe('(not a valid address)');
  });
});
