import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunnerUnavailableError, type RunRequest } from '@indaba/core';
import { afterEach, describe, expect, it } from 'vitest';
import { AcpRunner, type AuthChooser, type AuthMethodInfo } from '../src/index.js';
import { FakeAgent, type Script } from './acp-support.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

const METHODS = [
  { id: 'oauth-personal', name: 'Log in with Google', description: 'Use your Google account' },
  { id: 'gemini-api-key', name: 'Gemini API key' },
];

/** An agent that lists ways to log in, as Gemini does. */
const offering = (methods: unknown = METHODS, extra: Script = {}): Script => ({
  initialize: (_m, _w, reply) =>
    reply({
      protocolVersion: 1,
      agentInfo: { name: 'gemini-cli', title: 'Gemini CLI' },
      agentCapabilities: {},
      authMethods: methods,
    }),
  ...extra,
});

async function run(
  script: Script,
  agent: RunRequest['agent'] = { preset: 'gemini' },
  chooseAuthMethod?: AuthChooser,
): Promise<{ agent: FakeAgent; result?: Awaited<ReturnType<AcpRunner['run']>>; error?: unknown }> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'indaba-auth-')));
  dirs.push(dir);
  const fake = new FakeAgent(script);
  const runner = new AcpRunner({
    spawner: fake,
    ...(chooseAuthMethod !== undefined ? { chooseAuthMethod } : {}),
  });
  try {
    const result = await runner.run({
      prompt: 'p',
      workdir: dir,
      ...(agent !== undefined ? { agent } : {}),
    });
    return { agent: fake, result };
  } catch (error) {
    return { agent: fake, error };
  }
}

describe('AcpRunner: logging in', () => {
  it('authenticates with the method the workflow names, between initialize and session/new', async () => {
    const { agent, result } = await run(offering(), { preset: 'gemini', auth: 'gemini-api-key' });
    expect(result?.exitCode).toBe(0);
    expect(agent.methods()).toEqual(['initialize', 'authenticate', 'session/new', 'session/prompt']);
    expect(agent.received[1]?.params).toEqual({ methodId: 'gemini-api-key' });
  });

  it('refuses a method the agent does not offer, and says which it does', async () => {
    const { agent, error } = await run(offering(), { preset: 'gemini', auth: 'telepathy' });
    expect(error).toBeInstanceOf(RunnerUnavailableError);
    expect((error as Error).message).toContain('oauth-personal, gemini-api-key');
    expect(agent.methods()).toEqual(['initialize']);
  });

  it('is a runner that could not run when the login fails', async () => {
    const { agent, error } = await run(
      offering(METHODS, {
        authenticate: (m, wire) =>
          wire.send({ id: m.id ?? null, error: { code: -32000, message: 'Browser closed' } }),
      }),
      { preset: 'gemini', auth: 'oauth-personal' },
    );
    expect(error).toBeInstanceOf(RunnerUnavailableError);
    expect((error as Error).message).toContain('could not log in with "oauth-personal"');
    expect((error as Error).message).toContain('Browser closed');
    expect(agent.methods()).not.toContain('session/prompt');
  });

  it('asks the chooser when nothing is configured, naming the agent and its methods', async () => {
    let asked: { agent: string; methods: readonly AuthMethodInfo[] } | undefined;
    const { agent } = await run(offering(), { preset: 'gemini' }, async (name, methods) => {
      asked = { agent: name, methods };
      return 'oauth-personal';
    });
    expect(asked?.agent).toBe('Gemini CLI');
    expect(asked?.methods.map((m) => m.id)).toEqual(['oauth-personal', 'gemini-api-key']);
    expect(asked?.methods[0]).toEqual({
      id: 'oauth-personal',
      name: 'Log in with Google',
      description: 'Use your Google account',
    });
    expect(agent.received[1]).toMatchObject({
      method: 'authenticate',
      params: { methodId: 'oauth-personal' },
    });
  });

  it('goes on without authenticating when the person chooses to', async () => {
    const { agent, result } = await run(offering(), { preset: 'gemini' }, async () => undefined);
    expect(result?.exitCode).toBe(0);
    expect(agent.methods()).toEqual(['initialize', 'session/new', 'session/prompt']);
  });

  it('does not ask when the workflow already names a method', async () => {
    let asked = false;
    await run(offering(), { preset: 'gemini', auth: 'oauth-personal' }, async () => {
      asked = true;
      return undefined;
    });
    expect(asked).toBe(false);
  });

  it('does not ask when the agent offers no way to log in', async () => {
    let asked = false;
    const { agent } = await run({}, { preset: 'gemini' }, async () => {
      asked = true;
      return undefined;
    });
    expect(asked).toBe(false);
    expect(agent.methods()).not.toContain('authenticate');
  });

  it('never asks when nobody can be asked, and does not authenticate on its own', async () => {
    const { agent, result } = await run(offering());
    expect(result?.exitCode).toBe(0);
    expect(agent.methods()).toEqual(['initialize', 'session/new', 'session/prompt']);
  });

  it('refuses a chosen method the agent did not offer', async () => {
    const { error } = await run(offering(), { preset: 'gemini' }, async () => 'something-else');
    expect(error).toBeInstanceOf(RunnerUnavailableError);
    expect((error as Error).message).toContain('not one the agent offers');
  });

  it('drops malformed entries in the list of methods', async () => {
    let seen: readonly AuthMethodInfo[] = [];
    await run(
      offering([null, 7, { id: '' }, { name: 'no id' }, { id: 'ok' }]),
      { preset: 'gemini' },
      async (_n, methods) => {
        seen = methods;
        return undefined;
      },
    );
    expect(seen).toEqual([{ id: 'ok', name: 'ok' }]);
  });

  it('records which method was used, by id only', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'indaba-auth-')));
    dirs.push(dir);
    const events: { name: string; attributes: unknown }[] = [];
    await new AcpRunner({ spawner: new FakeAgent(offering()) }).run({
      prompt: 'p',
      workdir: dir,
      agent: { preset: 'gemini', auth: 'oauth-personal' },
      onEvent: (name, attributes) => events.push({ name, attributes }),
    });
    expect(events).toContainEqual({
      name: 'indaba.acp.authenticate',
      attributes: { 'acp.auth.method': 'oauth-personal' },
    });
  });
});
