import { describe, expect, it } from 'vitest';
import { parseClaudeStream } from '../src/claude-stream.js';

const line = (value: unknown): string => JSON.stringify(value);
const lines = (...values: readonly unknown[]): string => `${values.map(line).join('\n')}\n`;

const assistant = (text: string) => ({
  type: 'assistant',
  message: {
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text },
    ],
  },
});

const result = (extra: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'AGREEMENT: fine',
  total_cost_usd: 0.0479,
  usage: {
    input_tokens: 2,
    cache_creation_input_tokens: 11551,
    cache_read_input_tokens: 16560,
    output_tokens: 4,
  },
  modelUsage: { 'claude-sonnet-5-5': { inputTokens: 2, outputTokens: 4 } },
  ...extra,
});

describe('parseClaudeStream', () => {
  it('takes the answer, tokens, cost and model from the result event (AC-02 to AC-05)', () => {
    const parsed = parseClaudeStream(
      lines({ type: 'system', subtype: 'init' }, assistant('draft'), result()),
    );

    expect(parsed.complete).toBe(true);
    expect(parsed.text).toBe('AGREEMENT: fine');
    expect(parsed.usage?.inputTokens).toBe(2 + 11551 + 16560);
    expect(parsed.usage?.outputTokens).toBe(4);
    expect(parsed.costUsd).toBe(0.0479);
    expect(parsed.model).toBe('claude-sonnet-5-5');
  });

  it('counts a missing cache field as 0 (AC-03)', () => {
    const parsed = parseClaudeStream(lines(result({ usage: { input_tokens: 7, output_tokens: 3 } })));
    expect(parsed.usage?.inputTokens).toBe(7);
    expect(parsed.usage?.outputTokens).toBe(3);
  });

  it('reports no usage when a required field is missing, negative or not a finite number (AC-03)', () => {
    for (const usage of [
      { output_tokens: 3 },
      { input_tokens: 7 },
      { input_tokens: -1, output_tokens: 3 },
      { input_tokens: '7', output_tokens: 3 },
      { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: -5 },
      { input_tokens: 7, output_tokens: Number.MAX_VALUE * 10 },
    ]) {
      const parsed = parseClaudeStream(lines(result({ usage })));
      expect(parsed.usage).toBeUndefined();
      expect(parsed.text).toBe('AGREEMENT: fine');
    }
    expect(parseClaudeStream(lines(result({ usage: 'lots' }))).usage).toBeUndefined();
    expect(parseClaudeStream(lines(result({ usage: null }))).usage).toBeUndefined();
  });

  it('reports a cost only when it is a finite number of at least 0 (AC-04)', () => {
    expect(parseClaudeStream(lines(result({ total_cost_usd: 0 }))).costUsd).toBe(0);
    for (const cost of [-0.1, '0.1', null, undefined, Number.NaN]) {
      expect(parseClaudeStream(lines(result({ total_cost_usd: cost }))).costUsd).toBeUndefined();
    }
  });

  it('leaves the model out when modelUsage holds none or several (AC-05)', () => {
    expect(parseClaudeStream(lines(result({ modelUsage: {} }))).model).toBeUndefined();
    expect(parseClaudeStream(lines(result({ modelUsage: { a: {}, b: {} } }))).model).toBeUndefined();
    expect(parseClaudeStream(lines(result({ modelUsage: 'x' }))).model).toBeUndefined();
    expect(parseClaudeStream(lines(result({ modelUsage: null }))).model).toBeUndefined();
  });

  it('falls back to the last assistant text when there is no result event (AC-06)', () => {
    const parsed = parseClaudeStream(lines(assistant('first'), { type: 'user' }, assistant('second')));

    expect(parsed.complete).toBe(false);
    expect(parsed.text).toBe('second');
    expect(parsed.usage).toBeUndefined();
    expect(parsed.costUsd).toBeUndefined();
  });

  it('joins several text blocks of one assistant message and skips messages with none', () => {
    const many = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }] },
    };
    const toolOnly = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } };

    expect(parseClaudeStream(lines(many, toolOnly)).text).toBe('ab');
  });

  it('answers with an empty text when nothing usable arrived (AC-06)', () => {
    expect(parseClaudeStream('')).toEqual({ text: '', complete: false, recognised: false });
    expect(parseClaudeStream('plain terminal text\n').text).toBe('');
  });

  it('uses the last result event when there are several', () => {
    const parsed = parseClaudeStream(lines(result({ result: 'one' }), result({ result: 'two' })));
    expect(parsed.text).toBe('two');
  });

  it('keeps the exit-bearing result text when the event says it is an error', () => {
    const parsed = parseClaudeStream(
      lines(result({ is_error: true, subtype: 'error_during_execution', result: 'Boom' })),
    );
    expect(parsed.complete).toBe(true);
    expect(parsed.text).toBe('Boom');
  });

  it('ignores lines that are not JSON, not objects, or have the wrong shape (AC-07)', () => {
    const noise = [
      'not json',
      '{"type":"result"',
      '[1,2,3]',
      '"a string"',
      'null',
      '42',
      line({ type: 'assistant', message: 'nope' }),
      line({ type: 'assistant', message: { content: 'nope' } }),
      line({ type: 'assistant', message: { content: [null, 7, { type: 'text', text: 5 }] } }),
    ].join('\n');

    const parsed = parseClaudeStream(`${noise}\n${line(assistant('kept'))}\n`);
    expect(parsed.text).toBe('kept');
    expect(parsed.complete).toBe(false);
  });

  it('tolerates CRLF line ends and blank lines', () => {
    const parsed = parseClaudeStream(`\r\n${line(result())}\r\n\r\n`);
    expect(parsed.complete).toBe(true);
    expect(parsed.text).toBe('AGREEMENT: fine');
  });

  it('does not let a hostile key reach the result (AC-07)', () => {
    const hostile = `{"type":"result","result":"x","__proto__":{"polluted":true},"usage":{"input_tokens":1,"output_tokens":1,"__proto__":{"polluted":true}}}`;
    const parsed = parseClaudeStream(`${hostile}\n`);

    expect(parsed.text).toBe('x');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(parsed).sort()).toEqual(['complete', 'recognised', 'text', 'usage']);
  });

  it('keeps the usage of an error result that has no result string, with the last assistant text (AC-03, AC-06)', () => {
    const error = {
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      total_cost_usd: 0.2,
      usage: { input_tokens: 5, output_tokens: 6 },
    };
    const parsed = parseClaudeStream(lines(assistant('partial work'), error));

    expect(parsed.complete).toBe(true);
    expect(parsed.text).toBe('partial work');
    expect(parsed.usage?.inputTokens).toBe(5);
    expect(parsed.costUsd).toBe(0.2);
  });

  it('says whether any line was a JSON object (AC-06)', () => {
    expect(parseClaudeStream('warning: something\n').recognised).toBe(false);
    expect(parseClaudeStream('[1]\n"x"\n').recognised).toBe(false);
    expect(parseClaudeStream(`warning first\n${line({ type: 'system' })}`).recognised).toBe(true);
  });

  it('reports no usage for counts that are not safe integers or whose sum is not one (AC-03)', () => {
    const big = Number.MAX_SAFE_INTEGER;
    for (const usage of [
      { input_tokens: 1.5, output_tokens: 1 },
      { input_tokens: 1, output_tokens: big + 1 },
      { input_tokens: big, cache_read_input_tokens: big, output_tokens: 1 },
    ]) {
      expect(parseClaudeStream(lines(result({ usage }))).usage).toBeUndefined();
    }
    expect(
      parseClaudeStream(lines(result({ usage: { input_tokens: big, output_tokens: 1 } }))).usage?.inputTokens,
    ).toBe(big);
  });

  it('accepts only a plausible model name (AC-05)', () => {
    const modelOf = (name: string) => parseClaudeStream(lines(result({ modelUsage: { [name]: {} } }))).model;

    expect(modelOf('claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
    expect(modelOf('anthropic/claude-x:beta.2')).toBe('anthropic/claude-x:beta.2');
    for (const name of ['', ' x', 'a'.repeat(101), 'bad name', 'x\ny', '-leading', 'ünï']) {
      expect(modelOf(name)).toBeUndefined();
    }
  });

  it('treats a __proto__ model key as data and pollutes nothing (AC-07)', () => {
    const hostile = '{"type":"result","result":"x","modelUsage":{"__proto__":{"polluted":true}}}';
    parseClaudeStream(`${hostile}\n`);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
