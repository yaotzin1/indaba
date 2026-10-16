import { appendFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RunRecord, serializeRecord } from '@indaba/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, type ServerHandle, startServer } from '../src/index.js';

const TOKEN = ['fixture', 'x'.repeat(16)].join('_');
const TRACE = 'a'.repeat(32);
const RUN = 'b'.repeat(32);
const SECOND_RUN = 'c'.repeat(32);
const ROOT_SPAN = 'r'.repeat(16);
const STEP_SPAN = 's'.repeat(16);
const T = (n: number): string => new Date(Date.UTC(2026, 9, 5, 12, 0, n)).toISOString();

type Record_ = Exclude<RunRecord, { type: 'unknown' }>;

const rootStart: Record_ = {
  type: 'span_started',
  at: T(0),
  traceId: TRACE,
  spanId: ROOT_SPAN,
  parentSpanId: undefined,
  name: 'indaba.task demo',
  attributes: { 'indaba.task.id': 'task-1', 'indaba.workflow.name': 'demo' },
};
const stepStart: Record_ = {
  type: 'span_started',
  at: T(1),
  traceId: TRACE,
  spanId: STEP_SPAN,
  parentSpanId: ROOT_SPAN,
  name: 'step build',
  attributes: { 'indaba.step.id': 'build' },
};
const running: Record_ = {
  type: 'step_status',
  at: T(1),
  traceId: TRACE,
  taskId: 'task-1',
  stepId: 'build',
  from: 'PENDING',
  to: 'RUNNING',
  reason: undefined,
};
const output = (text: string, seq = 0): Record_ => ({
  type: 'output',
  at: T(2),
  traceId: TRACE,
  spanId: STEP_SPAN,
  seq,
  text,
  cut: false,
});
const completed: Record_ = { ...running, at: T(3), from: 'RUNNING', to: 'COMPLETED' };
const rootEnd: Record_ = {
  type: 'span_ended',
  at: T(4),
  traceId: TRACE,
  spanId: ROOT_SPAN,
  status: 'ok',
  statusMessage: undefined,
  attributes: { 'indaba.workflow.status': 'COMPLETED' },
  events: [],
};

const lines = (records: readonly Record_[]): string => records.map((r) => `${serializeRecord(r)}\n`).join('');

let root: string;
let site: string;
let server: ServerHandle | undefined;

const traceFile = (id: string): string => join(root, '.indaba', 'traces', `${id}.events.jsonl`);

async function start(extra: Partial<Parameters<typeof startServer>[0]> = {}): Promise<ServerHandle> {
  server = await startServer({
    roots: [root],
    staticDir: site,
    token: TOKEN,
    pollMs: 10,
    coalesceMs: 5,
    ...extra,
  });
  return server;
}

const auth = { Authorization: `Bearer ${TOKEN}` };
const get = (path: string, headers: Record<string, string> = auth): Promise<Response> =>
  fetch(`http://127.0.0.1:${server?.port}${path}`, { headers });

/** A request with a `Host` of its own choosing, which `fetch` forbids. */
function raw(
  method: string,
  path: string,
  host: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: server?.port, method, path, headers: { Host: host, ...headers } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Reads a stream until `done` says so, returning the events it saw as `{ id, event, data }`. */
async function readEvents(
  response: Response,
  done: (events: ParsedEvent[]) => boolean,
): Promise<ParsedEvent[]> {
  const events: ParsedEvent[] = [];
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return events;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  const timeout = setTimeout(() => void reader.cancel(), 5000);
  try {
    for (;;) {
      const { value, done: finished } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (finished) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const parsed = parseFrame(frame);
        if (parsed !== undefined) {
          events.push(parsed);
        }
      }
      if (done(events)) {
        break;
      }
    }
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => undefined);
  }
  return events;
}

interface ParsedEvent {
  readonly id: number | undefined;
  readonly event: string;
  readonly data: unknown;
}

