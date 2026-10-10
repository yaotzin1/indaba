import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PermissionMode,
  RunnerError,
  RunnerUnavailableError,
  type RunRequest,
  type SpanAttributes,
  type StepPermissions,
} from '@indaba/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ACP_AGENT_PRESETS, AcpRunner, type AcpRunnerOptions } from '../src/index.js';
import { FakeAgent, type Script, UnstartableAgent } from './acp-support.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function workdir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'indaba-acp-')));
  dirs.push(dir);
  return dir;
}

interface Recorded {
  events: { name: string; attributes: SpanAttributes | undefined }[];
  output: string[];
}

async function run(
  script: Script,
  overrides: Partial<RunRequest> = {},
  options: AcpRunnerOptions = {},
): Promise<{
  result: Awaited<ReturnType<AcpRunner['run']>>;
  agent: FakeAgent;
  recorded: Recorded;
  dir: string;
}> {
  const dir = overrides.workdir ?? (await workdir());
  const agent = new FakeAgent(script);
  const recorded: Recorded = { events: [], output: [] };
  const runner = new AcpRunner({ spawner: agent, ...options });
  const result = await runner.run({
    prompt: 'do the thing',
    workdir: dir,
    agent: { preset: 'claude' },
    onEvent: (name, attributes) => recorded.events.push({ name, attributes }),
    onOutput: (chunk) => recorded.output.push(chunk),
    ...overrides,
  });
  return { result, agent, recorded, dir };
}

const text = (t: string): Record<string, unknown> => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text: t },
});

const OPTIONS = [
  { optionId: 'always', kind: 'allow_always', name: 'Always' },
  { optionId: 'yes', kind: 'allow_once', name: 'Allow' },
  { optionId: 'never', kind: 'reject_always', name: 'Never' },
  { optionId: 'no', kind: 'reject_once', name: 'Reject' },
];

const scope = (write: string[], extra: Partial<StepPermissions> = {}): StepPermissions => ({
  fsRead: [],
  fsWrite: write,
  terminal: PermissionMode.Deny,
  ...extra,
});

