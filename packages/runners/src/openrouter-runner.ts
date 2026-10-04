import type { Runner } from '@indaba/core';
import { DEFAULT_TIMEOUT_SECONDS, RunnerError, type RunRequest, RunResult, TokenUsage } from '@indaba/core';
import { SseParser } from './sse-parser.js';

export type FetchFunction = (input: string, init: RequestInit) => Promise<Response>;

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

/**
 * Streams a chat completion from OpenRouter over SSE. Reasoning tokens are not part of the
 * returned output; only the final content is.
 */
export class OpenRouterRunner implements Runner {
  readonly name = 'openrouter';
  // A private field: invisible to JSON.stringify, inspection and structured logging.
  readonly #apiKey: string;
  private readonly defaultModel: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFunction;

  constructor(options: OpenRouterRunnerOptions) {
    this.#apiKey = options.apiKey;
    this.defaultModel = options.defaultModel;
    this.baseUrl = options.baseUrl ?? 'https://openrouter.ai/api/v1';
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async run(request: RunRequest, signal?: AbortSignal): Promise<RunResult> {
    if (this.#apiKey === '') {
      throw new RunnerError('OPENROUTER_API_KEY is not set.');
    }
    const model = request.model ?? this.defaultModel;
    if (model === undefined) {
      throw new RunnerError('The openrouter runner needs a model (set `model` on the role).');
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

    try {
      const response = await this.fetchFn(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          stream: true,
          usage: { include: true },
          messages: [{ role: 'user', content: request.prompt }],
        }),
        signal: controller.signal,
      });

      if (response.status >= 400) {
        const body = (await response.text()).slice(0, MAX_ERROR_BODY);
        return finish(1, `OpenRouter HTTP ${response.status}: ${body}`);
      }
      if (response.body === null) {
        return finish(1, 'OpenRouter transport error: the response has no body.');
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
      if (timedOut) {
        return finish(124, `\nTimed out after ${timeoutSeconds} seconds.`);
      }
      if (controller.signal.aborted) {
        return finish(130, '\nAborted.');
      }
      const message = error instanceof Error ? error.message : 'unknown error';
      return finish(1, `OpenRouter transport error: ${message}`);
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
