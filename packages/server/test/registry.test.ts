import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLogger,
  type LogRecord,
  type RegistryAddRootRequest,
  type RegistryAnnotateRequest,
  type RegistryCopyRequest,
  type RegistryEntryView,
  type RegistryListResponse,
  type RegistryResolveRootRequest,
} from '@indaba/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  type RegistryControl,
  RegistryControlError,
  type ServerHandle,
  startServer,
} from '../src/index.js';

/** specs/web-app-registry, T-02 and T-03: the registry resources over a control that is a fake. */

const TOKEN = ['registry', 'r'.repeat(24)].join('_');
const ID = '3f2a9c1d0b7e4a65';
const ROOT = 'a1b2c3d4e5f60718';

const entry: RegistryEntryView = {
  id: ID,
  name: 'site',
  project: 'blog',
  tags: [],
  hidden: false,
  path: 'site.workflow.ai.yml',
  rootId: ROOT,
  origin: 'scanned',
  validation: { state: 'valid' },
  removable: false,
};

const list: RegistryListResponse = {
  entries: [entry],
  roots: [{ id: ROOT, name: 'blog', folder: '/work/blog', readable: true }],
  truncated: false,
};

/** What the fake was asked: every body field that reached it is recorded here and nowhere else. */
interface Calls {
  annotate: { id: string; request: RegistryAnnotateRequest }[];
  copy: { id: string; request: RegistryCopyRequest }[];
  remove: string[];
  resolve: RegistryResolveRootRequest[];
  add: RegistryAddRootRequest[];
  scans: number;
}

let base: string;
let site: string;
let server: ServerHandle | undefined;
let logged: LogRecord[];
let calls: Calls;
let refusal: Error | undefined;

function fakeControl(): RegistryControl {
  const maybeRefuse = (): void => {
    if (refusal !== undefined) {
      throw refusal;
    }
  };
  return {
    list: async () => list,
    scan: async () => {
      calls.scans += 1;
      maybeRefuse();
      return {
        reports: [
          {
            rootId: ROOT,
            found: 3,
            added: 1,
            changed: 0,
            moved: 0,
            missing: 0,
            invalid: 0,
            truncated: false,
            recovered: false,
          },
        ],
      };
    },
    annotate: async (id, req) => {
      calls.annotate.push({ id, request: req });
      maybeRefuse();
      return { ...entry, name: req.name ?? entry.name };
    },
    copy: async (id, req) => {
      calls.copy.push({ id, request: req });
      maybeRefuse();
      return {
        entry: { ...entry, id: 'b'.repeat(16), origin: 'copied', copiedFrom: id },
        toReview: ['name: site'],
      };
    },
    remove: async (id) => {
      calls.remove.push(id);
      maybeRefuse();
    },
    resolveRoot: async (req) => {
      calls.resolve.push(req);
      maybeRefuse();
      return { folder: '/work/other', name: 'other', alreadyCovered: false, found: 2, atLeast: false };
    },
    addRoot: async (req) => {
      calls.add.push(req);
      maybeRefuse();
      return {
        root: { id: 'c'.repeat(16), name: 'other', folder: req.folder, readable: true },
        alreadyCovered: false,
        report: {
          rootId: 'c'.repeat(16),
          found: 2,
          added: 2,
          changed: 0,
          moved: 0,
          missing: 0,
          invalid: 0,
          truncated: false,
          recovered: false,
        },
      };
    },
  };
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'indaba-registry-'));
  site = join(base, 'site');
  await rm(site, { recursive: true, force: true });
  const { mkdir } = await import('node:fs/promises');
  await mkdir(site, { recursive: true });
  await writeFile(join(site, 'index.html'), '<!doctype html>');
  logged = [];
  calls = { annotate: [], copy: [], remove: [], resolve: [], add: [], scans: 0 };
  refusal = undefined;
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(base, { recursive: true, force: true });
});