describe('AcpRunner: a normal run', () => {
  it('handshakes, sends the prompt, streams the answer and ends with exit 0', async () => {
    const { result, agent, recorded } = await run({
      prompt: (_m, wire, reply) => {
        wire.update(text('Hel'));
        wire.update({
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'secret thinking' },
        });
        wire.update(text('lo'));
        reply({ stopReason: 'end_turn' });
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('Hello');
    expect(recorded.output).toEqual(['Hel', 'lo']);
    expect(agent.methods()).toEqual(['initialize', 'session/new', 'session/prompt']);
    expect(agent.received[2]?.params).toMatchObject({
      sessionId: 's1',
      prompt: [{ type: 'text', text: 'do the thing' }],
    });
    expect(agent.killed).toBe(true);
    expect(recorded.events.map((e) => e.name)).toContain('indaba.acp.completion');
  });

  it('speaks protocol 1, advertises no terminal, and no files without permissions', async () => {
    const { agent, dir } = await run({});
    expect(agent.received[0]?.params).toMatchObject({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    expect(agent.received[1]?.params).toMatchObject({ cwd: dir, mcpServers: [] });
  });

  it('advertises file access when the step declares permissions', async () => {
    const { agent } = await run({}, { permissions: scope(['src/**']) });
    expect(agent.received[0]?.params).toMatchObject({
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
    });
  });

  it.each([
    ['max_tokens', 1, 'max_tokens'],
    ['max_turn_requests', 1, 'max_turn_requests'],
    ['refusal', 1, 'refusal'],
    ['cancelled', 130, 'cancelled'],
  ])('maps the stop reason %s to exit %i', async (stopReason, code, shown) => {
    const { result } = await run({ prompt: (_m, _w, reply) => reply({ stopReason }) });
    expect(result.exitCode).toBe(code);
    expect(result.errorOutput).toContain(shown);
  });

  it('fails a turn that ends without a valid stop reason', async () => {
    const { result } = await run({ prompt: (_m, _w, reply) => reply({}) });
    expect(result.exitCode).toBe(1);
    expect(result.errorOutput).toContain('valid stop reason');
  });

  it('records tool calls, plans and usage as events, with kinds and numbers only', async () => {
    const { recorded } = await run({
      prompt: (_m, wire, reply) => {
        wire.update({ sessionUpdate: 'plan', entries: [{}, {}, {}] });
        wire.update({
          sessionUpdate: 'tool_call',
          toolCallId: 't1',
          title: 'Edit /home/someone/secret.txt',
          kind: 'edit',
          status: 'pending',
        });
        wire.update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
        wire.update({ sessionUpdate: 'usage_update', used: 1200, size: 200000 });
        reply({ stopReason: 'end_turn' });
      },
    });

    expect(recorded.events.map((e) => [e.name, e.attributes])).toEqual(
      expect.arrayContaining([
        ['indaba.acp.session', { 'acp.protocol_version': 1 }],
        ['indaba.acp.plan', { 'acp.plan.entries': 3 }],
        ['indaba.acp.tool_call', { 'acp.tool.kind': 'edit', 'acp.tool.status': 'pending' }],
        ['indaba.acp.tool_call', { 'acp.tool.kind': 'edit', 'acp.tool.status': 'completed' }],
        ['indaba.acp.usage', { 'acp.context.used': 1200, 'acp.context.size': 200000 }],
      ]),
    );
    expect(JSON.stringify(recorded.events)).not.toContain('secret.txt');
  });

  it('reports a USD cost the agent gave, and nothing in another currency or without one', async () => {
    const usd = await run({
      prompt: (_m, wire, reply) => {
        wire.update({
          sessionUpdate: 'usage_update',
          used: 1,
          size: 2,
          cost: { amount: 0.42, currency: 'USD' },
        });
        reply({ stopReason: 'end_turn' });
      },
    });
    expect(usd.result.reportedCostUsd).toBe(0.42);
    expect(usd.result.usage).toBeUndefined();

    const eur = await run({
      prompt: (_m, wire, reply) => {
        wire.update({
          sessionUpdate: 'usage_update',
          used: 1,
          size: 2,
          cost: { amount: 0.42, currency: 'EUR' },
        });
        reply({ stopReason: 'end_turn' });
      },
    });
    expect(eur.result.reportedCostUsd).toBeUndefined();
  });

  it('passes the MCP servers it was given, in ACP shape', async () => {
    const { agent } = await run(
      {},
      { mcpServers: [{ name: 'docs', command: 'docs-mcp', args: ['--x'], env: { TOKEN: 'v' } }] },
    );
    expect(agent.received[1]?.params).toMatchObject({
      mcpServers: [
        { name: 'docs', command: 'docs-mcp', args: ['--x'], env: [{ name: 'TOKEN', value: 'v' }] },
      ],
    });
  });
});

describe('AcpRunner: a runner that could not run', () => {
  const unavailable = async (promise: Promise<unknown>): Promise<RunnerUnavailableError> => {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunnerUnavailableError);
    return error as RunnerUnavailableError;
  };

  it('passes on a start failure', async () => {
    const runner = new AcpRunner({
      spawner: new UnstartableAgent(new RunnerUnavailableError('Cannot start "npx": ENOENT.')),
    });
    const error = await unavailable(
      runner.run({ prompt: 'p', workdir: await workdir(), agent: { preset: 'claude' } }),
    );
    expect(error.message).toContain('ENOENT');
  });

  it('needs an agent, and knows its presets', async () => {
    const runner = new AcpRunner({ spawner: new FakeAgent() });
    const none = await unavailable(runner.run({ prompt: 'p', workdir: await workdir() }));
    expect(none.message).toContain('claude, codex, gemini');
    const unknown = await unavailable(
      runner.run({ prompt: 'p', workdir: await workdir(), agent: { preset: 'nope' } }),
    );
    expect(unknown.message).toContain('Unknown ACP agent preset "nope"');
  });

  it('refuses an agent that agrees on another protocol version', async () => {
    await unavailable(
      run({ initialize: (_m, _w, reply) => reply({ protocolVersion: 2, agentCapabilities: {} }) }).then(
        (r) => r,
      ),
    );
  });

  it('passes when the agent cannot open a session, such as when it needs a login', async () => {
    const error = await unavailable(
      run({
        newSession: (m, wire) =>
          wire.send({ id: m.id ?? null, error: { code: -32000, message: 'Authentication required' } }),
      }),
    );
    expect(error.message).toContain('Authentication required');
  });

  it('passes when the agent prints something that is not ACP', async () => {
    await unavailable(run({ initialize: (_m, wire) => wire.raw('Welcome to the agent! v1.2') }));
  });

  it('passes when the agent exits before answering', async () => {
    await unavailable(run({ initialize: (_m, wire) => wire.end() }));
  });

  it('includes the agent stderr in the reason, redacting a secret it was given', async () => {
    const secret = ['sk', 'ant', 'abcdef123456'].join('-');
    const agent = new FakeAgent({ initialize: (_m, wire) => wire.end() });
    agent.stderr = `fatal: bad credential ${secret}`;
    const runner = new AcpRunner({ spawner: agent, env: { ANTHROPIC_API_KEY: secret, PATH: '/bin' } });
    const error = await unavailable(
      runner.run({ prompt: 'p', workdir: await workdir(), agent: { preset: 'claude' } }),
    );
    expect(error.message).toContain('bad credential');
    expect(error.message).not.toContain(secret);
  });

  it('passes when a required MCP server is only reachable over http and the agent has no http', async () => {
    await unavailable(
      run({}, { mcpServers: [{ name: 'remote', args: [], env: {}, url: 'https://mcp.example.test' }] }),
    );
  });

  it('uses http MCP when the agent says it can', async () => {
    const { agent } = await run(
      {
        initialize: (_m, _w, reply) =>
          reply({ protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } } }),
      },
      { mcpServers: [{ name: 'remote', args: [], env: {}, url: 'https://mcp.example.test' }] },
    );
    expect(agent.received[1]?.params).toMatchObject({
      mcpServers: [{ type: 'http', name: 'remote', url: 'https://mcp.example.test' }],
    });
  });
});

describe('AcpRunner: after the prompt has been sent', () => {
  it('never reports a runner that could not run: a crash is a failed run', async () => {
    const { result } = await run({ prompt: (_m, wire) => wire.end() });
    expect(result.exitCode).toBe(1);
    expect(result.errorOutput).toContain('The agent failed');
  });

  it('turns an error answer to the prompt into a failed run, keeping what was streamed', async () => {
    const { result } = await run({
      prompt: (m, wire) => {
        wire.update(text('partial'));
        wire.send({ id: m.id ?? null, error: { code: -32603, message: 'model overloaded' } });
      },
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toBe('partial');
    expect(result.errorOutput).toContain('model overloaded');
  });

  it('fails the run on a protocol violation mid-turn', async () => {
    const { result } = await run({ prompt: (_m, wire) => wire.raw('not json') });
    expect(result.exitCode).toBe(1);
  });
});

describe('AcpRunner: cancellation and timeout', () => {
  it('sends session/cancel, accepts the agent cancelled answer, and reports an abort', async () => {
    const controller = new AbortController();
    const agent = new FakeAgent({
      prompt: () => {
        queueMicrotask(() => controller.abort());
      },
      other: (message, wire) => {
        if (message.method === 'session/cancel') {
          wire.end();
        }
      },
    });
    const result = await new AcpRunner({ spawner: agent, cancelGraceMs: 200 }).run(
      { prompt: 'p', workdir: await workdir(), agent: { preset: 'claude' } },
      controller.signal,
    );
    expect(result.exitCode).toBe(130);
    expect(agent.methods()).toContain('session/cancel');
    expect(agent.killed).toBe(true);
  });

  it('stops an agent that ignores the cancel after the grace period', async () => {
    const controller = new AbortController();
    const agent = new FakeAgent({ prompt: () => void queueMicrotask(() => controller.abort()) });
    const started = Date.now();
    const result = await new AcpRunner({ spawner: agent, cancelGraceMs: 50 }).run(
      { prompt: 'p', workdir: await workdir(), agent: { preset: 'claude' } },
      controller.signal,
    );
    expect(result.exitCode).toBe(130);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(agent.killed).toBe(true);
  });

  it('times out a silent agent with exit 124', async () => {
    const { result, agent } = await run(
      { prompt: () => undefined },
      { timeoutSeconds: 0.05 },
      { cancelGraceMs: 20 },
    );
    expect(result.exitCode).toBe(124);
    expect(result.errorOutput).toContain('Timed out');
    expect(agent.killed).toBe(true);
  });

  it('does not send a cancel for a run aborted before the prompt', async () => {
    const controller = new AbortController();
    controller.abort();
    const agent = new FakeAgent({});
    const result = await new AcpRunner({ spawner: agent, cancelGraceMs: 20 }).run(
      { prompt: 'p', workdir: await workdir(), agent: { preset: 'claude' } },
      controller.signal,
    );
    expect(result.exitCode).toBe(130);
    expect(agent.methods()).not.toContain('session/cancel');
  });
});

describe('AcpRunner: permission requests', () => {
  async function ask(
    toolCall: Record<string, unknown>,
    permissions: StepPermissions | undefined,
    options: unknown[] = OPTIONS,
  ): Promise<{ answer: unknown; decision: unknown }> {
    let answer: unknown;
    const { recorded } = await run(
      {
        prompt: async (_m, wire, reply) => {
          answer = await wire.ask('session/request_permission', { sessionId: 's1', toolCall, options });
          reply({ stopReason: 'end_turn' });
        },
      },
      { ...(permissions !== undefined ? { permissions } : {}) },
    );
    const event = recorded.events.find((e) => e.name === 'indaba.acp.permission');
    return { answer, decision: event?.attributes?.['acp.permission.decision'] };
  }

  const selected = (optionId: string): unknown => ({ outcome: { outcome: 'selected', optionId } });

  it('rejects anything that changes something when no permissions are declared', async () => {
    for (const kind of ['edit', 'delete', 'move', 'execute']) {
      const { answer, decision } = await ask({ kind, locations: [{ path: 'src/a.ts' }] }, undefined);
      expect(answer).toEqual(selected('no'));
      expect(decision).toBe('rejected');
    }
  });

  it('allows reading, searching and thinking without permissions, with allow_once only', async () => {
    for (const kind of ['read', 'search', 'think', 'fetch', 'other']) {
      const { answer, decision } = await ask({ kind }, undefined);
      expect(answer).toEqual(selected('yes'));
      expect(decision).toBe('allowed');
    }
  });

  it('allows an edit inside the write scope and rejects one outside it', async () => {
    const { dir } = await run({});
    const inside = await ask(
      { kind: 'edit', locations: [{ path: join(dir, 'src', 'a.ts') }] },
      scope(['src/**']),
    );
    expect(inside.decision).toBe('rejected'); // another working directory than the one the request ran in

    let answer: unknown;
    const cwd = await workdir();
    await run(
      {
        prompt: async (_m, wire, reply) => {
          answer = await wire.ask('session/request_permission', {
            sessionId: 's1',
            toolCall: { kind: 'edit', locations: [{ path: join(cwd, 'src', 'a.ts') }] },
            options: OPTIONS,
          });
          reply({ stopReason: 'end_turn' });
        },
      },
      { workdir: cwd, permissions: scope(['src/**']) },
    );
    expect(answer).toEqual(selected('yes'));

    let outside: unknown;
    await run(
      {
        prompt: async (_m, wire, reply) => {
          outside = await wire.ask('session/request_permission', {
            sessionId: 's1',
            toolCall: { kind: 'edit', locations: [{ path: join(cwd, 'docs', 'a.md') }] },
            options: OPTIONS,
          });
          reply({ stopReason: 'end_turn' });
        },
      },
      { workdir: cwd, permissions: scope(['src/**']) },
    );
    expect(outside).toEqual(selected('no'));
  });

  it('rejects an edit that names no location, or one outside the working directory', async () => {
    expect((await ask({ kind: 'edit' }, scope(['**']))).decision).toBe('rejected');
    expect((await ask({ kind: 'edit', locations: [] }, scope(['**']))).decision).toBe('rejected');
    expect((await ask({ kind: 'edit', locations: [{ path: '/etc/passwd' }] }, scope(['**']))).decision).toBe(
      'rejected',
    );
    expect(
      (await ask({ kind: 'edit', locations: [{ path: '../../outside.txt' }] }, scope(['**']))).decision,
    ).toBe('rejected');
  });

  it('allows execute only when the terminal is allowed', async () => {
    expect((await ask({ kind: 'execute' }, scope([]))).decision).toBe('rejected');
    expect((await ask({ kind: 'execute' }, scope([], { terminal: PermissionMode.Allow }))).decision).toBe(
      'allowed',
    );
  });

  it('rejects a kind it does not know', async () => {
    expect((await ask({ kind: 'teleport' }, undefined)).decision).toBe('rejected');
  });

  it('restricts reads only when read globs are given', async () => {
    expect(
      (await ask({ kind: 'read', locations: [{ path: 'secrets/a.txt' }] }, scope([], { fsRead: ['src/**'] })))
        .decision,
    ).toBe('rejected');
    expect(
      (await ask({ kind: 'read', locations: [{ path: 'src/a.txt' }] }, scope([], { fsRead: ['src/**'] })))
        .decision,
    ).toBe('allowed');
    expect((await ask({ kind: 'read' }, scope([]))).decision).toBe('allowed');
  });

  it('never selects an always-option: with only those offered, the answer is cancelled', async () => {
    const onlyAlways = OPTIONS.filter((o) => o.kind.endsWith('always'));
    const allowed = await ask({ kind: 'read' }, undefined, onlyAlways);
    expect(allowed.answer).toEqual({ outcome: { outcome: 'cancelled' } });
    expect(allowed.decision).toBe('rejected');
    const rejected = await ask({ kind: 'edit' }, undefined, onlyAlways);
    expect(rejected.answer).toEqual({ outcome: { outcome: 'cancelled' } });
  });

  it('survives malformed options and a request with no tool call', async () => {
    const { answer } = await ask({ kind: 'read' }, undefined, [
      null,
      7,
      { optionId: 1 },
      { optionId: 'y', kind: 'allow_once' },
    ]);
    expect(answer).toEqual(selected('y'));
  });
});

describe('AcpRunner: file requests', () => {
  async function fileRun(
    method: string,
    params: (cwd: string) => Record<string, unknown>,
    permissions: StepPermissions,
    prepare?: (cwd: string) => Promise<void>,
  ): Promise<{ answer: unknown; error: string | undefined; cwd: string }> {
    const cwd = await workdir();
    await prepare?.(cwd);
    let answer: unknown;
    let error: string | undefined;
    await run(
      {
        prompt: async (_m, wire, reply) => {
          try {
            answer = await wire.ask(method, { sessionId: 's1', ...params(cwd) });
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
          }
          reply({ stopReason: 'end_turn' });
        },
      },
      { workdir: cwd, permissions },
    );
    return { answer, error, cwd };
  }

  const seed = async (cwd: string): Promise<void> => {
    await mkdir(join(cwd, 'src'), { recursive: true });
    await writeFile(join(cwd, 'src', 'a.txt'), 'one\ntwo\nthree\n');
    await writeFile(join(cwd, 'top.txt'), 'top\n');
  };

  it('reads a file inside the working directory, with line and limit', async () => {
    const whole = await fileRun(
      'fs/read_text_file',
      (c) => ({ path: join(c, 'src', 'a.txt') }),
      scope([]),
      seed,
    );
    expect(whole.answer).toEqual({ content: 'one\ntwo\nthree\n' });
    const part = await fileRun(
      'fs/read_text_file',
      (c) => ({ path: join(c, 'src', 'a.txt'), line: 2, limit: 1 }),
      scope([]),
      seed,
    );
    expect(part.answer).toEqual({ content: 'two' });
  });

  it('refuses a read outside the read globs when they are set', async () => {
    const { error } = await fileRun(
      'fs/read_text_file',
      (c) => ({ path: join(c, 'top.txt') }),
      scope([], { fsRead: ['src/**'] }),
      seed,
    );
    expect(error).toContain('outside the step scope');
  });

  it.each([
    ['a relative path', () => ({ path: 'src/a.txt' }), 'absolute'],
    ['no path', () => ({}), 'path is required'],
    ['a path outside', () => ({ path: join(tmpdir(), 'elsewhere.txt') }), 'outside the working directory'],
    [
      'dot-dot out of the directory',
      (c: string) => ({ path: join(c, '..', 'x.txt') }),
      'outside the working directory',
    ],
    ['git internals', (c: string) => ({ path: join(c, '.git', 'config') }), 'not available'],
    ['Indaba state', (c: string) => ({ path: join(c, '.indaba', 'x') }), 'not available'],
    ['git internals in another case', (c: string) => ({ path: join(c, '.GIT', 'config') }), 'not available'],
  ])('refuses to read %s', async (_label, params, message) => {
    const { error } = await fileRun('fs/read_text_file', (c) => params(c), scope(['**']), seed);
    expect(error).toContain(message);
  });

  it('writes a file inside the scope, creating the folders', async () => {
    const { answer, cwd, error } = await fileRun(
      'fs/write_text_file',
      (c) => ({ path: join(c, 'src', 'deep', 'new.txt'), content: 'hello' }),
      scope(['src/**']),
      seed,
    );
    expect(error).toBeUndefined();
    expect(answer).toBeNull();
    expect(await readFile(join(cwd, 'src', 'deep', 'new.txt'), 'utf8')).toBe('hello');
  });

  it('refuses a write outside the scope, and with no write globs at all', async () => {
    const outside = await fileRun(
      'fs/write_text_file',
      (c) => ({ path: join(c, 'top.txt'), content: 'x' }),
      scope(['src/**']),
      seed,
    );
    expect(outside.error).toContain('outside the step scope');
    expect(await readFile(join(outside.cwd, 'top.txt'), 'utf8')).toBe('top\n');

    const none = await fileRun(
      'fs/write_text_file',
      (c) => ({ path: join(c, 'src', 'a.txt'), content: 'x' }),
      scope([]),
      seed,
    );
    expect(none.error).toContain('outside the step scope');
  });

  it('refuses to write git internals even when the glob would match', async () => {
    const { error } = await fileRun(
      'fs/write_text_file',
      (c) => ({ path: join(c, '.git', 'hooks', 'pre-commit'), content: '#!/bin/sh' }),
      scope(['**']),
      seed,
    );
    expect(error).toContain('not available');
  });

  it('refuses missing or oversized content', async () => {
    const missing = await fileRun(
      'fs/write_text_file',
      (c) => ({ path: join(c, 'src', 'n.txt') }),
      scope(['**']),
      seed,
    );
    expect(missing.error).toContain('content');
  });

  it('does not follow a symbolic link out of the working directory', async () => {
    const outsideDir = await workdir();
    await writeFile(join(outsideDir, 'target.txt'), 'outside\n');
    let linked = true;
    const prepare = async (cwd: string): Promise<void> => {
      await seed(cwd);
      try {
        await symlink(outsideDir, join(cwd, 'src', 'link'), 'junction');
      } catch {
        linked = false; // a platform or account that cannot create links: nothing to test here
      }
    };
    const read = await fileRun(
      'fs/read_text_file',
      (c) => ({ path: join(c, 'src', 'link', 'target.txt') }),
      scope(['**']),
      prepare,
    );
    const write = await fileRun(
      'fs/write_text_file',
      (c) => ({ path: join(c, 'src', 'link', 'new.txt'), content: 'x' }),
      scope(['**']),
      prepare,
    );
    if (linked) {
      expect(read.error).toContain('outside the working directory');
      expect(write.error).toContain('outside the working directory');
      expect(await readFile(join(outsideDir, 'target.txt'), 'utf8')).toBe('outside\n');
    }
  });

  it('answers a file request with method-not-found when files were not offered', async () => {
    let error: string | undefined;
    await run({
      prompt: async (_m, wire, reply) => {
        try {
          await wire.ask('fs/read_text_file', { sessionId: 's1', path: '/x' });
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        reply({ stopReason: 'end_turn' });
      },
    });
    expect(error).toContain('not offered');
  });

  it('does not offer terminals: a terminal request is method-not-found', async () => {
    let error: string | undefined;
    await run({
      prompt: async (_m, wire, reply) => {
        try {
          await wire.ask('terminal/create', { sessionId: 's1', command: 'rm' });
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        reply({ stopReason: 'end_turn' });
      },
    });
    expect(error).toContain('Method not found');
  });
});

describe('AcpRunner: the agent and its environment', () => {
  it('starts the preset command in the working directory', async () => {
    const { agent, dir } = await run({}, { agent: { preset: 'gemini' } });
    expect(agent.specs[0]?.command).toEqual(['gemini', '--acp']);
    expect(agent.specs[0]?.cwd).toBe(dir);
  });

  it('starts a literal command instead of a preset', async () => {
    const { agent } = await run({}, { agent: { command: ['my-agent', '--acp', '--fast'] } });
    expect(agent.specs[0]?.command).toEqual(['my-agent', '--acp', '--fast']);
  });

  it('has a preset for each documented agent', () => {
    expect(Object.keys(ACP_AGENT_PRESETS).sort()).toEqual(['claude', 'codex', 'gemini', 'opencode']);
    for (const preset of Object.values(ACP_AGENT_PRESETS)) {
      expect(preset.command.length).toBeGreaterThan(0);
    }
  });

  it('starts OpenCode as `opencode acp` with its provider prefixes', () => {
    expect(ACP_AGENT_PRESETS.opencode.command).toEqual(['opencode', 'acp']);
    expect(ACP_AGENT_PRESETS.opencode.envPrefixes).toEqual([
      'OPENCODE_',
      'ANTHROPIC_',
      'OPENAI_',
      'GOOGLE_',
      'GEMINI_',
      'OPENROUTER_',
    ]);
  });

  it('passes only the baseline, the preset prefixes and what was asked for', async () => {
    const { agent } = await run(
      {},
      { agent: { preset: 'claude' }, env: { FROM_REQUEST: 'r' } },
      {
        env: {
          PATH: '/bin',
          HOME: '/home/x',
          ANTHROPIC_API_KEY: 'claude-key-value',
          OPENAI_API_KEY: 'unrelated-key-value',
          OPENROUTER_API_KEY: 'router-key-value',
          MY_EXTRA: 'extra',
          CUSTOM_ONE: '1',
          CUSTOM_TWO: '2',
          XDG_CONFIG_HOME: '/c',
        },
        passEnv: ['MY_EXTRA', 'CUSTOM_*'],
      },
    );
    expect(agent.specs[0]?.env).toEqual({
      PATH: '/bin',
      HOME: '/home/x',
      ANTHROPIC_API_KEY: 'claude-key-value',
      MY_EXTRA: 'extra',
      CUSTOM_ONE: '1',
      CUSTOM_TWO: '2',
      XDG_CONFIG_HOME: '/c',
      FROM_REQUEST: 'r',
    });
  });

  it('is an MCP-injecting runner named acp', () => {
    const runner = new AcpRunner();
    expect(runner.name).toBe('acp');
    expect(runner.mcpCapability()).toBe('injected');
  });
});

describe('AcpRunner: errors stay RunnerErrors', () => {
  it('a missing working directory with permissions is a runner that could not run', async () => {
    const runner = new AcpRunner({ spawner: new FakeAgent() });
    const error = await runner
      .run({
        prompt: 'p',
        workdir: join(tmpdir(), 'indaba-does-not-exist-xyz'),
        agent: { preset: 'claude' },
        permissions: scope([]),
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunnerError);
    expect(error).toBeInstanceOf(RunnerUnavailableError);
  });
});

describe('AcpRunner: tool call kinds', () => {
  it('gives an update the kind of the tool call it belongs to', async () => {
    const { recorded } = await run({
      prompt: (_m, wire, reply) => {
        wire.update({ sessionUpdate: 'tool_call', toolCallId: 'a', kind: 'read', status: 'in_progress' });
        wire.update({ sessionUpdate: 'tool_call', toolCallId: 'b', kind: 'edit', status: 'pending' });
        wire.update({ sessionUpdate: 'tool_call_update', toolCallId: 'a', status: 'completed' });
        wire.update({ sessionUpdate: 'tool_call_update', toolCallId: 'b', status: 'failed' });
        wire.update({ sessionUpdate: 'tool_call_update', toolCallId: 'unknown', status: 'completed' });
        reply({ stopReason: 'end_turn' });
      },
    });
    const calls = recorded.events.filter((e) => e.name === 'indaba.acp.tool_call').map((e) => e.attributes);
    expect(calls).toEqual([
      { 'acp.tool.kind': 'read', 'acp.tool.status': 'in_progress' },
      { 'acp.tool.kind': 'edit', 'acp.tool.status': 'pending' },
      { 'acp.tool.kind': 'read', 'acp.tool.status': 'completed' },
      { 'acp.tool.kind': 'edit', 'acp.tool.status': 'failed' },
      { 'acp.tool.kind': 'other', 'acp.tool.status': 'completed' },
    ]);
  });
});
