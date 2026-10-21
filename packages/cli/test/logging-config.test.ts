import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LogRecord } from '@indaba/core';
import { afterEach, describe, expect, it } from 'vitest';
import { EARLY_EXIT_FLUSH_MS, EarlyExit } from '../src/exit.js';
import { main } from '../src/index.js';
import { chooseLevel, openCommandLogger } from '../src/log.js';
import {
  captureIo,
  FIXTURE_WORKFLOW,
  fakePluginSource,
  makeTempDir,
  writePlugin,
  writeWorkflow,
} from './support.js';

const example = fileURLToPath(new URL('../../../examples/task-pipeline.workflow.ai.yml', import.meta.url));
const NOW = '2026-10-21T08:00:00.000Z';
const LOG_FILE = 'indaba-2026-10-21.log.jsonl';

async function command(args: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  const captured = captureIo(cwd, env);
  const code = await main(args, { ...captured.io, clock: () => new Date(NOW), pid: 4242 });
  return { code, out: captured.stdout(), err: captured.stderr() };
}

async function records(folder: string): Promise<LogRecord[]> {
  const text = await readFile(join(folder, LOG_FILE), 'utf8');
  return text
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as LogRecord);
}

const servers: { close(callback: () => void): void }[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function collector(): Promise<{
  url: string;
  bodies: { auth: string | undefined; body: LogRecord }[];
}> {
  const bodies: { auth: string | undefined; body: LogRecord }[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      bodies.push({
        auth: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/in`, bodies };
}

describe('indaba.config', () => {
  it('sets the level and the folder of the file sink', async () => {
    const dir = await makeTempDir();
    await writeFile(
      join(dir, 'indaba.config'),
      'logging:\n  level: debug\n  sinks:\n    - type: file\n      folder: my-logs\n',
    );
    const r = await command(['validate', example], dir);
    expect(r.code).toBe(0);
    expect(r.err).toBe('');
    const written = await records(join(dir, 'my-logs'));
    expect(written[0]?.message).toBe('process.start');
    await expect(readdir(join(dir, '.indaba', 'logs'))).rejects.toThrow();
  });

  it('is overridden by --log-level, INDABA_LOG_LEVEL and --log-dir', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'indaba.config'), 'logging:\n  level: error\n');
    await command(['validate', example, '--log-dir', 'other'], dir, { INDABA_LOG_LEVEL: 'info' });
    expect((await records(join(dir, 'other')))[0]?.message).toBe('process.start');
    expect(chooseLevel(undefined, undefined, 'warn')).toBe('warn');
    expect(chooseLevel(undefined, 'debug', 'warn')).toBe('debug');
    expect(chooseLevel('error', 'debug', 'warn')).toBe('error');
  });

  it('is a usage error naming every problem', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'indaba.config'), 'sandbox: {}\nlogging:\n  level: loud\n');
    const r = await command(['validate', 'x.yml'], dir);
    expect(r.code).toBe(2);
    expect(r.err).toContain('indaba.config is invalid:');
    expect(r.err).toContain(' - sandbox is not a section of indaba.config');
    expect(r.err).toContain(' - logging.level must be one of error, warn, info, debug');
  });

  it('refuses a relative folder that leaves the project', async () => {
    const dir = await makeTempDir();
    await writeFile(
      join(dir, 'indaba.config'),
      'logging:\n  sinks:\n    - type: file\n      folder: ../out\n',
    );
    const r = await command(['validate', 'x.yml'], dir);
    expect(r.code).toBe(2);
    expect(r.err).toContain('logging folder: A relative log folder must stay inside the project.');
  });

  it('sends to an http-json collector with the credential of the named variable, never logging it', async () => {
    const dir = await makeTempDir();
    const { url, bodies } = await collector();
    await writeFile(
      join(dir, 'indaba.config'),
      `logging:\n  sinks:\n    - type: file\n    - type: http-json\n      address: ${url}\n      secretEnv: COLLECTOR_PASS\n`,
    );
    const credential = 'collector-credential-value';
    const r = await command(['validate', example], dir, { COLLECTOR_PASS: credential });
    expect(r.code).toBe(0);
    expect(bodies.map((b) => b.body.message)).toEqual(['process.start', 'process.end']);
    expect(bodies[0]?.auth).toBe(`Bearer ${credential}`);
    const file = await readFile(join(dir, '.indaba', 'logs', LOG_FILE), 'utf8');
    expect(file).not.toContain(credential);
  });

  it('warns once when the variable named in secretEnv is not set', async () => {
    const dir = await makeTempDir();
    const { url } = await collector();
    await writeFile(
      join(dir, 'indaba.config'),
      `logging:\n  sinks:\n    - type: stderr\n    - type: gelf\n      address: ${url.replace('/in', '/gelf')}\n      secretEnv: NOT_SET_ANYWHERE\n`,
    );
    const r = await command(['validate', example], dir);
    expect(r.code).toBe(0);
    expect(r.err).toBe(
      'warn: the variable named in secretEnv is not set; the collector gets no credential variable=NOT_SET_ANYWHERE\n',
    );
  });

  it('costs one warning when a collector is down, and the command still succeeds', async () => {
    const dir = await makeTempDir();
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await writeFile(
      join(dir, 'indaba.config'),
      `logging:\n  sinks:\n    - type: stderr\n    - type: http-json\n      address: http://127.0.0.1:${port}/\n      retries: 0\n      timeoutSeconds: 1\n`,
    );
    const r = await command(['validate', example], dir);
    expect(r.code).toBe(0);
    const warnings = r.err
      .split('\n')
      .filter((line) => line.startsWith('warn: a log collector cannot be reached'));
    expect(warnings).toHaveLength(1);
  });
});

