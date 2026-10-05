import { type McpServerDefinition, RunnerError, RunnerUnavailableError } from '@indaba/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeRunner,
  CommandRunner,
  type FetchFunction,
  McpConfigWriter,
  OpenRouterRunner,
  RunnerRegistry,
  SseParser,
} from '../src/index.js';
import { FakeSpawner, TMP } from './support.js';

const encoder = new TextEncoder();

function stream(...pieces: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) {
        controller.enqueue(encoder.encode(piece));
      }
      controller.close();
    },
  });
}

const event = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`;

async function runWith(fetch: FetchFunction, onOutput?: (chunk: string) => void, signal?: AbortSignal) {
  return await new OpenRouterRunner({ apiKey: 'key-for-tests', fetch }).run(
    { prompt: 'p', workdir: '.', model: 'm', ...(onOutput === undefined ? {} : { onOutput }) },
    signal,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('McpConfigWriter edge cases', () => {
  it('writes a null command for a server with neither command nor url, and an empty one for Codex', () => {
    const bare: McpServerDefinition = { name: 'bare', args: [], env: {} };

    const decoded = JSON.parse(McpConfigWriter.claudeJson([bare])) as { mcpServers: Record<string, unknown> };

    expect(decoded.mcpServers.bare).toEqual({ command: null, args: [] });
    expect(McpConfigWriter.codexArgs([bare])).toEqual(['-c', 'mcp_servers.bare.command=""']);
  });

  it('translates url servers, args and env for Codex', () => {
    const args = McpConfigWriter.codexArgs([
      { name: 'remote', args: [], env: {}, url: 'https://example.invalid/mcp' },
      { name: 'local', command: 'run', args: ['a'], env: { K: 'v' } },
    ]);

    expect(args).toEqual([
      '-c',
      'mcp_servers.remote.url="https://example.invalid/mcp"',
      '-c',
      'mcp_servers.local.command="run"',
      '-c',
      'mcp_servers.local.args=["a"]',
      '-c',
      'mcp_servers.local.env={K = "v"}',
    ]);
  });

  it('removes its directory and reports a RunnerError when writing fails midway', async () => {
    const poisoned = {
      name: 'x',
      args: [],
      env: {},
      get url(): string {
        throw new Error('cannot serialise');
      },
    } satisfies McpServerDefinition;

    const error = await McpConfigWriter.writeClaudeFile([poisoned]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RunnerError);
    expect((error as Error).message).toBe('Cannot write the temporary MCP configuration file.');
  });
});

describe('CommandRunner template', () => {
  it('substitutes an absent model with an empty argument', async () => {
    const spawner = new FakeSpawner();
    const runner = new CommandRunner('t', ['agent', '--model', '{model}', '{prompt}'], { spawner });

    await runner.run({ prompt: 'hi', workdir: TMP });
    await runner.run({ prompt: 'hi', workdir: TMP, model: 'm1' });

    expect(spawner.specs[0]?.command).toEqual(['agent', '--model', '', 'hi']);
    expect(spawner.specs[1]?.command).toEqual(['agent', '--model', 'm1', 'hi']);
  });
});

describe('RunnerRegistry.withDefaults injection', () => {
  it('hands the spawner to the CLI runners and the fetch to openrouter', async () => {
    const spawner = new FakeSpawner();
    const calls: string[] = [];
    const fetch: FetchFunction = async (url) => {
      calls.push(url);
      return new Response(stream('data: [DONE]\n\n'));
    };
    const registry = RunnerRegistry.withDefaults({ OPENROUTER_API_KEY: 'k' }, { spawner, fetch });

    await registry.get('claude-code').run({ prompt: 'p', workdir: TMP });
    await registry.get('openrouter').run({ prompt: 'p', workdir: TMP, model: 'm' });

    expect(spawner.specs).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('keeps ClaudeRunner usable without servers when given only a spawner', async () => {
    const spawner = new FakeSpawner();

    await new ClaudeRunner({ spawner }).run({ prompt: 'p', workdir: TMP });

    expect(spawner.specs[0]?.command[0]).toBe('claude');
  });
});

describe('SseParser lines', () => {
  it('ignores fields other than data', () => {
    expect(new SseParser().feed('event: ping\nid: 7\ndata: x\n\n')).toEqual(['x']);
    expect(new SseParser().feed('event: ping\n\n')).toEqual([]);
  });
});

describe('OpenRouterRunner stream handling', () => {
  it('uses the global fetch when none is injected', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(url);
      return new Response(stream(event({ choices: [{ delta: { content: 'ok' } }] }), 'data: [DONE]\n\n'));
    });

    const result = await new OpenRouterRunner({ apiKey: 'k' }).run({ prompt: 'p', workdir: '.', model: 'm' });

    expect(result.output).toBe('ok');
    expect(seen).toEqual(['https://openrouter.ai/api/v1/chat/completions']);
  });

  it('finishes when the stream ends without a DONE marker', async () => {
    const result = await runWith(
      async () => new Response(stream(event({ choices: [{ delta: { content: 'a' } }] }))),
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('a');
  });

  it('fails when the response has no body', async () => {
    const result = await runWith(async () => new Response(null, { status: 200 }));

    expect(result.exitCode).toBe(1);
    expect(result.errorOutput).toContain('no body');
  });

  it('skips events that are not JSON objects or carry no usable content', async () => {
    const chunks: string[] = [];
    const body = stream(
      'data: not json\n\n',
      'data: [1,2]\n\n',
      event({ choices: 'nope' }),
      event({ choices: [] }),
      event({ choices: ['text'] }),
      event({ choices: [{ delta: 'text' }] }),
      event({ choices: [{ delta: { content: '' } }] }),
      event({ choices: [{ delta: { content: 7 } }] }),
      event({ choices: [{ delta: { content: 'kept' } }] }),
      'data: [DONE]\n\n',
    );

    const result = await runWith(
      async () => new Response(body),
      (c) => chunks.push(c),
    );

    expect(result.output).toBe('kept');
    expect(chunks).toEqual(['kept']);
    expect(result.usage).toBeUndefined();
  });

  it('counts a missing or fractional token figure as zero', async () => {
    const body = stream(
      event({ usage: { prompt_tokens: 1.5 } }),
      event({ usage: { completion_tokens: 4 } }),
      'data: [DONE]\n\n',
    );

    const result = await runWith(async () => new Response(body));

    expect(result.usage?.inputTokens).toBe(0);
    expect(result.usage?.outputTokens).toBe(4);
  });

  it('is a runner that could not run when the request fails with something that is not an Error', async () => {
    const error = await runWith(async () => {
      throw 'plain failure';
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RunnerUnavailableError);
    expect((error as Error).message).toContain('unknown error');
  });

  it('reports a failure after the response started as a failed result, not a runner that could not run', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw 'plain failure';
      },
    });
    const result = await runWith(async () => new Response(body));

    expect(result.exitCode).toBe(1);
    expect(result.errorOutput).toContain('unknown error');
  });

  it('does not call fetch for a signal that is already aborted', async () => {
    const fetch: FetchFunction = (_url, init) =>
      new Promise((_resolve, reject) => {
        if (init.signal?.aborted === true) {
          reject(new Error('aborted before sending'));
        }
      });

    const result = await runWith(fetch, undefined, AbortSignal.abort());

    expect(result.exitCode).toBe(130);
    expect(result.errorOutput).toContain('Aborted');
  });
});
