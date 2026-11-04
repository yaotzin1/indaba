import { describe, expect, it } from 'vitest';
import {
  type Clock,
  type IdGenerator,
  PricingTable,
  RunResult,
  SimpleEventDispatcher,
  SpanEnded,
  SpanStarted,
  SpanStatus,
  StepOutput,
  StepThought,
  TokenUsage,
  Tracer,
} from '../src/index.js';

class MockClock implements Clock {
  constructor(private ms: number) {}
  now(): Date {
    return new Date(this.ms);
  }
  sleep(seconds: number): void {
    this.ms += seconds * 1000;
  }
}

class CountingIds implements IdGenerator {
  private n = 0;
  next(hexLength: number): string {
    this.n += 1;
    return this.n.toString(16).padStart(hexLength, '0');
  }
}

describe('PricingTable', () => {
  it('computes cost per million tokens and ignores the variant suffix', () => {
    const pricing = new PricingTable({ 'm/x': { input: 3.0, output: 15.0 } });
    expect(pricing.costUsd('m/x:thinking', new TokenUsage(1000, 500))).toBeCloseTo(0.0105, 9);
    expect(pricing.costUsd('unknown/model', new TokenUsage(1, 1))).toBeUndefined();
    expect(pricing.costUsd('constructor', new TokenUsage(1, 1))).toBeUndefined();
  });

  it('ships indicative defaults', () => {
    expect(PricingTable.defaults().costUsd('deepseek/deepseek-r1', new TokenUsage(1_000_000, 0))).toBe(0.55);
  });
});

describe('Tracer', () => {
  it('forms a tree, carries GenAI attributes and emits events', async () => {
    const clock = new MockClock(Date.UTC(2026, 0, 1));
    const events = new SimpleEventDispatcher();
    const started: string[] = [];
    const ended: string[] = [];
    events.addListener(SpanStarted, (e) => {
      started.push(e.span.name);
    });
    events.addListener(SpanEnded, (e) => {
      ended.push(e.span.name);
    });
    const tracer = new Tracer(
      clock,
      events,
      new CountingIds(),
      new PricingTable({ 'm/x': { input: 1.0, output: 2.0 } }),
    );

    const root = await tracer.startTrace('task');
    const step = await tracer.startSpan('step', root);
    const call = await tracer.startSpan('chat', step, { [Tracer.ATTR_OPERATION]: 'chat' });
    tracer.recordUsage(call, 'openrouter', 'm/x', new TokenUsage(1_000_000, 500_000));
    clock.sleep(1.5);
    await tracer.endSpan(call);
    await tracer.endSpan(step, SpanStatus.Error, 'bad');
    await tracer.endSpan(root);

    expect(call.traceId).toBe(root.traceId);
    expect(call.parentSpanId).toBe(step.spanId);
    expect(root.parentSpanId).toBeUndefined();
    expect(call.durationMs()).toBe(1500);
    expect(call.attributes['gen_ai.usage.input_tokens']).toBe(1_000_000);
    expect(call.attributes['gen_ai.usage.output_tokens']).toBe(500_000);
    expect(call.attributes['gen_ai.request.model']).toBe('m/x');
    expect(call.attributes['gen_ai.provider.name']).toBe('openrouter');
    expect(call.attributes['indaba.cost.usd']).toBe(2.0);
    expect(step.status).toBe(SpanStatus.Error);
    expect(step.statusMessage).toBe('bad');
    expect(started).toEqual(['task', 'step', 'chat']);
    expect(ended).toEqual(['chat', 'step', 'task']);
  });
});

describe('SimpleEventDispatcher', () => {
  it('isolates listener failures and reports them', async () => {
    const errors: unknown[] = [];
    const events = new SimpleEventDispatcher((e) => errors.push(e));
    const seen: string[] = [];
    events.addListener(SpanStarted, () => {
      throw new Error('boom');
    });
    events.addListener(SpanStarted, async (e) => {
      seen.push(e.span.name);
    });
    const tracer = new Tracer(new MockClock(0), events, new CountingIds());
    const span = await tracer.startTrace('t');
    expect(span.name).toBe('t');
    expect(seen).toEqual(['t']);
    expect(errors).toHaveLength(1);
  });
});

describe('RunResult', () => {
  it('defaults, succeeds on exit 0 and prefers stderr for failure text', () => {
    const ok = new RunResult({ exitCode: 0, output: 'out' });
    expect(ok.succeeded()).toBe(true);
    expect(ok.errorOutput).toBe('');
    expect(ok.durationMs).toBe(0);
    expect(ok.usage).toBeUndefined();
    expect(new RunResult({ exitCode: 2, output: ' out ', errorOutput: ' err ' }).failureText()).toBe('err');
    expect(new RunResult({ exitCode: 2, output: ' out ', errorOutput: '  ' }).failureText()).toBe('out');
  });
});

describe('StepOutput', () => {
  it('carries the ids of its span, its place in the stream and the text as given', () => {
    const event = new StepOutput('a'.repeat(32), 'b'.repeat(16), 3, 'hello \u001b[0m');
    expect(event).toMatchObject({
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      seq: 3,
      text: 'hello \u001b[0m',
    });
  });
});

describe('TokenUsage reasoning tokens', () => {
  it.each([0, 500])('accepts %i and keeps it as a breakdown', (n) => {
    expect(new TokenUsage(10, 20, n).reasoningTokens).toBe(n);
  });

  it('leaves it undefined when the provider said nothing', () => {
    expect(new TokenUsage(10, 20).reasoningTokens).toBeUndefined();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])('refuses %s', (n) => {
    expect(() => new TokenUsage(1, 1, n)).toThrow(RangeError);
  });

  it('prices output from outputTokens alone, never adding the reasoning a second time', () => {
    const pricing = new PricingTable({ 'm/x': { input: 1, output: 2 } });
    expect(pricing.costUsd('m/x', new TokenUsage(1000, 500, 400))).toBe(
      pricing.costUsd('m/x', new TokenUsage(1000, 500)),
    );
  });

  it('records reasoning tokens on the span only when reported, and leaves output_tokens as given', async () => {
    const events = new SimpleEventDispatcher();
    const tracer = new Tracer(new MockClock(Date.UTC(2026, 0, 1)), events, new CountingIds());
    const root = await tracer.startTrace('task');
    const withReasoning = await tracer.startSpan('a', root);
    const without = await tracer.startSpan('b', root);
    tracer.recordUsage(withReasoning, 'p', 'm/x', new TokenUsage(1, 20, 12));
    tracer.recordUsage(without, 'p', 'm/x', new TokenUsage(1, 20));

    expect(withReasoning.attributes[Tracer.ATTR_REASONING_TOKENS]).toBe(12);
    expect(withReasoning.attributes[Tracer.ATTR_OUTPUT_TOKENS]).toBe(20);
    expect(without.attributes).not.toHaveProperty(Tracer.ATTR_REASONING_TOKENS);
    expect(Tracer.ATTR_REASONING_TOKENS).toBe('indaba.usage.reasoning_tokens');
    expect(Tracer.ATTR_THOUGHT_CHARS).toBe('indaba.thought.chars');
  });
});

describe('StepThought', () => {
  it('carries the ids of its span, its place in the stream and the text as given', () => {
    expect(new StepThought('a'.repeat(32), 'b'.repeat(16), 2, 'hmm')).toMatchObject({
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      seq: 2,
      text: 'hmm',
    });
  });
});