describe('plugin sinks (AC-10)', () => {
  it('receives the redacted records through Plugin.logSinks and host.registerLogSink', async () => {
    const dir = await makeTempDir();
    const out = join(dir, 'sink.jsonl');
    const source = fakePluginSource(join(dir, 'plugin.log')).replace(
      'register(host) {',
      `logSinks: [{ write: (r) => appendFileSync(${JSON.stringify(out)}, 'declared ' + r.message + (r.fields?.value ?? '') + EOL) }],\n  register(host) {\n    host.registerLogSink({ write: (r) => appendFileSync(${JSON.stringify(out)}, 'registered ' + r.message + EOL) });\n    host.logger.info('plugin.demo', 'the key is ', { value: 'demo-key-value' });`,
    );
    const plugin = await writePlugin(dir, 'sink-plugin.mjs', source);
    const workflow = await writeWorkflow(dir, 'flow.workflow.ai.yml', FIXTURE_WORKFLOW);
    const r = await command(['run', workflow, '--plugin', plugin, '--task-id', 'sinks'], dir, {
      DEMO_API_KEY: 'demo-key-value',
    });
    expect(r.code).toBe(0);
    const lines = (await readFile(out, 'utf8')).trimEnd().split('\n');
    expect(lines[0]).toBe('declared the key is [redacted]');
    expect(lines).toContain('registered a plugin registered');
    expect(lines).toContain('declared process.end');
    expect(lines).toContain('registered process.end');
    expect(lines.join('\n')).not.toContain('demo-key-value');
  });

  it('drops a plugin sink that throws, and the run is not affected', async () => {
    const dir = await makeTempDir();
    const source = fakePluginSource(join(dir, 'plugin.log')).replace(
      'register(host) {',
      "logSinks: [{ write: () => { throw new Error('broken sink'); } }],\n  register(host) {",
    );
    const plugin = await writePlugin(dir, 'broken-sink.mjs', source);
    const workflow = await writeWorkflow(dir, 'flow.workflow.ai.yml', FIXTURE_WORKFLOW);
    const r = await command(['run', workflow, '--plugin', plugin, '--task-id', 'broken'], dir);
    expect(r.code).toBe(0);
    expect(r.err).toBe('warn: a log sink failed and was dropped\n');
  });
});

