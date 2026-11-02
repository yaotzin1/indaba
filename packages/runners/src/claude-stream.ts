import { TokenUsage } from '@indaba/core';

/**
 * What Claude Code printed with `--output-format stream-json --verbose`, reduced to what a runner reports.
 * `usage`, `costUsd` and `model` are present only when the CLI gave them in a well-formed way.
 */
export interface ClaudeStreamResult {
  /** The `result` of the final event, else the text of the last assistant message that has text, else ''. */
  readonly text: string;
  /** A `result` event was found. */
  readonly complete: boolean;
  /** Some line was a JSON object, so the output is the CLI's stream and not a plain message. */
  readonly recognised: boolean;
  readonly usage?: TokenUsage;
  readonly costUsd?: number;
  readonly model?: string;
}

type Fields = Readonly<Record<string, unknown>>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(source: Fields, key: string): unknown {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** A token count: a whole number small enough to add to others without losing precision. */
function tokens(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

function parseLine(raw: string): Fields | undefined {
  const text = raw.trim();
  if (text === '') {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(text);
    return isFields(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Prompt tokens are the fresh ones plus those written to and read from the cache; absent cache fields are 0. */
function usageOf(value: unknown): TokenUsage | undefined {
  if (!isFields(value)) {
    return undefined;
  }
  const input = tokens(field(value, 'input_tokens'));
  const output = tokens(field(value, 'output_tokens'));
  if (input === undefined || output === undefined) {
    return undefined;
  }
  let cached = 0;
  for (const key of ['cache_creation_input_tokens', 'cache_read_input_tokens']) {
    const present = field(value, key);
    if (present === undefined) {
      continue;
    }
    const extra = tokens(present);
    if (extra === undefined) {
      return undefined;
    }
    cached += extra;
  }
  const prompt = input + cached;
  return Number.isSafeInteger(prompt) ? new TokenUsage(prompt, output) : undefined;
}

function modelOf(value: unknown): string | undefined {
  if (!isFields(value)) {
    return undefined;
  }
  const names = Object.keys(value);
  const only = names.length === 1 ? names[0] : undefined;
  return only !== undefined && MODEL_NAME.test(only) ? only : undefined;
}

function assistantText(event: Fields): string | undefined {
  const message = field(event, 'message');
  const content = isFields(message) ? field(message, 'content') : undefined;
  if (!Array.isArray(content)) {
    return undefined;
  }
  let text: string | undefined;
  for (const block of content as readonly unknown[]) {
    if (isFields(block) && field(block, 'type') === 'text') {
      const part = field(block, 'text');
      if (typeof part === 'string') {
        text = (text ?? '') + part;
      }
    }
  }
  return text;
}

/**
 * Reads the output of `claude -p --output-format stream-json --verbose`: one JSON object per line. The output
 * is untrusted: a line that is not an object is skipped, only named fields are read and each is checked.
 */
export function parseClaudeStream(stdout: string): ClaudeStreamResult {
  let lastAssistant = '';
  let final: Fields | undefined;
  let recognised = false;

  for (const raw of stdout.split('\n')) {
    const event = parseLine(raw);
    if (event === undefined) {
      continue;
    }
    recognised = true;
    const type = field(event, 'type');
    if (type === 'result') {
      final = event;
    } else if (type === 'assistant') {
      const text = assistantText(event);
      if (text !== undefined) {
        lastAssistant = text;
      }
    }
  }

  if (final === undefined) {
    return { text: lastAssistant, complete: false, recognised };
  }

  // An error result (error_max_turns, error_during_execution) has no result string: its usage still counts.
  const answer = field(final, 'result');
  const usage = usageOf(field(final, 'usage'));
  const costUsd = count(field(final, 'total_cost_usd'));
  const model = modelOf(field(final, 'modelUsage'));
  return {
    text: typeof answer === 'string' ? answer : lastAssistant,
    complete: true,
    recognised,
    ...(usage !== undefined ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(model !== undefined ? { model } : {}),
  };
}
