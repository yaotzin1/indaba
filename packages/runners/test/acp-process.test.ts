import { fileURLToPath } from 'node:url';
import { RunnerUnavailableError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { AcpRunner, NodeStreamingProcessSpawner } from '../src/index.js';

const AGENT = fileURLToPath(new URL('./fixtures/fake-acp-agent.mjs', import.meta.url));
const NODE = process.execPath;

/** What a child needs to start at all on this machine; everything else is the test's to give. */
function systemEnv(extra: Record<string, string> = {}): Record<string, string> {
  const names = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE'];
  const env: Record<string, string> = {};
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return { ...env, ...extra };
}

const runner = (env: Record<string, string | undefined> = systemEnv(), passEnv: string[] = []): AcpRunner =>
  new AcpRunner({ spawner: new NodeStreamingProcessSpawner(), env, passEnv, cancelGraceMs: 200 });

const request = (
  mode: string,
  extra: Partial<Parameters<AcpRunner['run']>[0]> = {},
): Parameters<AcpRunner['run']>[0] => ({
  prompt: 'hello',
  workdir: process.cwd(),
  agent: { command: [NODE, AGENT] },
  env: { FAKE_MODE: mode },
  ...extra,
});

describe('AcpRunner over a real process', () => {
  it('talks to a child agent over its pipes and finishes with exit 0', async () => {
    const result = await runner().run(request('ok'));
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('pong:hello');
  });

  it('is a runner that could not run when the program does not exist', async () => {
    const error = await runner()
      .run(request('ok', { agent: { command: ['indaba-no-such-agent-binary'] } }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunnerUnavailableError);
    expect((error as Error).message).toContain('indaba-no-such-agent-binary');
  });

  it('is a runner that could not run when the child prints a banner instead of ACP', async () => {
    await expect(runner().run(request('banner'))).rejects.toBeInstanceOf(RunnerUnavailableError);
  });

  it('is a runner that could not run when the child exits at once, and says what it wrote', async () => {
    const error = await runner()
      .run(request('exit'))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunnerUnavailableError);
    expect((error as Error).message).toContain('cannot start');
  });

  it('times out a child that never answers, and does not leave it running', async () => {
    const started = Date.now();
    const result = await runner().run(request('silent', { timeoutSeconds: 0.3 }));
    expect(result.exitCode).toBe(124);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('stops a child when the run is aborted', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const started = Date.now();
    const result = await runner().run(request('silent'), controller.signal);
    expect(result.exitCode).toBe(130);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('gives the child only the environment it was allowed', async () => {
    const result = await runner(
      systemEnv({ OPENROUTER_API_KEY: 'router-key-value', MY_PASS: 'yes', RANDOM_OTHER: 'no' }),
      ['MY_PASS'],
    ).run(request('env'));
    const names = JSON.parse(result.output) as string[];
    expect(names).toContain('FAKE_MODE');
    expect(names).toContain('MY_PASS');
    expect(names).not.toContain('OPENROUTER_API_KEY');
    expect(names).not.toContain('RANDOM_OTHER');
  });
});