async function start(withRegistry = true): Promise<ServerHandle> {
  server = await startServer({
    roots: [base],
    staticDir: site,
    token: TOKEN,
    logger: createLogger({
      sinks: [{ write: (record) => logged.push(record) }],
      clock: () => new Date('2026-10-24T12:00:00.000Z'),
      level: 'debug',
    }),
    ...(withRegistry ? { registry: fakeControl() } : {}),
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
  readonly origin?: string | null;
  readonly auth?: boolean;
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
          let body: unknown = text;
          try {
            body = JSON.parse(text);
          } catch {
            // not JSON (a 204 has no body)
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
const annotate = (value: unknown) => post(`/api/v1/registry/${ID}/annotate`, json(value));

describe('the registry resources over HTTP', () => {
  it('says the contract version 1.6.0', async () => {
    await start();
    expect(CONTRACT_VERSION).toBe('1.6.0');
    expect((await send('/api/v1/contract')).body).toEqual({ contractVersion: '1.6.0' });
  });

  it('lists the entries and the folders, hidden and missing ones included', async () => {
    await start();
    const answer = await send('/api/v1/registry');
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(list);
  });

  it('scans on request and logs the counts, not a name', async () => {
    await start();
    const answer = await post('/api/v1/registry/scan');
    expect(answer.status).toBe(200);
    expect(calls.scans).toBe(1);
    expect(logged.some((r) => r.message === 'scanned' && r.fields?.found === 3)).toBe(true);
  });

  it('answers 404 to a read, and 405 to a write, when no control was supplied', async () => {
    await start(false);
    const read = await send('/api/v1/registry');
    expect(read.status).toBe(404);
    expect(read.body).toMatchObject({ code: 'registry_unavailable' });
    const write = await post('/api/v1/registry/scan');
    expect(write.status).toBe(405);
    expect(write.allow).toBe('GET');
  });

  it('allows only the method each address takes', async () => {
    await start();
    const wrongOnList = await post('/api/v1/registry', json({}));
    expect(wrongOnList.status).toBe(405);
    expect(wrongOnList.allow).toBe('GET');
    for (const path of [
      '/api/v1/registry/scan',
      `/api/v1/registry/${ID}/annotate`,
      '/api/v1/registry/roots',
    ]) {
      const wrong = await send(path);
      expect(wrong.status, path).toBe(405);
      expect(wrong.allow, path).toBe('POST');
    }
  });

  it('needs the token, a same-origin Origin on a write, and JSON', async () => {
    await start();
    expect((await send('/api/v1/registry', { auth: false })).status).toBe(401);
    expect((await post('/api/v1/registry/scan', { auth: false })).status).toBe(401);
    expect((await post('/api/v1/registry/scan', { origin: null })).status).toBe(403);
    expect((await post('/api/v1/registry/scan', { origin: 'http://evil.example' })).status).toBe(403);
    expect((await post(`/api/v1/registry/${ID}/annotate`, { body: '{}', type: 'text/plain' })).status).toBe(
      415,
    );
    expect(calls.scans).toBe(0);
    expect(calls.annotate).toEqual([]);
  });

  describe('annotate', () => {
    it('passes only the four members, trimmed, and ignores the rest (a path, an id)', async () => {
      await start();
      const answer = await annotate({
        name: '  My site  ',
        project: null,
        tags: ['a', ' b ', 'a'],
        hidden: true,
        path: '/etc/passwd',
        id: 'x',
      });
      expect(answer.status).toBe(200);
      expect(calls.annotate).toEqual([
        { id: ID, request: { name: 'My site', project: null, tags: ['a', 'b'], hidden: true } },
      ]);
    });

    it.each([
      ['not an object', []],
      ['nothing to change', {}],
      ['an empty name', { name: '   ' }],
      ['a name that is not text', { name: 4 }],
      ['a name with a control character', { name: `a${String.fromCharCode(27)}b` }],
      ['a name that is too long', { name: 'n'.repeat(121) }],
      ['a project that is too long', { project: 'p'.repeat(121) }],
      ['tags that are not a list', { tags: 'a' }],
      ['too many tags', { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }],
      ['a tag that is not text', { tags: [1] }],
      ['an empty tag', { tags: [' '] }],
      ['a tag that is too long', { tags: ['t'.repeat(41)] }],
      ['hidden that is not a boolean', { hidden: 'yes' }],
    ])('refuses %s with 400 and calls nothing', async (_label, body) => {
      await start();
      const answer = await annotate(body);
      expect(answer.status).toBe(400);
      expect(answer.body).toMatchObject({ code: 'invalid_request' });
      expect(calls.annotate).toEqual([]);
    });

    it('refuses an id that is not exactly 16 lowercase hexadecimal characters', async () => {
      await start();
      for (const id of ['3f2a', ID.toUpperCase(), `${ID}00`, 'zzzzzzzzzzzzzzzz']) {
        const answer = await post(`/api/v1/registry/${id}/annotate`, json({ hidden: true }));
        expect(answer.status, id).toBe(404);
      }
      expect(calls.annotate).toEqual([]);
    });

    it('refuses invalid JSON with 400', async () => {
      await start();
      const answer = await post(`/api/v1/registry/${ID}/annotate`, { body: '{', type: 'application/json' });
      expect(answer.status).toBe(400);
    });

    it('never logs what the person typed', async () => {
      await start();
      await annotate({ name: 'secret-name', tags: ['secret-tag'] });
      expect(JSON.stringify(logged)).not.toContain('secret-');
      expect(logged.some((r) => r.message === 'annotated')).toBe(true);
    });
  });

  describe('copy', () => {
    it('passes a folder id and a file name only', async () => {
      await start();
      const answer = await post(
        `/api/v1/registry/${ID}/copy`,
        json({ rootId: ROOT, name: 'site-2', to: '/tmp' }),
      );
      expect(answer.status).toBe(200);
      expect(calls.copy).toEqual([{ id: ID, request: { rootId: ROOT, name: 'site-2' } }]);
      expect(answer.body).toMatchObject({ toReview: ['name: site'] });
    });

    it('passes no name when none was given', async () => {
      await start();
      await post(`/api/v1/registry/${ID}/copy`, json({ rootId: ROOT }));
      expect(calls.copy).toEqual([{ id: ID, request: { rootId: ROOT } }]);
    });

    it.each([
      ['no folder', {}],
      ['a path as the folder', { rootId: '/work/blog' }],
      ['a folder id of the wrong shape', { rootId: 'ABCDEF0123456789' }],
      ['a name with a folder in it', { rootId: ROOT, name: '../x' }],
      ['a name with an extension of a path', { rootId: ROOT, name: 'a/b' }],
      ['a name that starts with a dot', { rootId: ROOT, name: '.hidden' }],
      ['a name that is too long', { rootId: ROOT, name: 'n'.repeat(81) }],
      ['a name that is not text', { rootId: ROOT, name: 3 }],
    ])('refuses %s with 400', async (_label, body) => {
      await start();
      const answer = await post(`/api/v1/registry/${ID}/copy`, json(body));
      expect(answer.status).toBe(400);
      expect(calls.copy).toEqual([]);
    });
  });

  describe('remove', () => {
    it('answers 204 with no body', async () => {
      await start();
      const answer = await post(`/api/v1/registry/${ID}/remove`);
      expect(answer.status).toBe(204);
      expect(calls.remove).toEqual([ID]);
    });
  });

  describe('importing a folder', () => {
    it('resolves a typed path, then adds the confirmed folder', async () => {
      await start();
      const resolved = await post('/api/v1/registry/roots/resolve', json({ path: '~/work/other', extra: 1 }));
      expect(resolved.status).toBe(200);
      expect(calls.resolve).toEqual([{ path: '~/work/other' }]);
      expect(resolved.body).toMatchObject({ folder: '/work/other', found: 2, atLeast: false });
      expect(calls.add).toEqual([]);
      const added = await post('/api/v1/registry/roots', json({ folder: '/work/other' }));
      expect(added.status).toBe(200);
      expect(calls.add).toEqual([{ folder: '/work/other' }]);
    });

    it.each([
      ['no path', {}],
      ['an empty path', { path: '  ' }],
      ['a path that is not text', { path: 4 }],
      ['a path that is too long', { path: 'p'.repeat(1025) }],
      ['a path with a control character', { path: `a${String.fromCharCode(0)}b` }],
    ])('refuses %s with 400 and resolves nothing', async (_label, body) => {
      await start();
      expect((await post('/api/v1/registry/roots/resolve', json(body))).status).toBe(400);
      expect(calls.resolve).toEqual([]);
    });

    it('refuses an add without a folder', async () => {
      await start();
      expect((await post('/api/v1/registry/roots', json({ path: '/x' }))).status).toBe(400);
      expect(calls.add).toEqual([]);
    });

    it('does not log the typed path', async () => {
      await start();
      await post('/api/v1/registry/roots/resolve', json({ path: '/home/someone/private-folder' }));
      await post('/api/v1/registry/roots', json({ folder: '/home/someone/private-folder' }));
      expect(JSON.stringify(logged)).not.toContain('private-folder');
    });
  });

  describe('refusals of the control', () => {
    it.each([
      ['not_found', 404, `/api/v1/registry/${ID}/remove`, undefined],
      ['would_return', 409, `/api/v1/registry/${ID}/remove`, undefined],
      ['exists', 409, `/api/v1/registry/${ID}/copy`, { rootId: ROOT }],
      ['outside_roots', 422, `/api/v1/registry/${ID}/copy`, { rootId: ROOT }],
      ['not_a_workflow', 422, `/api/v1/registry/${ID}/annotate`, { hidden: true }],
      ['not_a_folder', 422, '/api/v1/registry/roots/resolve', { path: '/x' }],
      ['store_failed', 500, '/api/v1/registry/roots', { folder: '/x' }],
    ])('maps %s to %i with words a person can act on', async (code, status, path, body) => {
      await start();
      refusal = new RegistryControlError(code, 'internal detail /secret/path');
      const answer = await post(path, body === undefined ? {} : json(body));
      expect(answer.status).toBe(status);
      const error = answer.body as { code: string; message: string };
      expect(error.code).toBe(code);
      expect(error.message).not.toContain('/secret/path');
      expect(error.message).not.toMatch(/\b(?:4|5)\d\d\b/);
    });

    it('recognises a refusal from another copy of the package by its name and code', async () => {
      await start();
      const foreign = Object.assign(new Error('x'), { name: 'RegistryControlError', code: 'exists' });
      refusal = foreign;
      expect((await post(`/api/v1/registry/${ID}/copy`, json({ rootId: ROOT }))).status).toBe(409);
    });

    it('does not turn an unexpected failure into a refusal', async () => {
      await start();
      refusal = new Error('disk on fire');
      const answer = await post('/api/v1/registry/scan');
      expect(answer.status).toBe(500);
      expect(JSON.stringify(answer.body)).not.toContain('disk on fire');
    });

    it('does not map a code it does not know', async () => {
      await start();
      refusal = new RegistryControlError('made_up', 'x');
      expect((await post('/api/v1/registry/scan')).status).toBe(500);
    });
  });
});
