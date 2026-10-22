import { createLogger, type LogRecord, RunnerUnavailableError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  LoggingProcessSpawner,
  LoggingStreamingSpawner,
  loggingFetch,
  type ProcessOutcome,
  type ProcessSession,
  type ProcessSpec,
  RunnerRegistry,
} from '../src/index.js';

function recorder() {
  const records: LogRecord[] = [];
  const logger = createLogger({
    sinks: [{ write: (record) => void records.push(record) }],
    clock: () => new Date('2026-10-21T10:00:00.000Z'),
    level: 'debug',
  });
  return { records, logger, messages: () => records.map((r) => r.message) };
}

const spec = (usePty: boolean): ProcessSpec => ({
  command: ['/usr/local/bin/claude', '-p', 'a secret prompt'],
  cwd: '/work/tree',
  env: { SOME_KEY: 'value-of-key' },
  usePty,
  timeoutSeconds: 30,
  onData: () => undefined,
});

describe('LoggingProcessSpawner', () => {
  it('records the program name, never its arguments or environment', async () => {
    const { records, logger, messages } = recorder();
    const outcome: ProcessOutcome = { exitCode: 3, timedOut: false, aborted: false, mode: 'piped' };
    const spawner = new LoggingProcessSpawner({ run: async () => outcome }, logger);
    await expect(spawner.run(spec(true))).resolves.toBe(outcome);
    expect(messages()).toEqual([
      'a process started',
      'a pseudo-terminal was asked for and pipes were used',
      'a process ended',
    ]);
    expect(records[0]?.fields).toEqual({
      program: 'claude',
      cwd: '/work/tree',
      pty: true,
      timeoutSeconds: 30,
    });
    expect(records[2]?.fields).toEqual({
      program: 'claude',
      exitCode: 3,
      mode: 'piped',
      timedOut: false,
      aborted: false,
    });
    const text = JSON.stringify(records);
    expect(text).not.toContain('secret prompt');
    expect(text).not.toContain('value-of-key');
  });

  it('records a process that could not start, and rethrows', async () => {
    const { logger, messages } = recorder();
    const failure = new RunnerUnavailableError('Cannot start "claude": ENOENT.');
    const spawner = new LoggingProcessSpawner(
      {
        run: () => Promise.reject(failure),
      },
      logger,
    );
    await expect(spawner.run(spec(false))).rejects.toBe(failure);
    expect(messages()).toEqual(['a process started', 'a process could not start']);
  });
});

describe('LoggingStreamingSpawner', () => {
  it('records the start and the exit of an agent process', async () => {
    const { logger, messages } = recorder();
    let exit = (_code: number): void => undefined;
    const session: ProcessSession = {
      write: async () => undefined,
      lines: (async function* () {})(),
      stderrTail: () => '',
      exited: new Promise<number>((resolve) => {
        exit = resolve;
      }),
      kill: async () => undefined,
    };
    const spawner = new LoggingStreamingSpawner({ start: async () => session }, logger);
    await spawner.start({ command: ['agent', '--acp'], cwd: '/w', env: {} });
    exit(0);
    await session.exited;
    await Promise.resolve();
    expect(messages()).toEqual(['a process started', 'a process ended']);
  });

  it('records an agent that could not start', async () => {
    const { logger, messages } = recorder();
    const spawner = new LoggingStreamingSpawner({ start: () => Promise.reject(new Error('ENOENT')) }, logger);
    await expect(spawner.start({ command: [], cwd: '/w', env: {} })).rejects.toThrow('ENOENT');
    expect(messages()).toEqual(['a process could not start']);
  });
});

describe('loggingFetch', () => {
  it('records the host, the path and the status, never the query or the headers', async () => {
    const { records, logger } = recorder();
    const fetchFn = loggingFetch(async () => new Response('{}', { status: 429 }), logger);
    const response = await fetchFn('https://openrouter.ai/api/v1/chat/completions?key=abc123', {
      method: 'POST',
      headers: { authorization: 'Bearer something' },
    });
    expect(response.status).toBe(429);
    expect(records.map((r) => r.fields)).toEqual([
      { method: 'POST', host: 'openrouter.ai', path: '/api/v1/chat/completions' },
      { method: 'POST', host: 'openrouter.ai', path: '/api/v1/chat/completions', status: 429 },
    ]);
    expect(JSON.stringify(records)).not.toContain('abc123');
  });

  it('records a request that failed, and rethrows', async () => {
    const { records, logger } = recorder();
    const fetchFn = loggingFetch(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')), logger);
    await expect(fetchFn('not a url', {})).rejects.toThrow('ENOTFOUND');
    expect(records[1]).toMatchObject({
      message: 'an HTTP request failed',
      fields: { method: 'GET', host: '', path: '', reason: 'getaddrinfo ENOTFOUND' },
    });
  });
});

describe('RunnerRegistry.withDefaults with a logger', () => {
  it('runs the shell runner through the logging spawner', async () => {
    const { messages, logger } = recorder();
    const runs: ProcessSpec[] = [];
    const registry = RunnerRegistry.withDefaults(
      {},
      {
        logger,
        spawner: {
          run: async (s) => {
            runs.push(s);
            return { exitCode: 0, timedOut: false, aborted: false, mode: 'piped' };
          },
        },
      },
    );
    await registry.get('shell').run({ prompt: 'echo hi', workdir: '/w', timeoutSeconds: 5 });
    expect(runs).toHaveLength(1);
    expect(messages()).toContain('a process started');
    expect(messages()).toContain('a process ended');
  });
});
