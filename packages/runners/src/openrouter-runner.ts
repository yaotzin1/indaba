import type { Runner } from '@indaba/core';
import {
  DEFAULT_TIMEOUT_SECONDS,
  RunnerError,
  RunnerUnavailableError,
  type RunRequest,
  RunResult,
  TokenUsage,
} from '@indaba/core';
import { SseParser } from './sse-parser.js';

export type FetchFunction = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAiCompatibleRunnerOptions {
  /** The name workflows use to select this runner. */
  readonly name: string;
  /** How messages refer to the service, e.g. "OpenRouter". Defaults to the name. */
  readonly label?: string;
  /** Supplied by the composition root. Never read from the environment here, never logged. */
  readonly apiKey: string;
  /** Only named in messages, so the person knows which variable to set. */
  readonly apiKeyEnv?: string;
  /** A server that takes no key (a local one): an empty key is then fine and no Authorization is sent. */
  readonly keyless?: boolean;
  /** An `http:` or `https:` URL without credentials, up to the version segment (`.../v1`). */
  readonly baseUrl: string;
  readonly defaultModel?: string;
  readonly extraHeaders?: Readonly<Record<string, string>>;
  /** Added to the request body; how a provider is asked to report usage differs. */
  readonly requestExtras?: Readonly<Record<string, unknown>>;
  /** Defaults to the global `fetch`; tests inject a fake. */
  readonly fetch?: FetchFunction;
}

export interface OpenRouterRunnerOptions {
  /** Supplied by the composition root. Never read from the environment here, never logged. */
  readonly apiKey: string;
  readonly defaultModel?: string;
  readonly baseUrl?: string;
  /** Defaults to the global `fetch`; tests inject a fake. */
  readonly fetch?: FetchFunction;
}

const MAX_ERROR_BODY = 2000;
const REDACTED = '[redacted]';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The base URL is configuration, never data from an agent; still, only plain http(s) without credentials. */
function checkBaseUrl(raw: string, label: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RunnerError(`The ${label} base URL is not a valid URL.`);
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '') {
    throw new RunnerError(`The ${label} base URL must be http(s) and must not contain credentials.`);
  }
  return raw;
}

/**
 * Streams a chat completion over SSE from any OpenAI-compatible endpoint (OpenRouter, OpenAI, vLLM,
 * Ollama, LM Studio, ...). Reasoning tokens are not part of the returned output; only the final
 * content is. Throws RunnerUnavailableError, so a workflow can fall back, only when nothing has been
 * run: no key, no model, a rejected key, or no response at all.
 */
export class OpenAiCompatibleRunner implements Runner {
  readonly name: string;
  // A private field: invisible to JSON.stringify, inspection and structured logging.
  readonly #apiKey: string;
  private readonly label: string;
  private readonly apiKeyEnv: string | undefined;
  private readonly keyless: boolean;
  private readonly defaultModel: string | undefined;
  private readonly baseUrl: string;
  private readonly extraHeaders: Readonly<Record<string, string>>;
  private readonly requestExtras: Readonly<Record<string, unknown>>;
  private readonly fetchFn: FetchFunction;

