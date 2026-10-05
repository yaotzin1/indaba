import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Clock, SpanEnded, SpanStarted, StepOutput, StepStatusChanged } from '@indaba/core';
import { isRunId, type RunRecord, serializeRecord, type UnknownRecord } from './records.js';

export const DEFAULT_MAX_RECORD_CHARS = 4096;
export const DEFAULT_MAX_RUN_CHARS = 2 * 1024 * 1024;

export interface RunEventWriterOptions {
  /** Where `<traceId>.events.jsonl` goes, next to the trace file. */
  readonly directory: string;
  readonly clock: Clock;
  /**
   * Applied to every chunk of output before it is stored. The composition root supplies one built from its
   * environment; with none, text is stored as it came.
   */
  readonly redact?: (text: string) => string;
  /** The longest text of one `output` record; longer text is cut. */
  readonly maxRecordChars?: number;
  /** All the output stored for one run; after that one `truncated` record is written and no more output. */
  readonly maxRunChars?: number;
  /** Told about the first failure to write, once. The run is never affected by it. */
  readonly onError?: (error: unknown) => void;
}

const ROOT_TASK_ATTRIBUTE = 'indaba.task.id';

/**
 * Writes what a run does, as it does it, so that something else can follow it: span starts and ends, step
 * status changes and the output a step streams. Register its methods as listeners on the events. Every line is
 * appended whole and in the order the events arrived. It never throws into the run and never touches the
 * trace file.
 */
export class RunEventWriter {
  private readonly clock: Clock;
  private readonly directory: string;
  private readonly redact: (text: string) => string;
  private readonly maxRecordChars: number;
  private readonly maxRunChars: number;
  private readonly onError: (error: unknown) => void;

  private readonly traceOfTask = new Map<string, string>();
  private readonly outputOfTrace = new Map<string, { chars: number; stopped: boolean }>();
  private queue: Promise<void> = Promise.resolve();
  private directoryReady = false;
  private reported = false;

  constructor(options: RunEventWriterOptions) {
    this.directory = options.directory;
    this.clock = options.clock;
    this.redact = options.redact ?? ((text) => text);
    this.maxRecordChars = options.maxRecordChars ?? DEFAULT_MAX_RECORD_CHARS;
    this.maxRunChars = options.maxRunChars ?? DEFAULT_MAX_RUN_CHARS;
    this.onError = options.onError ?? (() => undefined);
  }

  onSpanStarted(event: SpanStarted): Promise<void> {
    const span = event.span;
    const task = span.attributes[ROOT_TASK_ATTRIBUTE];
    if (span.parentSpanId === undefined && typeof task === 'string') {
      this.traceOfTask.set(task, span.traceId);
    }
    return this.write(span.traceId, {
      type: 'span_started',
      at: span.startedAt.toISOString(),
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      attributes: { ...span.attributes },
    });
  }

  onSpanEnded(event: SpanEnded): Promise<void> {
    const span = event.span;
    return this.write(span.traceId, {
      type: 'span_ended',
      at: (span.endedAt ?? this.clock.now()).toISOString(),
      traceId: span.traceId,
      spanId: span.spanId,
      status: span.status,
      statusMessage: span.statusMessage,
      attributes: { ...span.attributes },
      events: span.events.map((e) => ({ name: e.name, attributes: { ...e.attributes } })),
    });
  }

  onStepStatus(event: StepStatusChanged): Promise<void> {
    const traceId = this.traceOfTask.get(event.taskId);
    if (traceId === undefined) {
      return this.queue; // a task whose root span this writer never saw: there is no file to put it in
    }
    return this.write(traceId, {
      type: 'step_status',
      at: this.clock.now().toISOString(),
      traceId,
      taskId: event.taskId,
      stepId: event.stepId,
      from: event.from,
      to: event.to,
      reason: event.reason,
    });
  }

  onOutput(event: StepOutput): Promise<void> {
    const state = this.outputOfTrace.get(event.traceId) ?? { chars: 0, stopped: false };
    this.outputOfTrace.set(event.traceId, state);
    if (state.stopped) {
      return this.queue;
    }

    let body: string;
    try {
      body = this.redact(event.text);
    } catch (error) {
      this.fail(error);
      return this.queue; // text that cannot be redacted is not stored
    }

    if (state.chars + body.length > this.maxRunChars) {
      state.stopped = true;
      return this.write(event.traceId, {
        type: 'truncated',
        at: this.clock.now().toISOString(),
        traceId: event.traceId,
        spanId: event.spanId,
      });
    }
    state.chars += body.length;

    const cut = body.length > this.maxRecordChars;
    return this.write(event.traceId, {
      type: 'output',
      at: this.clock.now().toISOString(),
      traceId: event.traceId,
      spanId: event.spanId,
      seq: event.seq,
      text: cut ? body.slice(0, this.maxRecordChars) : body,
      cut,
    });
  }

  /** Resolves when everything handed to the writer so far is on disk (or has failed). */
  flush(): Promise<void> {
    return this.queue;
  }

  private write(traceId: string, record: Exclude<RunRecord, UnknownRecord>): Promise<void> {
    if (!isRunId(traceId)) {
      return this.queue; // the id names a file: anything but plain hexadecimal is refused
    }
    const line = `${serializeRecord(record)}\n`;
    this.queue = this.queue.then(async () => {
      try {
        if (!this.directoryReady) {
          await mkdir(this.directory, { recursive: true });
          this.directoryReady = true;
        }
        await appendFile(join(this.directory, `${traceId}.events.jsonl`), line);
      } catch (error) {
        this.fail(error);
      }
    });
    return this.queue;
  }

  private fail(error: unknown): void {
    if (!this.reported) {
      this.reported = true;
      this.onError(error);
    }
  }
}
