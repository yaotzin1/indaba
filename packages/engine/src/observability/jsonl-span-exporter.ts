import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpanEnded } from '@indaba/core';
import { IndabaError } from '@indaba/core';

const TRACE_ID = /^[0-9a-f]+$/;

/**
 * Appends every ended span to `<dir>/<traceId>.jsonl`. Register `onSpanEnded` as a SpanEnded
 * listener. The record shape matches the PHP exporter. Spans only ever carry names and counts
 * (the engine records MCP server names, never definitions), so nothing is redacted here.
 */
export class JsonlSpanExporter {
  constructor(private readonly directory: string) {}

  async onSpanEnded(event: SpanEnded): Promise<void> {
    const span = event.span;
    // The id names a file; refuse anything that is not plain hex rather than build a path from it.
    if (!TRACE_ID.test(span.traceId)) {
      throw new IndabaError('Refusing to write a trace whose id is not hexadecimal.');
    }
    try {
      await mkdir(this.directory, { recursive: true });
    } catch (error) {
      throw new IndabaError(`Cannot create trace directory "${this.directory}".`, { cause: error });
    }

    const line = JSON.stringify({
      trace_id: span.traceId,
      span_id: span.spanId,
      parent_span_id: span.parentSpanId ?? null,
      name: span.name,
      start: span.startedAt.toISOString(),
      end: span.endedAt?.toISOString() ?? null,
      duration_ms: span.durationMs() ?? null,
      status: span.status,
      status_message: span.statusMessage ?? null,
      attributes: { ...span.attributes },
    });
    await appendFile(join(this.directory, `${span.traceId}.jsonl`), `${line}\n`);
  }
}
