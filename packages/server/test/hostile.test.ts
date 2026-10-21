import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RunRecord, serializeRecord } from '@indaba/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ServerHandle, startServer } from '../src/index.js';

/**
 * Task T-12 of specs/web-app: hostile input reaches no path, no response and no log. Every hostile string is built
 * from fragments, so this file carries none of them whole (the security gate reads test files too).
 */

const TOKEN = ['hostile', 'y'.repeat(20)].join('_');
const RUN = 'e'.repeat(32);
const ROOT_SPAN = '1'.repeat(16);
const STEP_SPAN = '2'.repeat(16);
const AT = '2026-10-21T12:00:00.000Z';
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const NUL = String.fromCharCode(0);
const DOTS = ['.', '.'].join('');
/** What lies outside the trace folder; no answer may ever contain it. */
const OUTSIDE = ['outside', 'the', 'traces'].join('-');

type Writable = Exclude<RunRecord, { type: 'unknown' }>;

/** Output an agent might write to attack whoever reads it: terminal escapes, a link escape, markup and a script URL. */
const HOSTILE_OUTPUT = [
  `${ESC}[31mred${ESC}[0m${ESC}[2J cleared`,
  `${ESC}]8;;${['java', 'script:'].join('')}alert(1)${BEL}click me${ESC}]8;;${BEL}`,
  `<${'script'}>alert(1)</${'script'}><img src=x on${'error'}=alert(1)>`,
  `[open](${['java', 'script'].join('')}:alert(1))`,
  `title${ESC}]0;owned${BEL} bell${BEL} back‮spaced`,
].join('\n');

const records: Writable[] = [
  {
    type: 'span_started',
    at: AT,
    traceId: RUN,
    spanId: ROOT_SPAN,
    parentSpanId: undefined,
    name: 'indaba.task hostile',
    attributes: { 'indaba.task.id': 't', 'indaba.workflow.name': `<b>bold</b>${ESC}[1m` },
  },
  {
    type: 'span_started',
    at: AT,
    traceId: RUN,
    spanId: STEP_SPAN,
    parentSpanId: ROOT_SPAN,
    name: 'step agent',
    attributes: {},
  },
  {
    type: 'step_status',
    at: AT,
    traceId: RUN,
    taskId: 't',
    stepId: 'agent',
    from: 'PENDING',
    to: 'FAILED',
    reason: `failed ${ESC}[5mblink${ESC}[0m <i>why</i>`,
  },
  {
    type: 'output',
    at: AT,
    traceId: RUN,
    spanId: STEP_SPAN,
    seq: 0,
    text: `${HOSTILE_OUTPUT}\n`,
    cut: false,
  },
];

let base: string;
let root: string;
let server: ServerHandle;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'indaba-hostile-'));
  root = join(base, 'project');
  const site = join(base, 'site');
  await mkdir(join(root, '.indaba', 'traces'), { recursive: true });
  await mkdir(site, { recursive: true });
  await writeFile(join(site, 'index.html'), '<!doctype html><title>Indaba</title>');
  await writeFile(join(base, 'secret.txt'), OUTSIDE);
  await writeFile(join(root, '.indaba', 'secret.events.jsonl'), OUTSIDE);
  await writeFile(
    join(root, '.indaba', 'traces', `${RUN}.events.jsonl`),
    records.map((r) => `${serializeRecord(r)}\n`).join(''),
  );
  server = await startServer({ roots: [root], staticDir: site, token: TOKEN, pollMs: 10, coalesceMs: 5 });
});

afterEach(async () => {
  await server.close();
  await rm(base, { recursive: true, force: true });
});

const auth = { Authorization: `Bearer ${TOKEN}` };

/** A request sent as written: no normalisation of the path, and any `Host`. */
function send(
  path: string,
  options: { method?: string; host?: string; headers?: Record<string, string>; untilData?: boolean } = {},
): Promise<{ status: number; body: string; type: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: server.port,
        method: options.method ?? 'GET',
        path,
        headers: { Host: options.host ?? `127.0.0.1:${server.port}`, ...(options.headers ?? auth) },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          // a stream never ends on its own: its first frame (or first data, when asked) is the answer
          const frame = options.untilData === true ? /\ndata: .*\n\n/ : /\n\n/;
          if (res.headers['content-type']?.includes('event-stream') === true && frame.test(body)) {
            req.destroy();
            resolve({ status: res.statusCode ?? 0, body, type: String(res.headers['content-type']) });
          }
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body, type: String(res.headers['content-type'] ?? '') }),
        );
      },
    );
    req.on('error', (error) => (req.destroyed ? undefined : reject(error)));
    req.end();
  });
}

