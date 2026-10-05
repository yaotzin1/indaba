import { RunnerError, RunnerUnavailableError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { type FetchFunction, OpenRouterRunner } from '../src/index.js';

const KEY = ['unit', 'key', '9f8e7d6c'].join('-');
const encoder = new TextEncoder();

function sse(...events: string[]): string {
  return events.map((e) => `${e}\n\n`).join('');
}

function data(value: unknown): string {
  return `data: ${JSON.stringify(value)}`;
}

/** Streams the text in the given pieces so chunk boundaries fall mid-event. */
function streamOf(...pieces: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) {
        controller.enqueue(encoder.encode(piece));
      }
      controller.close();
    },
  });
}

interface Captured {
  url: string;
  init: RequestInit;
}

function recordingFetch(respond: () => Response): { fetch: FetchFunction; calls: Captured[] } {
  const calls: Captured[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return respond();
    },
  };
}

describe('OpenRouterRunner', () => {
  it('streams content and usage and ignores reasoning tokens', async () => {
    const body = sse(
      ': OPENROUTER PROCESSING',
      data({ choices: [{ delta: { reasoning: 'thinking...' } }] }),
      data({ choices: [{ delta: { content: 'Hel' } }] }),
      data({ choices: [{ delta: { content: 'lo' } }] }),
      data({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } }),
      'data: [DONE]',
    );
    const { fetch, calls } = recordingFetch(
      () => new Response(streamOf(body.slice(0, 40), body.slice(40)), { status: 200 }),
    );
    let streamed = '';
    const runner = new OpenRouterRunner({ apiKey: KEY, fetch });

    const result = await runner.run({
      prompt: 'say hi',
      workdir: '.',
      model: 'anthropic/claude-3.7-sonnet:thinking',
      onOutput: (c) => {
        streamed += c;
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('Hello');
    expect(streamed).toBe('Hello');
    expect(result.usage?.inputTokens).toBe(12);
    expect(result.usage?.outputTokens).toBe(5);
    expect(result.model).toBe('anthropic/claude-3.7-sonnet:thinking');

    const call = calls[0];
    expect(call?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(call?.init.method).toBe('POST');
    const sent = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
    expect(sent.stream).toBe(true);
    expect(sent.model).toBe('anthropic/claude-3.7-sonnet:thinking');
    expect(sent.messages).toEqual([{ role: 'user', content: 'say hi' }]);
  });

  it('reports no usage when the provider sends none', async () => {
    const { fetch } = recordingFetch(
      () => new Response(streamOf(sse(data({ choices: [{ delta: { content: 'x' } }] }), 'data: [DONE]'))),
    );
    const result = await new OpenRouterRunner({ apiKey: KEY, fetch }).run({
      prompt: 'p',
      workdir: '.',
      model: 'm',
    });

    expect(result.usage).toBeUndefined();
  });

  it('reports HTTP errors without the key', async () => {
    const { fetch } = recordingFetch(() => new Response(`{"error":"upstream said ${KEY}"}`, { status: 500 }));
    const result = await new OpenRouterRunner({ apiKey: KEY, fetch }).run({
      prompt: 'x',
      workdir: '.',
      model: 'm',
    });

    expect(result.exitCode).toBe(1);
    expect(result.errorOutput).toContain('HTTP 500');
    expect(result.errorOutput).not.toContain(KEY);
    expect(result.errorOutput).toContain('[redacted]');
  });

  it('redacts the key from transport errors', async () => {
    const fetch: FetchFunction = async () => {
      throw new Error(`connect failed for Bearer ${KEY}`);
    };
    const error = await new OpenRouterRunner({ apiKey: KEY, fetch })
      .run({ prompt: 'x', workdir: '.', model: 'm' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RunnerUnavailableError);
    expect((error as Error).message).toContain('unreachable');
    expect((error as Error).message).not.toContain(KEY);
    expect((error as Error).cause).toBeUndefined();
  });

  it('treats a rejected key as a runner that could not run, without echoing the body', async () => {
    const { fetch } = recordingFetch(() => new Response(`{"error":"bad key ${KEY}"}`, { status: 401 }));
    const error = await new OpenRouterRunner({ apiKey: KEY, fetch })
      .run({ prompt: 'x', workdir: '.', model: 'm' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RunnerUnavailableError);
    expect((error as Error).message).toContain('HTTP 401');
    expect((error as Error).message).not.toContain(KEY);
  });

  it('sends the key only in the Authorization header and never exposes it on the object', async () => {
    const { fetch, calls } = recordingFetch(() => new Response(streamOf('data: [DONE]\n\n')));
    const runner = new OpenRouterRunner({ apiKey: KEY, fetch });
    await runner.run({ prompt: 'p', workdir: '.', model: 'm' });

    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(String(calls[0]?.init.body)).not.toContain(KEY);
    expect(JSON.stringify(runner)).not.toContain(KEY);
    expect(Object.values(runner).join('|')).not.toContain(KEY);
  });

  it('needs a key and a model', async () => {
    const { fetch } = recordingFetch(() => new Response(streamOf('data: [DONE]\n\n')));

    const noKey = new OpenRouterRunner({ apiKey: '', fetch }).run({ prompt: 'x', workdir: '.', model: 'm' });
    await expect(noKey).rejects.toThrow(RunnerError);
    await expect(noKey).rejects.toThrow('OPENROUTER_API_KEY');

    const noModel = new OpenRouterRunner({ apiKey: 'k', fetch }).run({ prompt: 'x', workdir: '.' });
    await expect(noModel).rejects.toThrow(RunnerError);

    const fallback = await new OpenRouterRunner({ apiKey: 'k', fetch, defaultModel: 'dm' }).run({
      prompt: 'x',
      workdir: '.',
    });
    expect(fallback.model).toBe('dm');
  });

  it('uses a custom base url without a doubled slash', async () => {
    const { fetch, calls } = recordingFetch(() => new Response(streamOf('data: [DONE]\n\n')));
    await new OpenRouterRunner({ apiKey: 'k', fetch, baseUrl: 'https://proxy.example/v1/' }).run({
      prompt: 'x',
      workdir: '.',
      model: 'm',
    });

    expect(calls[0]?.url).toBe('https://proxy.example/v1/chat/completions');
  });

  const hanging: FetchFunction = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted by signal')));
    });

  it('times out with exit code 124', async () => {
    const result = await new OpenRouterRunner({ apiKey: KEY, fetch: hanging }).run({
      prompt: 'x',
      workdir: '.',
      model: 'm',
      timeoutSeconds: 0.2,
    });

    expect(result.exitCode).toBe(124);
    expect(result.errorOutput).toContain('Timed out');
  });

  it('aborts with exit code 130 and keeps the partial content', async () => {
    const controller = new AbortController();
    const stalled: FetchFunction = async (_url, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode(`${data({ choices: [{ delta: { content: 'part' } }] })}\n\n`));
          init.signal?.addEventListener('abort', () => c.error(new Error('aborted by signal')));
        },
      });
      return new Response(stream, { status: 200 });
    };
    const result = await new OpenRouterRunner({ apiKey: KEY, fetch: stalled }).run(
      {
        prompt: 'x',
        workdir: '.',
        model: 'm',
        onOutput: () => controller.abort(),
      },
      controller.signal,
    );

    expect(result.exitCode).toBe(130);
    expect(result.output).toBe('part');
  });
});