function parseFrame(frame: string): ParsedEvent | undefined {
  let id: number | undefined;
  let event = 'message';
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('id: ')) {
      id = Number(line.slice(4));
    } else if (line.startsWith('event: ')) {
      event = line.slice(7);
    } else if (line.startsWith('data: ')) {
      data += line.slice(6);
    }
  }
  return data === '' && event === 'message'
    ? undefined
    : { id, event, data: data === '' ? undefined : JSON.parse(data) };
}

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'indaba-server-'));
  root = join(base, 'project');
  site = join(base, 'site');
  await mkdir(join(root, '.indaba', 'traces'), { recursive: true });
  await mkdir(site, { recursive: true });
  await writeFile(join(site, 'index.html'), '<!doctype html><title>Indaba</title>');
  await writeFile(join(site, 'app.js'), 'console.log(1);');
  await writeFile(join(base, 'secret.txt'), 'outside the site');
  await writeFile(
    traceFile(RUN),
    lines([
      rootStart,
      stepStart,
      running,
      output('hello\n'),
      output('\u001b[31mred\u001b[0m\u001b[2J line\n', 1),
      completed,
      rootEnd,
    ]),
  );
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(join(root, '..'), { recursive: true, force: true });
});

describe('the address', () => {
  it('puts the token in the fragment, and a different token at each start', async () => {
    const first = await startServer({ roots: [root], staticDir: site });
    const second = await startServer({ roots: [root], staticDir: site });
    try {
      expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#token=[A-Za-z0-9_-]{43}$/);
      expect(first.url.split('#token=')[1]).not.toBe(second.url.split('#token=')[1]);
    } finally {
      await first.close();
      await second.close();
    }
  });
});

describe('the files of the page', () => {
  it('are served without the token, with the policy of AC-16', async () => {
    await start();
    const response = await get('/', {});
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>Indaba</title>');
    const policy = response.headers.get('content-security-policy') ?? '';
    expect(policy).toContain("script-src 'self'");
    expect(policy.split('; ').find((part) => part.startsWith('script-src'))).toBe("script-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await get('/app.js', {})).headers.get('content-type')).toContain('javascript');
  });

  it('give a client-side route the page, and a missing file a 404', async () => {
    await start();
    expect(await (await get('/runs/abc', {})).text()).toContain('<title>Indaba</title>');
    expect((await get('/missing.js', {})).status).toBe(404);
  });

  it('never leave their folder', async () => {
    await start();
    for (const path of [
      '/%2e%2e/secret.txt',
      '/..%2fsecret.txt',
      '/..%5csecret.txt',
      '/a/%2e%2e/%2e%2e/secret.txt',
      '/%00',
    ]) {
      const response = await get(path, {});
      expect(await response.text()).not.toContain('outside the site');
      expect([200, 404]).toContain(response.status);
    }
    expect((await raw('GET', '/../secret.txt', `127.0.0.1:${server?.port}`)).body).not.toContain(
      'outside the site',
    );
  });

  it('do not follow a symbolic link', async () => {
    await start();
    try {
      await symlink(join(root, '..', 'secret.txt'), join(site, 'link.txt'));
    } catch {
      return; // no permission to make a link on this machine; nothing to test
    }
    const response = await get('/link.txt', {});
    expect(await response.text()).not.toContain('outside the site');
  });
});

describe('the checks on every request', () => {
  it('refuse the API without the token, and with a wrong one', async () => {
    await start();
    expect((await get('/api/v1/contract', {})).status).toBe(401);
    expect((await get('/api/v1/contract', { Authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await get('/api/v1/contract', { Authorization: TOKEN })).status).toBe(401);
    expect((await get('/api/v1/runs', {})).status).toBe(401);
    const refused = await (await get('/api/v1/runs', {})).json();
    expect(refused).toMatchObject({ code: 'unauthorized' });
    expect(JSON.stringify(refused)).not.toContain(TOKEN);
  });

  it('answer the contract version with the token', async () => {
    await start();
    const response = await get('/api/v1/contract');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ contractVersion: CONTRACT_VERSION });
  });

  it('refuse a Host that is not the server', async () => {
    await start();
    const port = server?.port ?? 0;
    for (const host of [
      'evil.example',
      `evil.example:${port}`,
      'localhost',
      '127.0.0.1',
      `localhost:${port + 1}`,
    ]) {
      expect((await raw('GET', '/api/v1/contract', host, auth)).status).toBe(421);
      expect((await raw('GET', '/', host)).status).toBe(421);
    }
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, `LOCALHOST:${port}`]) {
      expect((await raw('GET', '/api/v1/contract', host, auth)).status).toBe(200);
    }
  });

  it('are refused by the parser when they carry no Host at all', async () => {
    await start();
    const answer = await new Promise<string>((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: server?.port ?? 0 }, () => {
        socket.write(
          `GET /api/v1/contract HTTP/1.1\r\nAuthorization: Bearer ${TOKEN}\r\nConnection: close\r\n\r\n`,
        );
      });
      let body = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        body += chunk;
      });
      socket.on('end', () => resolve(body));
      socket.on('error', reject);
    });
    expect(answer).toMatch(/^HTTP\/1\.1 400/);
    expect(answer).not.toContain('contractVersion');
  });

  it('serve only GET', async () => {
    await start();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const result = await raw(method, '/api/v1/runs', `127.0.0.1:${server?.port}`, auth);
      expect(result.status).toBe(405);
    }
    expect((await raw('POST', '/', `127.0.0.1:${server?.port}`)).status).toBe(405);
  });

  it('send no CORS header', async () => {
    await start();
    const response = await get('/api/v1/contract', { ...auth, Origin: 'http://evil.example' });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answer an address that is not valid, and one that is unknown', async () => {
    await start();
    expect((await get('/api/v1/nothing')).status).toBe(404);
    expect((await get(`/api/v1/runs/${RUN}/nothing`)).status).toBe(404);
    expect((await get('/api/v1/events/extra')).status).toBe(404);
  });
});