/** Run ids and step ids an attacker would try: traversal, separators, a drive letter, encodings, a NUL, length. */
const hostileIds = (): string[] => [
  `${DOTS}%2f${DOTS}%2fsecret`,
  `${DOTS}%5c${DOTS}%5csecret`,
  `%2e%2e%2f%2e%2e%2fsecret`,
  `%252e%252e%252fsecret`,
  `C:%5cWindows`,
  `c%3a${DOTS}`,
  `%00`,
  `${RUN}%00`,
  `${RUN}%2f${DOTS}`,
  `${DOTS}%2f${DOTS}%2f.indaba%2fsecret`,
  encodeURIComponent(`${RUN}${NUL}.json`),
  'E'.repeat(32),
  'e'.repeat(65),
  'x'.repeat(5000),
];

describe('a hostile run id or step id', () => {
  it('is answered 404 by every endpoint, with words that never echo it, and nothing from outside', async () => {
    const answers = new Set<string>();
    for (const id of hostileIds()) {
      for (const path of [
        `/api/v1/runs/${id}`,
        `/api/v1/runs/${id}/events`,
        `/api/v1/runs/${id}/steps/agent/log`,
        `/api/v1/runs/${id}/steps/agent/discussion`,
        `/api/v1/runs/${RUN}/steps/${id}/log`,
        `/api/v1/runs/${RUN}/steps/${id}/discussion`,
      ]) {
        const answer = await send(path);
        expect([404, 414, 431], path).toContain(answer.status);
        expect(answer.body, path).not.toContain(OUTSIDE);
        if (answer.status === 404) {
          expect(answer.type, path).toContain('application/json');
          const parsed = JSON.parse(answer.body) as { code: string; message: string };
          expect(answer.body.toLowerCase(), path).not.toContain(
            decodeURIComponent(id).toLowerCase().slice(0, 12),
          );
          answers.add(parsed.code);
        }
      }
    }
    // The same few words for every id, whatever it held: a missing run, step or discussion.
    expect([...answers].sort()).toEqual(['discussion_not_found', 'run_not_found', 'step_not_found']);
  });

  it('a path the URL parser folds back into the API leads nowhere either', async () => {
    for (const path of [
      `/api/v1/runs/${DOTS}`,
      `/api/v1/runs/${DOTS}/events`,
      `/api/v1/runs/${DOTS}/${DOTS}/${DOTS}/secret.txt`,
      `/api/v1/runs/${RUN}/${DOTS}/${DOTS}/${DOTS}/secret.txt`,
      `/api/v1/runs/${RUN}/steps/%2e%2e/%2e%2e/log`,
      `/api/v1/runs/${RUN}/steps/agent/log/${DOTS}/${DOTS}/${DOTS}/${DOTS}/secret.txt`,
      `/api/v1/${DOTS}/${DOTS}/secret.txt`,
    ]) {
      const answer = await send(path);
      // Folded, these are ordinary addresses: an endpoint of the API or a file of the page, never a file outside.
      expect(answer.body, path).not.toContain(OUTSIDE);
      expect([200, 404], path).toContain(answer.status);
    }
  });
});

