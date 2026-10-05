import { RunnerError, RunnerUnavailableError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  type FetchFunction,
  OpenAiCompatibleRunner,
  OpenRouterRunner,
  openAiCompatibleFromEnv,
  RunnerRegistry,
} from '../src/index.js';

const KEY = ['compat', 'key', '1a2b3c4d'].join('-');
const encoder = new TextEncoder();

function reply(...events: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(events.map((e) => `${e}\n\n`).join('')));
        controller.close();
      },
    }),
  );
}

const content = (text: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`;

function recording(): { fetch: FetchFunction; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return reply(content('hi'), 'data: [DONE]');
    },
  };
}

const request = { prompt: 'p', workdir: '.', model: 'm' };

describe('OpenAiCompatibleRunner', () => {
  it('posts to its own base URL under its own name, asking for usage the OpenAI way', async () => {
    const { fetch, calls } = recording();
    const runner = new OpenAiCompatibleRunner({
      name: 'local',
      baseUrl: 'http://localhost:11434/v1/',
      apiKey: KEY,
      extraHeaders: { 'X-Team': 'blue' },
      fetch,
    });

    const result = await runner.run(request);

    expect(runner.name).toBe('local');
    expect(result.output).toBe('hi');
    expect(calls[0]?.url).toBe('http://localhost:11434/v1/chat/completions');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers['X-Team']).toBe('blue');
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body).not.toHaveProperty('usage');
  });

  it('does not let extra headers replace the key', async () => {
    const { fetch, calls } = recording();
    await new OpenAiCompatibleRunner({
      name: 'x',
      baseUrl: 'https://api.example.test/v1',
      apiKey: KEY,
      extraHeaders: { Authorization: 'Bearer something-else' },
      fetch,
    }).run(request);
    expect(calls[0]?.init.headers).toHaveProperty('Authorization', `Bearer ${KEY}`);
  });

  it('names the variable to set when the key is missing, as a runner that could not run', async () => {
    const error = await new OpenAiCompatibleRunner({
      name: 'openai',
      baseUrl: 'https://api.example.test/v1',
      apiKey: '',
      apiKeyEnv: 'OPENAI_API_KEY',
    })
      .run(request)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunnerUnavailableError);
    expect((error as Error).message).toBe('OPENAI_API_KEY is not set.');
  });

  it('needs a model from the request or its default', async () => {
    const { fetch } = recording();
    const runner = new OpenAiCompatibleRunner({
      name: 'x',
      baseUrl: 'https://a.test/v1',
      apiKey: KEY,
      fetch,
    });
    await expect(runner.run({ prompt: 'p', workdir: '.' })).rejects.toBeInstanceOf(RunnerUnavailableError);
    const withDefault = new OpenAiCompatibleRunner({
      name: 'x',
      baseUrl: 'https://a.test/v1',
      apiKey: KEY,
      defaultModel: 'dflt',
      fetch,
    });
    expect((await withDefault.run({ prompt: 'p', workdir: '.' })).model).toBe('dflt');
  });

  it('runs a keyless server without an Authorization header', async () => {
    const { fetch, calls } = recording();
    const result = await new OpenAiCompatibleRunner({
      name: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      keyless: true,
      fetch,
    }).run(request);
    expect(result.exitCode).toBe(0);
    expect(calls[0]?.init.headers).not.toHaveProperty('Authorization');
  });

  it.each([
    ['not a url', 'valid URL'],
    ['file:///etc/passwd', 'http(s)'],
    ['ftp://example.test/v1', 'http(s)'],
    ['https://user:pass@example.test/v1', 'credentials'],
  ])('refuses the base URL %s', (baseUrl, message) => {
    expect(() => new OpenAiCompatibleRunner({ name: 'x', baseUrl, apiKey: KEY })).toThrow(message);
    expect(() => new OpenAiCompatibleRunner({ name: 'x', baseUrl, apiKey: KEY })).toThrow(RunnerError);
  });

  it('does not put the key in a URL error', () => {
    try {
      new OpenAiCompatibleRunner({ name: 'x', baseUrl: `https://u:${KEY}@a.test/v1`, apiKey: KEY });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(KEY);
    }
  });
});

