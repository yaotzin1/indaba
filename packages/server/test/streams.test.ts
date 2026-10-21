import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RunRecord, serializeRecord } from '@indaba/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ServerHandle, startServer } from '../src/index.js';

/**
 * Task T-13 of specs/web-app: the server's streams over a run that is still being written, a resume that neither
 * repeats nor skips, a connection that drops, and the failure paths of a request.
 */

const TOKEN = ['streams', 'w'.repeat(20)].join('_');
const RUN = 'f'.repeat(32);
const ROOT_SPAN = '1'.repeat(16);
const STEP_SPAN = '2'.repeat(16);
const T = (n: number): string => new Date(Date.UTC(2026, 9, 21, 12, 0, n)).toISOString();

type Writable = Exclude<RunRecord, { type: 'unknown' }>;

const rootStart: Writable = {
  type: 'span_started',
  at: T(0),
  traceId: RUN,
  spanId: ROOT_SPAN,
  parentSpanId: undefined,
  name: 'indaba.task live',
  attributes: { 'indaba.task.id': 't', 'indaba.workflow.name': 'live' },
};
const stepStart: Writable = {
  type: 'span_started',
  at: T(1),
  traceId: RUN,
  spanId: STEP_SPAN,
  parentSpanId: ROOT_SPAN,
  name: 'step build',
  attributes: {},
};
const status = (to: string, at: number): Writable => ({
  type: 'step_status',
  at: T(at),
  traceId: RUN,
  taskId: 't',
  stepId: 'build',
  from: 'PENDING',
  to,
  reason: undefined,
});
const output = (text: string, seq: number): Writable => ({
  type: 'output',
  at: T(2 + seq),
  traceId: RUN,
  spanId: STEP_SPAN,
  seq,
  text,
  cut: false,
});
const rootEnd: Writable = {
  type: 'span_ended',
  at: T(20),
  traceId: RUN,
  spanId: ROOT_SPAN,
  status: 'ok',
  statusMessage: undefined,
  attributes: { 'indaba.workflow.status': 'COMPLETED' },
  events: [],
};
const lines = (records: readonly Writable[]): string =>
  records.map((r) => `${serializeRecord(r)}\n`).join('');

let base: string;
let root: string;
let site: string;
let server: ServerHandle | undefined;
const file = (): string => join(root, '.indaba', 'traces', `${RUN}.events.jsonl`);
const auth = { Authorization: `Bearer ${TOKEN}` };

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'indaba-streams-'));
  root = join(base, 'project');
  site = join(base, 'site');
  await mkdir(join(root, '.indaba', 'traces'), { recursive: true });
  await mkdir(site, { recursive: true });
  await writeFile(join(site, 'index.html'), '<!doctype html><title>Indaba</title>');
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(base, { recursive: true, force: true });
});

async function start(roots: readonly string[] = [root]): Promise<ServerHandle> {
  server = await startServer({ roots, staticDir: site, token: TOKEN, pollMs: 10, coalesceMs: 5 });
  return server;
}

interface Snapshot {
  readonly id: number;
  readonly run: {
    readonly status: string;
    readonly steps: { readonly id: string; readonly output: string[] }[];
  };
}

