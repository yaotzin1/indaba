import { describe, expect, it } from 'vitest';
import { createClient } from '../src/client.js';

/** specs/web-app-registry, T-07: the calls of the Workflows screen, over a fetch that is a fake. */

const TOKEN = ['test', 'token', '0123456789'].join('-');

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
  readonly authorized: boolean;
  readonly typed: boolean;
}

function fakeFetch(replies: Response[]): { readonly fetch: typeof fetch; readonly calls: Call[] } {
  const calls: Call[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      authorized: headers.Authorization === `Bearer ${TOKEN}`,
      typed: headers['Content-Type'] === 'application/json',
    });
    const reply = replies.shift();
    if (reply === undefined) {
      throw new TypeError('no reply');
    }
    return reply;
  };
  return { fetch: fn as typeof fetch, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ID = '3f2a9c1d0b7e4a65';
const ROOT = 'a1b2c3d4e5f60718';

const entry = {
  id: ID,
  name: 'site',
  project: 'blog',
  tags: ['a'],
  hidden: false,
  path: 'site.workflow.ai.yml',
  rootId: ROOT,
  origin: 'scanned',
  validation: { state: 'valid' },
  removable: false,
};
const root = { id: ROOT, name: 'blog', folder: '/work/blog', readable: true };
const report = {
  rootId: ROOT,
  found: 2,
  added: 1,
  changed: 0,
  moved: 0,
  missing: 0,
  invalid: 0,
  truncated: false,
  recovered: false,
};

describe('reading the registry', () => {
  it('reads the entries and the folders', async () => {
    const replies = fakeFetch([json({ entries: [entry], roots: [root], truncated: false })]);
    const client = createClient({ token: TOKEN, fetch: replies.fetch });
    expect(await client.registry()).toEqual({ entries: [entry], roots: [root], truncated: false });
    expect(replies.calls).toEqual([
      { url: '/api/v1/registry', method: 'GET', body: undefined, authorized: true, typed: false },
    ]);
  });

  it('says undefined when the server does not offer it', async () => {
    const replies = fakeFetch([json({ code: 'registry_unavailable', message: 'm' }, 404)]);
    expect(await createClient({ token: TOKEN, fetch: replies.fetch }).registry()).toBeUndefined();
  });

  it('refuses a list it cannot read, whatever is wrong with it', async () => {
    for (const bad of [
      { entries: 'x', roots: [], truncated: false },
      { entries: [{ ...entry, tags: 'a' }], roots: [], truncated: false },
      { entries: [{ ...entry, origin: 'invented' }], roots: [], truncated: false },
      { entries: [{ ...entry, validation: { state: 'invalid' } }], roots: [], truncated: false },
      { entries: [{ ...entry, validation: 'valid' }], roots: [], truncated: false },
      { entries: [entry], roots: [{ ...root, readable: 'yes' }], truncated: false },
      { entries: [entry], roots: [], truncated: 'no' },
      { entries: [{ ...entry, lastRun: { runId: 1 } }], roots: [], truncated: false },
    ]) {
      const replies = fakeFetch([json(bad)]);
      await expect(createClient({ token: TOKEN, fetch: replies.fetch }).registry()).rejects.toMatchObject({
        failure: { kind: 'server' },
      });
    }
  });

  it('reads the three kinds of validation', async () => {
    const entries = [
      entry,
      { ...entry, id: 'b'.repeat(16), validation: { state: 'invalid', message: 'm' } },
      { ...entry, id: 'c'.repeat(16), validation: { state: 'missing', reason: 'r' } },
    ];
    const replies = fakeFetch([json({ entries, roots: [root], truncated: true })]);
    const read = await createClient({ token: TOKEN, fetch: replies.fetch }).registry();
    expect(read?.entries.map((e) => e.validation.state)).toEqual(['valid', 'invalid', 'missing']);
    expect(read?.truncated).toBe(true);
  });
});

describe('changing the registry', () => {
  it('scans', async () => {
    const replies = fakeFetch([json({ reports: [report] }), json({ reports: [{ ...report, found: -1 }] })]);
    const client = createClient({ token: TOKEN, fetch: replies.fetch });
    expect(await client.scanRegistry()).toEqual({ kind: 'ok', value: { reports: [report] } });
    expect(replies.calls[0]).toMatchObject({ url: '/api/v1/registry/scan', method: 'POST', body: undefined });
    expect(await client.scanRegistry()).toEqual({ kind: 'refused', code: 'other' });
  });

  it('annotates by id, sending exactly the request', async () => {
    const replies = fakeFetch([json({ ...entry, name: 'N' })]);
    const client = createClient({ token: TOKEN, fetch: replies.fetch });
    const answer = await client.annotateEntry(ID, { name: 'N', project: null });
    expect(answer).toMatchObject({ kind: 'ok', value: { name: 'N' } });
    expect(replies.calls[0]).toEqual({
      url: `/api/v1/registry/${ID}/annotate`,
      method: 'POST',
      body: { name: 'N', project: null },
      authorized: true,
      typed: true,
    });
  });

  it('copies into a folder by its id', async () => {
    const replies = fakeFetch([json({ entry: { ...entry, origin: 'copied' }, toReview: ['name: site'] })]);
    const answer = await createClient({ token: TOKEN, fetch: replies.fetch }).copyEntry(ID, {
      rootId: ROOT,
      name: 'site-2',
    });
    expect(answer).toMatchObject({ kind: 'ok', value: { toReview: ['name: site'] } });
    expect(replies.calls[0]).toMatchObject({
      url: `/api/v1/registry/${ID}/copy`,
      body: { rootId: ROOT, name: 'site-2' },
    });
  });

  it('removes: an empty 204 is the answer', async () => {
    const replies = fakeFetch([new Response(null, { status: 204 })]);
    expect(await createClient({ token: TOKEN, fetch: replies.fetch }).removeEntry(ID)).toEqual({
      kind: 'ok',
      value: null,
    });
    expect(replies.calls[0]).toMatchObject({ url: `/api/v1/registry/${ID}/remove`, method: 'POST' });
  });

  it('resolves a typed path, then adds the folder it showed', async () => {
    const replies = fakeFetch([
      json({ folder: '/work/other', name: 'other', alreadyCovered: false, found: 2, atLeast: false }),
      json({ root: { ...root, folder: '/work/other' }, alreadyCovered: false, report }),
    ]);
    const client = createClient({ token: TOKEN, fetch: replies.fetch });
    expect(await client.resolveFolder('../other')).toEqual({
      kind: 'ok',
      value: { folder: '/work/other', name: 'other', alreadyCovered: false, found: 2, atLeast: false },
    });
    const added = await client.addFolder('/work/other');
    expect(added).toMatchObject({ kind: 'ok', value: { alreadyCovered: false, report: { found: 2 } } });
    expect(replies.calls.map((c) => [c.url, c.body])).toEqual([
      ['/api/v1/registry/roots/resolve', { path: '../other' }],
      ['/api/v1/registry/roots', { folder: '/work/other' }],
    ]);
  });

  it('turns every refusal into its code, and a missing control into unavailable', async () => {
    const replies = fakeFetch([
      json({ code: 'not_found', message: 'm' }, 404),
      json({ code: 'exists', message: 'm' }, 409),
      json({ code: 'would_return', message: 'm' }, 409),
      json({ code: 'not_a_folder', message: 'm' }, 422),
      json({ code: 'registry_unavailable', message: 'm' }, 404),
      json({ code: 'method_not_allowed', message: 'm' }, 405),
      json('nonsense', 500),
    ]);
    const client = createClient({ token: TOKEN, fetch: replies.fetch });
    expect(await client.annotateEntry(ID, { hidden: true })).toEqual({ kind: 'refused', code: 'not_found' });
    expect(await client.copyEntry(ID, { rootId: ROOT })).toEqual({ kind: 'refused', code: 'exists' });
    expect(await client.removeEntry(ID)).toEqual({ kind: 'refused', code: 'would_return' });
    expect(await client.resolveFolder('/x')).toEqual({ kind: 'refused', code: 'not_a_folder' });
    expect(await client.addFolder('/x')).toMatchObject({ kind: 'unavailable' });
    expect(await client.scanRegistry()).toMatchObject({ kind: 'unavailable' });
    expect(await client.removeEntry(ID)).toEqual({ kind: 'refused', code: 'other' });
  });

  it('puts a missing token and a stopped server where the page already handles them', async () => {
    const client = createClient({
      token: TOKEN,
      fetch: fakeFetch([json({ code: 'unauthorized', message: 'm' }, 401)]).fetch,
    });
    await expect(client.removeEntry(ID)).rejects.toMatchObject({ failure: { kind: 'unauthorized' } });
    const down = createClient({ token: TOKEN, fetch: fakeFetch([]).fetch });
    await expect(down.scanRegistry()).rejects.toMatchObject({ failure: { kind: 'unreachable' } });
  });

  it('encodes an id it is given, so it cannot reach another address', async () => {
    const replies = fakeFetch([new Response(null, { status: 204 })]);
    await createClient({ token: TOKEN, fetch: replies.fetch }).removeEntry('a/../b');
    expect(replies.calls[0]?.url).toBe('/api/v1/registry/a%2F..%2Fb/remove');
  });
});