describe('OpenRouterRunner stays what it was', () => {
  it('keeps its name, base URL, usage request and messages', async () => {
    const { fetch, calls } = recording();
    const runner = new OpenRouterRunner({ apiKey: KEY, fetch });
    await runner.run(request);

    expect(runner.name).toBe('openrouter');
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      model: 'm',
      stream: true,
      usage: { include: true },
      messages: [{ role: 'user', content: 'p' }],
    });
    await expect(new OpenRouterRunner({ apiKey: '' }).run(request)).rejects.toThrow(
      'OPENROUTER_API_KEY is not set.',
    );
  });
});

describe('openAiCompatibleFromEnv', () => {
  const reserved = ['shell', 'openrouter'];

  it('builds one runner per configured endpoint', () => {
    const runners = openAiCompatibleFromEnv(
      {
        INDABA_OPENAI_COMPAT_LM_STUDIO_BASE_URL: 'http://localhost:1234/v1',
        INDABA_OPENAI_COMPAT_OPENAI_BASE_URL: 'https://api.openai.com/v1',
        INDABA_OPENAI_COMPAT_OPENAI_KEY_ENV: 'OPENAI_API_KEY',
        INDABA_OPENAI_COMPAT_OPENAI_MODEL: 'gpt-x',
        OPENAI_API_KEY: KEY,
      },
      { reserved },
    );
    expect(runners.map((r) => r.name)).toEqual(['lm-studio', 'openai']);
  });

  it('reads the key from the variable named by KEY_ENV, and is keyless without one', async () => {
    const { fetch, calls } = recording();
    const [local, keyed] = openAiCompatibleFromEnv(
      {
        INDABA_OPENAI_COMPAT_A_BASE_URL: 'http://localhost:1/v1',
        INDABA_OPENAI_COMPAT_B_BASE_URL: 'https://b.test/v1',
        INDABA_OPENAI_COMPAT_B_KEY_ENV: 'B_KEY',
        B_KEY: KEY,
      },
      { fetch },
    );
    await local?.run(request);
    await keyed?.run(request);
    expect(calls[0]?.init.headers).not.toHaveProperty('Authorization');
    expect(calls[1]?.init.headers).toHaveProperty('Authorization', `Bearer ${KEY}`);
  });

  it('reports a missing key as a runner that could not run, naming only the variable', async () => {
    const [runner] = openAiCompatibleFromEnv({
      INDABA_OPENAI_COMPAT_X_BASE_URL: 'https://x.test/v1',
      INDABA_OPENAI_COMPAT_X_KEY_ENV: 'X_KEY',
      INDABA_OPENAI_COMPAT_X_MODEL: 'm',
    });
    const error = await runner?.run({ prompt: 'p', workdir: '.' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunnerUnavailableError);
    expect((error as Error).message).toBe('X_KEY is not set.');
  });

  it('ignores unrelated variables and an empty URL', () => {
    expect(
      openAiCompatibleFromEnv({
        PATH: '/bin',
        INDABA_OPENAI_COMPAT_X_BASE_URL: '  ',
        INDABA_OPENAI_COMPAT_X_MODEL: 'm',
      }),
    ).toEqual([]);
  });

  it('refuses to redefine a built-in runner', () => {
    expect(() =>
      openAiCompatibleFromEnv({ INDABA_OPENAI_COMPAT_SHELL_BASE_URL: 'https://x.test/v1' }, { reserved }),
    ).toThrow('built-in runner');
  });

  it('refuses a KEY_ENV that is not a variable name', () => {
    expect(() =>
      openAiCompatibleFromEnv({
        INDABA_OPENAI_COMPAT_X_BASE_URL: 'https://x.test/v1',
        INDABA_OPENAI_COMPAT_X_KEY_ENV: 'sk-live-123 456',
      }),
    ).toThrow('must be the name of an environment variable');
  });

  it('refuses a malformed base URL at once, without echoing it', () => {
    expect(() => openAiCompatibleFromEnv({ INDABA_OPENAI_COMPAT_X_BASE_URL: 'ftp://x.test' })).toThrow(
      'http(s)',
    );
  });
});

describe('RunnerRegistry', () => {
  it('reports an unknown runner as one that could not run', () => {
    const registry = RunnerRegistry.withDefaults();
    expect(() => registry.get('nope')).toThrow(RunnerUnavailableError);
  });
});
