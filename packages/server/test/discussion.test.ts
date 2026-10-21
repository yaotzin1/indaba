import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiError, DiscussionResponse } from '@indaba/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ServerHandle, startServer } from '../src/index.js';

const TOKEN = ['fixture', 'y'.repeat(16)].join('_');
const RUN = 'b'.repeat(32);
const ESC = String.fromCharCode(0x1b);

let root: string;
let elsewhere: string;
let site: string;
let server: ServerHandle | undefined;

const kept = (outcome = 'stalled') =>
  JSON.stringify({
    outcome,
    rounds: 2,
    messages: [{ round: 1, sender: `claude${ESC}[31m`, type: 'CRITIQUE', content: 'fix the loop' }],
    ruling: { verdict: 'accept', decidedBy: 'human', note: 'fine' },
  });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'indaba-disc-root-'));
  elsewhere = await mkdtemp(join(tmpdir(), 'indaba-disc-else-'));
  site = await mkdtemp(join(tmpdir(), 'indaba-disc-site-'));
  await writeFile(join(site, 'index.html'), '<p>page</p>');
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  for (const dir of [root, elsewhere, site]) {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

const ask = (path: string, token = TOKEN): Promise<Response> =>
  fetch(`http://127.0.0.1:${server?.port}${path}`, { headers: { Authorization: `Bearer ${token}` } });

async function begin(extra: { discussionDirectories?: string[] } = {}): Promise<void> {
  // A run must exist for its steps to be asked about.
  await mkdir(join(root, '.indaba', 'traces'), { recursive: true });
  await writeFile(
    join(root, '.indaba', 'traces', `${RUN}.events.jsonl`),
    `${JSON.stringify({
      type: 'span_started',
      at: '2026-10-05T12:00:00.000Z',
      traceId: RUN,
      spanId: 'r'.repeat(16),
      name: 'indaba.task demo',
      attributes: { 'indaba.task.id': 't', 'indaba.workflow.name': 'demo' },
    })}\n`,
  );
  server = await startServer({ roots: [root], staticDir: site, token: TOKEN, pollMs: 10, ...extra });
}

describe('GET /api/v1/runs/{id}/steps/{step}/discussion', () => {
  it('answers with the kept messages, cleaned, from the default folder of a root', async () => {
    await mkdir(join(root, '.indaba', 'discussions'), { recursive: true });
    await writeFile(join(root, '.indaba', 'discussions', `${RUN}.debate.json`), kept());
    await begin();
    const response = await ask(`/api/v1/runs/${RUN}/steps/debate/discussion`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as DiscussionResponse;
    expect(body.discussion.rounds).toBe(2);
    expect(body.discussion.messages[0]?.sender).toBe('claude');
    expect(body.discussion.ruling?.verdict).toBe('accept');
    expect(JSON.stringify(body)).not.toContain(ESC);
  });

  it('looks in the folders the server was told about', async () => {
    await writeFile(join(elsewhere, `${RUN}.debate.json`), kept('reached'));
    await begin({ discussionDirectories: [elsewhere] });
    const body = (await (
      await ask(`/api/v1/runs/${RUN}/steps/debate/discussion`)
    ).json()) as DiscussionResponse;
    expect(body.discussion.outcome).toBe('reached');
  });

  it('says plainly that nothing was kept', async () => {
    await begin();
    const response = await ask(`/api/v1/runs/${RUN}/steps/debate/discussion`);
    expect(response.status).toBe(404);
    expect(((await response.json()) as ApiError).code).toBe('discussion_not_found');
  });

  it('refuses a missing token, an unknown run and a step name that is a path', async () => {
    await begin();
    expect((await ask(`/api/v1/runs/${RUN}/steps/debate/discussion`, 'wrong')).status).toBe(401);
    expect((await ask(`/api/v1/runs/${'c'.repeat(32)}/steps/debate/discussion`)).status).toBe(404);
    for (const step of ['..%2Fx', '%2e%2e', 'a%5Cb', 'a%00b']) {
      const response = await ask(`/api/v1/runs/${RUN}/steps/${step}/discussion`);
      expect(response.status).toBe(404);
    }
  });
});