describe('the runs', () => {
  it('list the runs of the roots', async () => {
    await start();
    const body = (await (await get('/api/v1/runs')).json()) as {
      runs: { runId: string; status: string; workflow: string }[];
    };
    expect(body.runs).toEqual([
      expect.objectContaining({ runId: RUN, status: 'completed', workflow: 'demo' }),
    ]);
  });

  it('list a run once when two roots hold it', async () => {
    await start({ roots: [root, root] });
    const body = (await (await get('/api/v1/runs')).json()) as { runs: unknown[] };
    expect(body.runs).toHaveLength(1);
  });

  it('read one run as a snapshot without the reducer bookkeeping, with its text cleaned', async () => {
    await start();
    const body = (await (await get(`/api/v1/runs/${RUN}`)).json()) as {
      run: Record<string, unknown> & { steps: { id: string; status: string; output: string[] }[] };
    };
    expect(body.run).not.toHaveProperty('owners');
    expect(body.run).toMatchObject({ workflow: 'demo', status: 'completed' });
    const step = body.run.steps.find((s) => s.id === 'build');
    expect(step?.status).toBe('COMPLETED');
    expect(step?.output.join('\n')).toContain('hello');
    const text = JSON.stringify(body);
    expect(text).not.toContain('\\u001b');
    expect(text).toContain('red');
  });

  it('answer 404 for a run that is not there, with the same words for every id', async () => {
    await start();
    const unknown = await get(`/api/v1/runs/${'d'.repeat(32)}`);
    const hostile = await get('/api/v1/runs/..%2f..%2fsecret');
    const uppercase = await get(`/api/v1/runs/${'B'.repeat(32)}`);
    expect([unknown.status, hostile.status, uppercase.status]).toEqual([404, 404, 404]);
    expect(await unknown.json()).toEqual(await hostile.json());
  });

  it('serve the log of a step, and refuse a step id that is not one', async () => {
    await start();
    const log = await get(`/api/v1/runs/${RUN}/steps/build/log`);
    expect(log.status).toBe(200);
    expect(log.headers.get('content-type')).toContain('text/plain');
    expect(await log.text()).toContain('hello');
    for (const id of ['missing', '..%2f..%2fsecret', 'a%00b', 'x'.repeat(200)]) {
      expect((await get(`/api/v1/runs/${RUN}/steps/${id}/log`)).status).toBe(404);
    }
  });

  it('survive a run file that is still being written', async () => {
    await writeFile(traceFile(SECOND_RUN), `${lines([rootStart, stepStart])}{"type":"output","at":"x`);
    await start();
    const response = await get(`/api/v1/runs/${SECOND_RUN}`);
    expect(response.status).toBe(200);
  });
});

