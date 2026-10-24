import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLogger,
  type LogRecord,
  type SaveWorkflowSourceRequest,
  type WorkflowSourceResponse,
} from '@indaba/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_SOURCE_BODY_BYTES,
  MAX_SOURCE_BYTES,
  type ServerHandle,
  startServer,
  type WorkflowStore,
  WorkflowStoreError,
} from '../src/index.js';

/** specs/web-app-editing-core, T-02 to T-04: the source resources over HTTP, over a workflow store that is a fake. */

const TOKEN = ['source', 'q'.repeat(24)].join('_');
const ID = 'a'.repeat(32);
const HASH = 'b'.repeat(64);
const TEXT = 'version: "1.0"\nname: demo\nsteps: []\n';

let base: string;
let server: ServerHandle | undefined;
let logged: LogRecord[];
let reads: string[];
let saves: { id: string; request: SaveWorkflowSourceRequest }[];
let checks: string[];
let refusal: Error | undefined;

const source: WorkflowSourceResponse = {
  workflow: { id: ID, name: 'demo', path: 'demo.workflow.ai.yml', project: 'p', valid: true, problems: [] },
  text: TEXT,
  contentHash: HASH,
  problems: [],
};

const store: WorkflowStore = {
  read: async (id) => {
    reads.push(id);
    if (refusal !== undefined) throw refusal;
    return source;
  },
  save: async (id, req) => {
    saves.push({ id, request: req });
    if (refusal !== undefined) throw refusal;
    return { contentHash: 'c'.repeat(64), problems: [{ message: 'steps is missing', line: 3, column: 1 }] };
  },
  check: (text) => {
    checks.push(text);
    return { problems: text.includes('bad') ? [{ message: 'invalid YAML: x', line: 1, column: 2 }] : [] };
  },
};

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'indaba-source-'));
  await mkdir(join(base, 'project', '.indaba', 'traces'), { recursive: true });
  await mkdir(join(base, 'site'), { recursive: true });
  await writeFile(join(base, 'site', 'index.html'), '<!doctype html>');
  logged = [];
  reads = [];
  saves = [];
  checks = [];
  refusal = undefined;
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(base, { recursive: true, force: true });
});

async function start(withStore = true): Promise<ServerHandle> {
  server = await startServer({
    roots: [join(base, 'project')],
    staticDir: join(base, 'site'),
    token: TOKEN,
    logger: createLogger({
      sinks: [{ write: (record) => logged.push(record) }],
      clock: () => new Date('2026-10-22T12:00:00.000Z'),
      level: 'debug',
    }),
    ...(withStore ? { workflowStore: store } : {}),
  });
  return server;
}

interface Answer {
  readonly status: number;
  readonly allow: string | undefined;
  readonly body: Record<string, unknown>;
}

function send(
  path: string,
  options: { method?: string; body?: string; type?: string; origin?: string | null; auth?: boolean } = {},
): Promise<Answer> {
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
          Host: `127.0.0.1:${server?.port}`,
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
          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(text) as Record<string, unknown>;
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
const put = (value: unknown, extra: Parameters<typeof send>[1] = {}) =>
  send(`/api/v1/workflows/${ID}/source`, { method: 'PUT', ...json(value), ...extra });

describe('the source resources (AC-01 to AC-06)', () => {
  it('reads a workflow by its id', async () => {
    await start();
    const answer = await send(`/api/v1/workflows/${ID}/source`);
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(source);
    expect(reads).toEqual([ID]);
  });

  it('saves with text and the hash it started from, and nothing else from the body', async () => {
    await start();
    const answer = await put({ text: TEXT, baseHash: HASH, path: '../../etc/passwd', id: 'f'.repeat(32) });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({
      contentHash: 'c'.repeat(64),
      problems: [{ message: 'steps is missing', line: 3, column: 1 }],
    });
    expect(saves).toEqual([{ id: ID, request: { text: TEXT, baseHash: HASH } }]);
  });

  it('checks a draft without saving it', async () => {
    await start();
    const answer = await send('/api/v1/workflows/check', { method: 'POST', ...json({ text: 'bad' }) });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ problems: [{ message: 'invalid YAML: x', line: 1, column: 2 }] });
    expect(saves).toEqual([]);
  });

  it('maps each refusal of the store to its status and plain words, never the store’s own text', async () => {
    await start();
    const cases: [WorkflowStoreError, number][] = [
      [new WorkflowStoreError('workflow_not_found', 'secret /home/a'), 404],
      [new WorkflowStoreError('too_large', 'secret /home/a'), 413],
      [new WorkflowStoreError('not_text', 'secret /home/a'), 422],
      [new WorkflowStoreError('not_saved', 'EACCES /home/a/x.yml'), 409],
    ];
    for (const [error, status] of cases) {
      refusal = error;
      const read = await send(`/api/v1/workflows/${ID}/source`);
      expect(read.status).toBe(status);
      expect(read.body.code).toBe(error.code);
      expect(JSON.stringify(read.body)).not.toMatch(/secret|\/home|EACCES/);
    }
    expect(logged.filter((r) => r.message === 'save refused').map((r) => r.fields?.code)).toContain(
      'not_saved',
    );
  });

  it('answers a conflict with the version on disk', async () => {
    await start();
    refusal = new WorkflowStoreError('changed_on_disk', 'x', {
      current: { text: 'disk text', contentHash: HASH },
    });
    const answer = await put({ text: TEXT, baseHash: HASH });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({
      code: 'changed_on_disk',
      current: { text: 'disk text', contentHash: HASH },
    });
  });

  it('treats an unknown refusal, or a conflict without the disk’s version, as a fault', async () => {
    await start();
    for (const error of [
      new WorkflowStoreError('changed_on_disk', 'x'),
      new WorkflowStoreError('surprise', 'x'),
      new Error('boom'),
    ]) {
      refusal = error;
      const answer = await put({ text: TEXT, baseHash: HASH });
      expect(answer.status).toBe(500);
      expect(answer.body.code).toBe('internal');
    }
    refusal = Object.assign(new Error('x'), { name: 'WorkflowStoreError', code: 'not_text' });
    expect((await send(`/api/v1/workflows/${ID}/source`)).status).toBe(422);
  });

  it('says the contract version 1.6.0', async () => {
    await start();
    expect((await send('/api/v1/contract')).body).toEqual({ contractVersion: '1.6.0' });
  });
});