describe('a request that is not the page asking', () => {
  it('with another Host, or a name that rebinds to this machine, is refused before anything else', async () => {
    const port = server.port;
    const hosts = [
      'evil.example',
      `evil.example:${port}`,
      `localhost.evil.example:${port}`,
      `127.0.0.1.nip.io:${port}`,
      `127.0.0.1:${port}.evil.example`,
      `127.0.0.1:${port}@evil.example`,
      `0.0.0.0:${port}`,
      `127.1:${port}`,
      `[::ffff:127.0.0.1]:${port}`,
      `localhost:0${port}`,
    ];
    for (const host of hosts) {
      for (const path of ['/api/v1/runs', `/api/v1/runs/${RUN}`, '/', '/index.html']) {
        const answer = await send(path, { host });
        expect(answer.status, `${host} ${path}`).toBeGreaterThanOrEqual(400);
        expect(answer.body).not.toContain('<title>Indaba</title>');
        expect(answer.body).not.toContain(RUN);
      }
    }
  });

  it('without the token, with a wrong one, or with the token anywhere but the header, reads nothing', async () => {
    const wrong = [
      {},
      { Authorization: '' },
      { Authorization: 'Bearer' },
      { Authorization: `bearer ${TOKEN}` },
      { Authorization: `Basic ${TOKEN}` },
      { Authorization: `Bearer ${TOKEN}x` },
      { Authorization: `Bearer ${TOKEN.slice(0, -1)}` },
      { Authorization: `Bearer ${TOKEN},Bearer ${TOKEN}` },
      { Cookie: `token=${TOKEN}` },
    ];
    for (const headers of wrong) {
      for (const path of [
        '/api/v1/runs',
        `/api/v1/runs/${RUN}`,
        `/api/v1/runs/${RUN}/events`,
        '/api/v1/events',
      ]) {
        const answer = await send(path, { headers });
        expect(answer.status, `${JSON.stringify(headers)} ${path}`).toBe(401);
        expect(answer.body).not.toContain(RUN);
        expect(answer.body).not.toContain(TOKEN);
      }
    }
    const inQuery = await send(`/api/v1/runs?token=${TOKEN}`, { headers: {} });
    const inFragmentLikePath = await send(`/api/v1/runs/%23token=${TOKEN}`, { headers: {} });
    expect([inQuery.status, inFragmentLikePath.status]).toEqual([401, 401]);
  });

  it("that writes, even with the token and the server's own Origin, is refused: the server only reads", async () => {
    const own = { ...auth, Origin: `http://127.0.0.1:${server.port}`, 'Content-Type': 'application/json' };
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE']) {
      for (const path of ['/api/v1/runs', `/api/v1/runs/${RUN}`, `/api/v1/runs/${RUN}/stop`, '/']) {
        const answer = await send(path, { method, headers: own });
        expect(answer.status, `${method} ${path}`).toBeGreaterThanOrEqual(400);
        expect(answer.body).not.toContain(RUN);
      }
    }
  });
});

describe('agent output that attacks its reader', () => {
  const escapes = new RegExp(`[${ESC}${BEL}\\u202e]`);

  it('reaches the run, the log and the stream without one escape or control, as inert text', async () => {
    const run = await send(`/api/v1/runs/${RUN}`);
    const parsed = JSON.parse(run.body) as {
      run: { workflow: string; steps: { reason: string; output: string[] }[] };
    };
    const text = JSON.stringify(parsed);
    expect(text).not.toMatch(escapes);
    expect(parsed.run.workflow).toBe('<b>bold</b>');
    expect(parsed.run.steps[0]?.reason).toBe('failed blink <i>why</i>');
    expect(parsed.run.steps[0]?.output.join('\n')).toContain('click me');
    expect(run.type).toContain('application/json');

    const log = await send(`/api/v1/runs/${RUN}/steps/agent/log`);
    expect(log.type).toContain('text/plain');
    expect(log.body).not.toMatch(escapes);
    expect(log.body).toContain('red cleared');

    const stream = await send(`/api/v1/runs/${RUN}/events`, { untilData: true });
    expect(stream.type).toContain('text/event-stream');
    expect(stream.body).not.toMatch(escapes);
    expect(stream.body).toContain('click me');

    const list = await send('/api/v1/runs');
    expect(list.body).not.toMatch(escapes);
  });

  it('is never served with a type a browser would render as a page', async () => {
    for (const path of [`/api/v1/runs/${RUN}`, `/api/v1/runs/${RUN}/steps/agent/log`, '/api/v1/runs']) {
      const answer = await send(path);
      expect(answer.type).not.toContain('html');
    }
  });
});

describe('the server', () => {
  it('writes nothing to a log, whatever it is sent', async () => {
    const out = vi.spyOn(process.stdout, 'write');
    const err = vi.spyOn(process.stderr, 'write');
    const logged = vi.spyOn(console, 'log');
    const errors = vi.spyOn(console, 'error');
    try {
      for (const id of hostileIds()) {
        await send(`/api/v1/runs/${id}`);
        await send(`/api/v1/runs/${RUN}/steps/${id}/log`, { headers: {} });
      }
      await send('/api/v1/runs', { host: 'evil.example' });
      await send(`/api/v1/runs/${RUN}`);
      const calls = [...out.mock.calls, ...err.mock.calls, ...logged.mock.calls, ...errors.mock.calls];
      expect(calls).toEqual([]);
    } finally {
      out.mockRestore();
      err.mockRestore();
      logged.mockRestore();
      errors.mockRestore();
    }
  });
});
