import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLogger,
  defaultLoggingSettings,
  LOGGING_SETTINGS,
  type LoggingSettings,
  type LogRecord,
  SINK_DEFAULTS,
  type SinkSettings,
} from '@indaba/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type LoggingSettingsBackend,
  type LoggingSettingsState,
  MAX_BODY_BYTES,
  type ServerHandle,
  startServer,
} from '../src/index.js';

/** specs/logging, AC-20 and AC-21: the one resource the server writes, and everything it still refuses. */

const TOKEN = ['settings', 'v'.repeat(24)].join('_');

let base: string;
let site: string;
let server: ServerHandle | undefined;
let logged: LogRecord[];
let saved: LoggingSettings[];
let tested: SinkSettings[];
let failSave: boolean;

const response = (settings: LoggingSettings): LoggingSettingsState => ({
  settings,
  path: '/project/indaba.config',
  present: true,
  variables: { G_TOKEN: false },
});

const backend: LoggingSettingsBackend = {
  read: async () => response(defaultLoggingSettings()),
  save: async (settings) => {
    if (failSave) {
      throw new Error('EACCES: permission denied, /secret/place');
    }
    saved.push(settings);
    return response(settings);
  },
  test: async (sink) => {
    tested.push(sink);
    return { ok: true, text: 'The collector took the test record.' };
  },
};

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'indaba-settings-'));
  site = join(base, 'site');
  await mkdir(join(base, 'project', '.indaba', 'traces'), { recursive: true });
  await mkdir(site, { recursive: true });
  await writeFile(join(site, 'index.html'), '<!doctype html>');
  logged = [];
  saved = [];
  tested = [];
  failSave = false;
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(base, { recursive: true, force: true });
});

async function start(withSettings = true): Promise<ServerHandle> {
  const logger = createLogger({
    sinks: [{ write: (record) => logged.push(record) }],
    clock: () => new Date('2026-10-21T12:00:00.000Z'),
    level: 'debug',
  });
  server = await startServer({
    roots: [join(base, 'project')],
    staticDir: site,
    token: TOKEN,
    logger,
    ...(withSettings ? { loggingSettings: backend } : {}),
  });
  return server;
}

interface Answer {
  readonly status: number;
  readonly allow: string | undefined;
  readonly body: unknown;
}

function send(
  path: string,
  options: { method?: string; body?: string; type?: string; origin?: string; auth?: boolean } = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: server?.port,
        method: options.method ?? 'GET',
        path,
        headers: {
          Host: `127.0.0.1:${server?.port}`,
          ...(options.auth === false ? {} : { Authorization: `Bearer ${TOKEN}` }),
          ...(options.type === undefined ? {} : { 'Content-Type': options.type }),
          ...(options.origin === undefined ? {} : { Origin: options.origin }),
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

describe('the logging settings over HTTP', () => {
  it('reads them with the token, and not without', async () => {
    await start();
    const answer = await send('/api/v1/settings/logging');
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({
      ...response(defaultLoggingSettings()),
      descriptions: LOGGING_SETTINGS,
      sinkDefaults: SINK_DEFAULTS,
    });
    expect((await send('/api/v1/settings/logging', { auth: false })).status).toBe(401);
  });

  it('saves settings that pass the same checks as the file, from the page itself', async () => {
    const handle = await start();
    const answer = await send('/api/v1/settings/logging', {
      method: 'PUT',
      origin: `http://127.0.0.1:${handle.port}`,
      ...json({ logging: { level: 'debug', sinks: [{ type: 'stderr', level: 'error' }] } }),
    });
    expect(answer.status).toBe(200);
    expect(saved).toEqual([{ level: 'debug', sinks: [{ type: 'stderr', level: 'error' }] }]);
    expect(logged.map((r) => r.message)).toContain('the logging settings were saved');
  });

  it('refuses settings with problems, naming each one, and saves nothing', async () => {
    await start();
    const answer = await send('/api/v1/settings/logging', {
      method: 'PUT',
      ...json({ logging: { level: 'loud', sinks: [{ type: 'gelf', address: 'ftp://x' }] } }),
    });
    expect(answer.status).toBe(422);
    expect(answer.body).toMatchObject({
      code: 'invalid_settings',
      problems: [
        'level must be one of error, warn, info, debug',
        'sinks[0].address must be an address starting with http:// or https:// or tcp:// or udp://',
      ],
    });
    expect(saved).toEqual([]);
  });

  it('refuses another page, a body that is not JSON, a large one and broken JSON', async () => {
    await start();
    const put = (extra: Parameters<typeof send>[1]) =>
      send('/api/v1/settings/logging', { method: 'PUT', ...extra });
    expect((await put({ origin: 'https://evil.test', ...json({ logging: {} }) })).status).toBe(403);
    expect((await put({ body: 'level=debug', type: 'application/x-www-form-urlencoded' })).status).toBe(415);
    expect((await put({ body: 'x'.repeat(MAX_BODY_BYTES + 1), type: 'application/json' })).status).toBe(413);
    expect((await put({ body: '{"logging":', type: 'application/json; charset=utf-8' })).status).toBe(400);
    expect(saved).toEqual([]);
  });

  it('says it could not write without naming where, and the log keeps the reason', async () => {
    await start();
    failSave = true;
    const answer = await send('/api/v1/settings/logging', { method: 'PUT', ...json({ logging: {} }) });
    expect(answer.status).toBe(409);
    expect(JSON.stringify(answer.body)).not.toContain('/secret/place');
    expect(logged.find((r) => r.message === 'the settings could not be saved')?.fields?.reason).toContain(
      'EACCES',
    );
  });

  it('checks a draft without saving it', async () => {
    await start();
    const answer = await send('/api/v1/settings/logging/check', {
      method: 'POST',
      ...json({ logging: { level: 'x' } }),
    });
    expect(answer.body).toEqual({ problems: ['level must be one of error, warn, info, debug'] });
    expect(saved).toEqual([]);
  });

  it('sends a test record through one checked sink', async () => {
    await start();
    const ok = await send('/api/v1/settings/logging/test', {
      method: 'POST',
      ...json({ sink: { type: 'http-json', address: 'https://logs.test/in' } }),
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, text: 'The collector took the test record.' });
    expect(tested[0]).toMatchObject({ type: 'http-json', address: 'https://logs.test/in', retries: 3 });
    const bad = await send('/api/v1/settings/logging/test', {
      method: 'POST',
      ...json({ sink: { type: 'gelf' } }),
    });
    expect(bad.status).toBe(422);
    expect(bad.body).toMatchObject({ problems: [expect.stringMatching(/^address must be/)] });
  });

  it('accepts no other method on any other address, and names what each takes', async () => {
    await start();
    const del = await send('/api/v1/settings/logging', { method: 'DELETE' });
    expect(del.status).toBe(405);
    expect(del.allow).toBe('GET, PUT');
    const getTest = await send('/api/v1/settings/logging/test');
    expect(getTest.status).toBe(405);
    expect(getTest.allow).toBe('POST');
    const putRuns = await send('/api/v1/runs', { method: 'PUT', ...json({}) });
    expect(putRuns.status).toBe(405);
    expect(putRuns.allow).toBe('GET');
  });

  it('stays read-only without a backend', async () => {
    await start(false);
    expect((await send('/api/v1/settings/logging')).status).toBe(404);
    const put = await send('/api/v1/settings/logging', { method: 'PUT', ...json({ logging: {} }) });
    expect(put.status).toBe(405);
    expect(put.allow).toBe('GET');
  });
});