describe('a server without a workflow store (T-02)', () => {
  it('answers 404 and takes no write', async () => {
    await start(false);
    const read = await send(`/api/v1/workflows/${ID}/source`);
    expect(read.status).toBe(404);
    expect(read.body.code).toBe('source_unavailable');
    expect((await put({ text: TEXT, baseHash: HASH })).status).toBe(405);
    expect((await send('/api/v1/workflows/check', { method: 'POST', ...json({ text: '' }) })).status).toBe(
      405,
    );
  });
});

describe('hostile input (T-04, AC-14)', () => {
  it('takes no write without the page’s own Origin, the token or its own Host', async () => {
    await start();
    expect((await put({ text: TEXT, baseHash: HASH }, { origin: null })).status).toBe(403);
    expect((await put({ text: TEXT, baseHash: HASH }, { origin: 'https://evil.test' })).status).toBe(403);
    expect(
      (await send('/api/v1/workflows/check', { method: 'POST', origin: null, ...json({ text: 'x' }) }))
        .status,
    ).toBe(403);
    expect((await put({ text: TEXT, baseHash: HASH }, { auth: false })).status).toBe(401);
    expect((await send(`/api/v1/workflows/${ID}/source`, { auth: false })).status).toBe(401);
    expect(saves).toEqual([]);
    expect(checks).toEqual([]);
  });

  it('looks up no id of the wrong shape', async () => {
    await start();
    for (const id of ['..', 'A'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), '%2e%2e', 'g'.repeat(32)]) {
      const answer = await send(`/api/v1/workflows/${id}/source`);
      expect([404, 405]).toContain(answer.status);
    }
    expect(reads).toEqual([]);
  });

  it('refuses a body of the wrong type, size or shape before the store sees it', async () => {
    await start();
    const big = 'x'.repeat(MAX_SOURCE_BYTES + 1);
    // Each of these is three bytes in UTF-8: the limit counts bytes, not characters.
    const wide = '€'.repeat(Math.floor(MAX_SOURCE_BYTES / 3) + 1);
    const cases: [Parameters<typeof send>[1], number][] = [
      [{ body: 'text=x', type: 'text/plain' }, 415],
      [{ body: 'x'.repeat(MAX_SOURCE_BODY_BYTES + 1), type: 'application/json' }, 413],
      [{ body: '{"text":', type: 'application/json' }, 400],
      [json({ baseHash: HASH }), 400],
      [json({ text: 7, baseHash: HASH }), 400],
      [json({ text: TEXT }), 400],
      [json({ text: TEXT, baseHash: 'not hex' }), 400],
      [json({ text: TEXT, baseHash: HASH.toUpperCase() }), 400],
      [json({ text: big, baseHash: HASH }), 413],
      [json({ text: wide, baseHash: HASH }), 413],
    ];
    for (const [options, status] of cases) {
      const answer = await send(`/api/v1/workflows/${ID}/source`, { method: 'PUT', ...options });
      expect(answer.status).toBe(status);
    }
    expect((await send('/api/v1/workflows/check', { method: 'POST', ...json({ text: 3 }) })).status).toBe(
      400,
    );
    expect((await send('/api/v1/workflows/check', { method: 'POST', ...json({ text: big }) })).status).toBe(
      413,
    );
    expect(saves).toEqual([]);
    expect(checks).toEqual([]);
  });

  it('logs no text of a workflow', async () => {
    await start();
    const secret = ['very', 'private', 'workflow', 'text'].join('-');
    await put({ text: secret, baseHash: HASH });
    refusal = new WorkflowStoreError('not_saved', secret);
    await put({ text: secret, baseHash: HASH });
    await send('/api/v1/workflows/check', { method: 'POST', ...json({ text: secret }) });
    expect(JSON.stringify(logged)).not.toContain(secret);
  });

  it('names the methods each source address takes', async () => {
    await start();
    const del = await send(`/api/v1/workflows/${ID}/source`, { method: 'DELETE' });
    expect(del.status).toBe(405);
    expect(del.allow).toBe('GET, PUT');
    const getCheck = await send('/api/v1/workflows/check');
    expect(getCheck.status).toBe(405);
    expect(getCheck.allow).toBe('POST');
  });
});