/** An open stream of one run, read frame by frame, that the test can drop at any moment. */
function open(headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const frames: { id: number | undefined; event: string; data: unknown }[] = [];
  let buffer = '';
  const ready = fetch(`http://127.0.0.1:${server?.port}/api/v1/runs/${RUN}/events`, {
    headers: { ...auth, ...headers },
    signal: controller.signal,
  });
  const reading = (async () => {
    const reader = (await ready).body?.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const chunk = await reader?.read().catch(() => undefined);
      if (chunk === undefined || chunk.done) {
        return;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const id = part.match(/^id: (\d+)$/m)?.[1];
        const event = part.match(/^event: (.+)$/m)?.[1];
        const data = part.match(/^data: (.+)$/m)?.[1];
        if (event !== undefined) {
          frames.push({
            id: id === undefined ? undefined : Number(id),
            event,
            data: data === undefined ? undefined : JSON.parse(data),
          });
        }
      }
    }
  })();
  const snapshots = (): Snapshot[] =>
    frames.filter((f) => f.event === 'snapshot').map((f) => f.data as Snapshot);
  const until = async (test: () => boolean, ms = 3000): Promise<void> => {
    const end = Date.now() + ms;
    while (!test()) {
      if (Date.now() > end) {
        throw new Error(`the stream did not get there: ${JSON.stringify(frames.map((f) => f.event))}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  return { frames, snapshots, until, drop: () => controller.abort(), reading };
}

const outputOf = (snapshot: Snapshot | undefined): string[] => snapshot?.run.steps[0]?.output ?? [];

describe('the stream of a run that is still being written', () => {
  it('shows only complete records, and the rest once its line is finished', async () => {
    const half = serializeRecord(output('second\n', 1));
    await writeFile(
      file(),
      `${lines([rootStart, stepStart, status('RUNNING', 1), output('first\n', 0)])}${half.slice(0, 20)}`,
    );
    await start();
    const stream = open();
    await stream.until(() => stream.snapshots().length > 0);
    expect(outputOf(stream.snapshots().at(-1))).toEqual(['first']);
    await appendFile(file(), `${half.slice(20)}\n`);
    await stream.until(() => outputOf(stream.snapshots().at(-1)).includes('second'));
    expect(outputOf(stream.snapshots().at(-1))).toEqual(['first', 'second']);
    await appendFile(file(), lines([status('COMPLETED', 9), rootEnd]));
    await stream.until(() => stream.frames.some((f) => f.event === 'end'));
    expect(stream.snapshots().at(-1)?.run.status).toBe('completed');
    await stream.reading;
  });
});

describe('a resume', () => {
  it('after a drop sends nothing twice and misses nothing written while the page was away', async () => {
    await writeFile(file(), lines([rootStart, stepStart, status('RUNNING', 1), output('one\n', 0)]));
    await start();
    const first = open();
    await first.until(() => first.snapshots().length > 0);
    const seen = first.snapshots().at(-1);
    first.drop();
    await first.reading;

    // Written while no page was listening.
    await appendFile(file(), lines([output('two\n', 1), output('three\n', 2)]));

    const second = open({ 'Last-Event-ID': String(seen?.id) });
    await second.until(() => outputOf(second.snapshots().at(-1)).includes('three'));
    const ids = second.snapshots().map((s) => s.id);
    expect(ids.every((id) => id > (seen?.id ?? 0))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    // Each snapshot is the whole state, so nothing in between can be lost: the first one already holds it all.
    expect(outputOf(second.snapshots()[0])).toEqual(['one', 'two', 'three']);
    second.drop();
    await second.reading;
  });

  it('from the id it last saw, with nothing new, sends no snapshot until something happens', async () => {
    await writeFile(file(), lines([rootStart, stepStart, status('RUNNING', 1)]));
    await start();
    const first = open();
    await first.until(() => first.snapshots().length > 0);
    const last = first.snapshots().at(-1)?.id ?? 0;
    first.drop();
    await first.reading;

    const second = open({ 'Last-Event-ID': String(last) });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(second.snapshots()).toEqual([]);
    await appendFile(file(), lines([output('news\n', 0)]));
    await second.until(() => second.snapshots().length > 0);
    expect(second.snapshots()[0]?.id).toBeGreaterThan(last);
    expect(outputOf(second.snapshots()[0])).toEqual(['news']);
    second.drop();
    await second.reading;
  });
});

describe('a connection that drops', () => {
  it('leaves the server answering, and its close prompt, however many streams were dropped', async () => {
    await writeFile(file(), lines([rootStart, stepStart, status('RUNNING', 1)]));
    await start();
    for (let n = 0; n < 5; n++) {
      const stream = open();
      await stream.until(() => stream.snapshots().length > 0);
      stream.drop();
      await stream.reading;
    }
    const answer = await fetch(`http://127.0.0.1:${server?.port}/api/v1/runs/${RUN}`, { headers: auth });
    expect(answer.status).toBe(200);
    const still = open();
    await still.until(() => still.snapshots().length > 0);
    const began = Date.now();
    await server?.close();
    server = undefined;
    await still.reading;
    expect(Date.now() - began).toBeLessThan(1000);
  });
});

describe('a request that fails', () => {
  it('with a root whose traces cannot be read, answers 500 in plain words and names no path', async () => {
    const broken = join(base, 'broken');
    await mkdir(join(broken, '.indaba'), { recursive: true });
    await writeFile(join(broken, '.indaba', 'traces'), 'a file where a folder should be');
    await start([broken]);
    const answer = await fetch(`http://127.0.0.1:${server?.port}/api/v1/runs`, { headers: auth });
    expect(answer.status).toBe(500);
    const body = await answer.text();
    expect(JSON.parse(body)).toEqual({
      code: 'internal',
      message: 'The server could not answer this request.',
    });
    expect(body).not.toContain(base);
    // The server keeps going.
    expect((await fetch(`http://127.0.0.1:${server?.port}/api/v1/contract`, { headers: auth })).status).toBe(
      200,
    );
  });

  it('with an address no URL parser accepts, answers 400', async () => {
    await start();
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: server?.port,
          path: '//[',
          headers: { Host: `127.0.0.1:${server?.port}` },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(400);
  });

  it('for a file of the page whose name is not valid percent-encoding, answers 404', async () => {
    await start();
    const answer = await fetch(`http://127.0.0.1:${server?.port}/%E0%A4%A.js`);
    expect(answer.status).toBe(404);
  });
});
