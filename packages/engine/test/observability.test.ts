import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SimpleEventDispatcher, Span, SpanEnded, SpanStatus, Tracer } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { JsonlSpanExporter, RandomIdGenerator, SystemClock } from '../src/index.js';
import { FixedClock, makeTempDir } from './support.js';

describe('JsonlSpanExporter', () => {
  it('appends one line per span', async () => {
    const dir = join(await makeTempDir(), 'traces');
    const events = new SimpleEventDispatcher();
    const exporter = new JsonlSpanExporter(dir);
    events.addListener(SpanEnded, (e) => exporter.onSpanEnded(e));
    const tracer = new Tracer(new FixedClock(), events, new RandomIdGenerator());

    const root = await tracer.startTrace('task', { k: 'v' });
    await tracer.endSpan(await tracer.startSpan('child', root));
    await tracer.endSpan(root, SpanStatus.Error, 'bad');

    const lines = (await readFile(join(dir, `${root.traceId}.jsonl`), 'utf8')).trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? '');
    expect(first.name).toBe('child');
    expect(first.parent_span_id).toBe(root.spanId);
    expect(Object.keys(first).sort()).toEqual(
      [
        'attributes',
        'duration_ms',
        'end',
        'name',
        'parent_span_id',
        'span_id',
        'start',
        'status',
        'status_message',
        'trace_id',
      ].sort(),
    );
    const second = JSON.parse(lines[1] ?? '');
    expect(second.parent_span_id).toBeNull();
    expect(second.status).toBe('error');
    expect(second.status_message).toBe('bad');
    expect(second.attributes).toEqual({ k: 'v' });
    expect(second.start).toBe('2026-01-01T00:00:00.000Z');
    expect(second.duration_ms).toBe(0);
  });

  it('refuses a trace id that is not hexadecimal rather than build a path from it', async () => {
    const dir = await makeTempDir();
    const span = new Span('../../evil', 'ab', undefined, 'x', new Date(0));
    span.end(new Date(0), SpanStatus.Ok);
    await expect(new JsonlSpanExporter(dir).onSpanEnded(new SpanEnded(span))).rejects.toThrow(
      'not hexadecimal',
    );
  });
});

describe('RandomIdGenerator and SystemClock', () => {
  it('returns exactly the requested number of lowercase hex characters', () => {
    const ids = new RandomIdGenerator();
    for (const length of [1, 7, 16, 32]) {
      expect(ids.next(length)).toMatch(new RegExp(`^[0-9a-f]{${length}}$`));
    }
    expect(ids.next(32)).not.toBe(ids.next(32));
    expect(() => ids.next(0)).toThrow(RangeError);
  });

  it('reads the wall clock', () => {
    expect(Math.abs(new SystemClock().now().getTime() - Date.now())).toBeLessThan(5000);
  });
});