  constructor(options: OpenAiCompatibleRunnerOptions) {
    this.name = options.name;
    this.label = options.label ?? options.name;
    this.#apiKey = options.apiKey;
    this.apiKeyEnv = options.apiKeyEnv;
    this.keyless = options.keyless === true;
    this.defaultModel = options.defaultModel;
    this.baseUrl = checkBaseUrl(options.baseUrl, this.label);
    this.extraHeaders = options.extraHeaders ?? {};
    this.requestExtras = options.requestExtras ?? { stream_options: { include_usage: true } };
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async run(request: RunRequest, signal?: AbortSignal): Promise<RunResult> {
    if (this.#apiKey === '' && !this.keyless) {
      throw new RunnerUnavailableError(`${this.apiKeyEnv ?? `The ${this.label} API key`} is not set.`);
    }
    const model = request.model ?? this.defaultModel;
    if (model === undefined) {
      throw new RunnerUnavailableError(`The ${this.name} runner needs a model (set \`model\` on the role).`);
    }

    const started = performance.now();
    const timeoutSeconds = request.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      Math.max(0, timeoutSeconds * 1000),
    );
    const onAbort = (): void => controller.abort();
    if (signal?.aborted === true) {
      controller.abort();
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    const parser = new SseParser();
    let content = '';
    let usage: TokenUsage | undefined;
    const finish = (exitCode: number, errorOutput: string, withUsage = false): RunResult =>
      new RunResult({
        exitCode,
        output: content,
        errorOutput: this.redact(errorOutput),
        durationMs: performance.now() - started,
        model,
        ...(withUsage && usage !== undefined ? { usage } : {}),
      });

    let answered = false;
    try {
      const response = await this.fetchFn(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          ...this.extraHeaders,
          ...(this.#apiKey === '' ? {} : { Authorization: `Bearer ${this.#apiKey}` }),
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          stream: true,
          ...this.requestExtras,
          messages: [{ role: 'user', content: request.prompt }],
        }),
        signal: controller.signal,
      });
      answered = true;

      if (response.status === 401 || response.status === 403) {
        throw new RunnerUnavailableError(`${this.label} rejected the API key (HTTP ${response.status}).`);
      }
      if (response.status >= 400) {
        const body = (await response.text()).slice(0, MAX_ERROR_BODY);
        return finish(1, `${this.label} HTTP ${response.status}: ${body}`);
      }
      if (response.body === null) {
        return finish(1, `${this.label} transport error: the response has no body.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const cancel = (): void => void reader.cancel().catch(() => undefined);
      controller.signal.addEventListener('abort', cancel, { once: true });
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        for (const payload of parser.feed(decoder.decode(chunk.value, { stream: true }))) {
          if (payload === '[DONE]') {
            done = true;
            break;
          }
          const consumed = this.consume(payload, request);
          content += consumed.content;
          usage = consumed.usage ?? usage;
        }
      }
      await reader.cancel().catch(() => undefined);
    } catch (error) {
      if (error instanceof RunnerUnavailableError) {
        throw error;
      }
      if (timedOut) {
        return finish(124, `\nTimed out after ${timeoutSeconds} seconds.`);
      }
      if (controller.signal.aborted) {
        return finish(130, '\nAborted.');
      }
      const message = error instanceof Error ? error.message : 'unknown error';
      if (!answered) {
        // No response at all: nothing ran, so the next runner of a chain may be tried.
        // No `cause`: the original error can carry the key, and only the redacted text may travel.
        throw new RunnerUnavailableError(`${this.label} is unreachable: ${this.redact(message)}`);
      }
      return finish(1, `${this.label} transport error: ${message}`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    return finish(0, '', true);
  }

  /** Reads one event; forwards content to the output sink as it arrives. */
  private consume(payload: string, request: RunRequest): { content: string; usage?: TokenUsage } {
    const event = parseJson(payload);
    if (!isRecord(event)) {
      return { content: '' };
    }

    let content = '';
    const first = Array.isArray(event.choices) ? event.choices[0] : undefined;
    const delta = isRecord(first) ? first.delta : undefined;
    if (isRecord(delta) && typeof delta.content === 'string' && delta.content !== '') {
      content = delta.content;
      request.onOutput?.(content);
    }

    const raw = event.usage;
    if (isRecord(raw)) {
      return {
        content,
        usage: new TokenUsage(
          Number.isInteger(raw.prompt_tokens) ? Number(raw.prompt_tokens) : 0,
          Number.isInteger(raw.completion_tokens) ? Number(raw.completion_tokens) : 0,
        ),
      };
    }
    return { content };
  }

  /** The key can come back in an upstream error body or a proxy message. */
  private redact(text: string): string {
    return this.#apiKey === '' ? text : text.replaceAll(this.#apiKey, REDACTED);
  }
}

/** OpenRouter, as it has always behaved: the same name, messages, base URL and usage request. */
export class OpenRouterRunner extends OpenAiCompatibleRunner {
  constructor(options: OpenRouterRunnerOptions) {
    super({
      name: 'openrouter',
      label: 'OpenRouter',
      apiKey: options.apiKey,
      apiKeyEnv: 'OPENROUTER_API_KEY',
      baseUrl: options.baseUrl ?? 'https://openrouter.ai/api/v1',
      requestExtras: { usage: { include: true } },
      ...(options.defaultModel !== undefined ? { defaultModel: options.defaultModel } : {}),
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    });
  }
}