describe('a run with every sink failing (AC-11, T-16)', () => {
  it('ends with the same states and output as one that logs normally', async () => {
    const normal = await makeTempDir();
    const broken = await makeTempDir();
    // The folder of the file sink is a file, so it cannot be created; every other sink is a plugin that throws.
    await writeFile(join(broken, 'blocked'), 'not a folder');
    await writeFile(
      join(broken, 'indaba.config'),
      'logging:\n  level: debug\n  sinks:\n    - type: file\n      folder: blocked/logs\n',
    );
    const throwing = (dir: string) =>
      fakePluginSource(join(dir, 'plugin.log')).replace(
        'register(host) {',
        "logSinks: [{ write: () => { throw new Error('a'); }, flush: () => Promise.reject(new Error('b')) }],\n  register(host) {",
      );
    const runIn = async (dir: string, source: string) => {
      const plugin = await writePlugin(dir, 'p.mjs', source);
      const workflow = await writeWorkflow(dir, 'flow.workflow.ai.yml', FIXTURE_WORKFLOW);
      const r = await command(['run', workflow, '--plugin', plugin, '--task-id', 'same'], dir);
      return { ...r, plugin: await readFile(join(dir, 'plugin.log'), 'utf8') };
    };
    const a = await runIn(normal, fakePluginSource(join(normal, 'plugin.log')));
    const b = await runIn(broken, throwing(broken));
    expect(b.code).toBe(a.code);
    expect(b.plugin).toBe(a.plugin);
    const states = (out: string) => out.split('\n').filter((line) => line.includes('->'));
    expect(states(b.out)).toEqual(states(a.out));
    expect(states(b.out).length).toBeGreaterThan(0);
    // Trace ids are random; the same kinds of file are written.
    const traceFiles = async (dir: string) =>
      (await readdir(join(dir, '.indaba', 'traces'))).map((name) => name.replace(/^[0-9a-f]+/, 'id')).sort();
    expect(await traceFiles(broken)).toEqual(await traceFiles(normal));
  });
});

describe('the early exit (a second Ctrl+C)', () => {
  it('runs every hook, and waits no longer than the limit', async () => {
    const exit = new EarlyExit();
    const done: string[] = [];
    exit.add(async () => void done.push('quick'));
    const remove = exit.add(async () => void done.push('removed'));
    remove();
    exit.add(() => new Promise<void>(() => undefined));
    exit.add(() => {
      throw new Error('a hook that throws');
    });
    expect(exit.started).toBe(false);
    const started = performance.now();
    await exit.run(50);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(done).toEqual(['quick']);
    expect(exit.started).toBe(true);
    await expect(exit.run()).resolves.toBeUndefined();
    expect(EARLY_EXIT_FLUSH_MS).toBeGreaterThan(0);
  });

  it('writes the last records of a command interrupted twice', async () => {
    const dir = await makeTempDir();
    const exit = new EarlyExit();
    const captured = captureIo(dir, {});
    const workflow = await writeWorkflow(dir, 'flow.workflow.ai.yml', FIXTURE_WORKFLOW);
    const plugin = await writePlugin(
      dir,
      'slow.mjs',
      fakePluginSource(join(dir, 'plugin.log')).replace(
        'register(host) {',
        "async register(host) {\n    host.logger.info('plugin.demo', 'waiting');\n    await new Promise((r) => setTimeout(r, 300));",
      ),
    );
    const running = main(['validate', workflow, '--plugin', plugin], {
      ...captured.io,
      clock: () => new Date(NOW),
      pid: 1,
      exitHooks: exit,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await exit.run();
    const written = await records(join(dir, '.indaba', 'logs'));
    expect(written.map((r) => r.message)).toEqual(['process.start', 'waiting', 'process.end']);
    expect(written[2]?.fields).toEqual({ exitCode: 130, interruptedTwice: true });
    await running;
  });
});

describe('openCommandLogger', () => {
  it('builds a GELF and an http-json sink from the settings', async () => {
    const root = await makeTempDir();
    const logger = openCommandLogger({
      root,
      level: 'info',
      dir: undefined,
      settings: {
        level: 'info',
        sinks: [
          {
            type: 'gelf',
            level: 'info',
            address: 'udp://127.0.0.1:9',
            queueLength: 5,
            timeoutSeconds: 1,
            retries: 0,
          },
          {
            type: 'http-json',
            level: 'warn',
            address: 'http://127.0.0.1:9/',
            queueLength: 5,
            timeoutSeconds: 1,
            retries: 0,
          },
        ],
      },
      stderr: { write: () => undefined },
      environment: {},
      clock: () => new Date(NOW),
      pid: 1,
    });
    logger.info('test', 'one');
    await expect(logger.flush()).resolves.toBeUndefined();
  });

  it('turns an address the sink refuses into a usage error', () => {
    expect(() =>
      openCommandLogger({
        root: '.',
        level: 'info',
        dir: undefined,
        settings: {
          level: 'info',
          sinks: [
            {
              type: 'gelf',
              level: 'info',
              address: 'tcp://host',
              queueLength: 5,
              timeoutSeconds: 1,
              retries: 0,
            },
          ],
        },
        stderr: { write: () => undefined },
        environment: {},
        clock: () => new Date(NOW),
        pid: 1,
      }),
    ).toThrow(/needs a port/);
  });
});