describe('the stream of a run', () => {
  it('sends a snapshot and ends, for a run that is over', async () => {
    await start();
    const response = await get(`/api/v1/runs/${RUN}/events`);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const events = await readEvents(response, (seen) => seen.some((e) => e.event === 'end'));
    expect(events.map((e) => e.event)).toEqual(['snapshot', 'end']);
    expect(events[0]?.id).toBe(7);
    expect(events[0]?.data).toMatchObject({ id: 7, run: { status: 'completed' } });
  });

  it('sends nothing it has already sent when it resumes', async () => {
    await start();
    const response = await get(`/api/v1/runs/${RUN}/events`, { ...auth, 'Last-Event-ID': '7' });
    const events = await readEvents(response, (seen) => seen.some((e) => e.event === 'end'));
    expect(events.map((e) => e.event)).toEqual(['end']);
  });

  it('sends the whole state again when the id it resumes from is behind', async () => {
    await start();
    const response = await get(`/api/v1/runs/${RUN}/events`, { ...auth, 'Last-Event-ID': '3' });
    const events = await readEvents(response, (seen) => seen.some((e) => e.event === 'end'));
    expect(events.map((e) => e.event)).toEqual(['snapshot', 'end']);
    expect(events[0]?.id).toBe(7);
  });

  it('treats an id that is not a number as none', async () => {
    await start();
    const response = await get(`/api/v1/runs/${RUN}/events`, { ...auth, 'Last-Event-ID': 'nonsense' });
    const events = await readEvents(response, (seen) => seen.some((e) => e.event === 'end'));
    expect(events.map((e) => e.event)).toEqual(['snapshot', 'end']);
  });

  it('follows a run as it is written, with ids that only rise, and ends with it', async () => {
    await writeFile(traceFile(SECOND_RUN), lines([rootStart, stepStart, running]));
    await start();
    const response = await get(`/api/v1/runs/${SECOND_RUN}/events`);
    const seen: ParsedEvent[] = [];
    const reading = readEvents(response, (events) => {
      seen.splice(0, seen.length, ...events);
      return events.some((e) => e.event === 'end');
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    await appendFile(traceFile(SECOND_RUN), lines([output('later\n'), completed]));
    await new Promise((resolve) => setTimeout(resolve, 80));
    await appendFile(traceFile(SECOND_RUN), lines([rootEnd]));
    const events = await reading;
    const snapshots = events.filter((e) => e.event === 'snapshot');
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    const ids = snapshots.map((e) => e.id ?? 0);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
    expect(events.at(-1)?.event).toBe('end');
    expect(snapshots.at(-1)?.data).toMatchObject({ run: { status: 'completed' } });
  });

  it('stops following when the page goes away', async () => {
    await writeFile(traceFile(SECOND_RUN), lines([rootStart, stepStart, running]));
    await start();
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${server?.port}/api/v1/runs/${SECOND_RUN}/events`, {
      headers: auth,
      signal: controller.signal,
    });
    await readEvents(response, (events) => events.length > 0);
    controller.abort();
    await server?.close();
    server = undefined;
  });
});

describe('the stream of the server', () => {
  it('announces a run that appears and one that ends', async () => {
    await start();
    const response = await get('/api/v1/events');
    const reading = readEvents(response, (events) => events.filter((e) => e.event === 'run').length >= 3);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await writeFile(traceFile(SECOND_RUN), lines([rootStart, stepStart, running]));
    await new Promise((resolve) => setTimeout(resolve, 80));
    await appendFile(traceFile(SECOND_RUN), lines([completed, rootEnd]));
    const events = await reading;
    const kinds = events.filter((e) => e.event === 'run').map((e) => (e.data as { kind: string }).kind);
    expect(kinds).toEqual(['run_started', 'run_ended']);
    const ids = events.map((e) => e.id);
    expect(ids).toEqual([1, 2]);
  }, 10000);

  it('ends its streams when the server closes', async () => {
    await start();
    const response = await get('/api/v1/events');
    const reading = readEvents(response, () => false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await server?.close();
    server = undefined;
    expect(await reading).toEqual([]);
  });
});
