import { type Logger, SpanEnded, SpanStatus, StepOutput, StepStatus, StepStatusChanged } from '@indaba/core';
import { sanitize } from '../trace/sanitize.js';

/** Anything engine events can be listened to on: the dispatcher of a run, or the `PluginHost` a plugin receives. */
export interface EventSource {
  addListener<E extends object>(
    type: abstract new (...args: never[]) => E,
    listener: (event: E) => unknown,
  ): void;
}

/** One line of printable text: an agent or a guard wrote it, so nothing in it may act on a terminal or split a line. */
function plain(text: string): string {
  return sanitize(text).replace(/[\r\n\t]+/g, ' ');
}

/**
 * Turns the events of a run into log records (specs/logging, AC-22), so code that already announces what it does
 * through events needs no logger calls of its own, and a log line can be found again in the trace by its ids.
 *
 * - every step state change: `info`, with `taskId` and `stepId` in the context and the reason as a field;
 * - a span that ends with an error: `info`, with `traceId` in the context;
 * - what a step streams: `debug` only, printable-filtered (and cut by the logger) (AC-05).
 *
 * Nothing here is `warn`: the outcome of a run is already on the screen, and `warn` is printed on standard error
 * too, so it is kept for trouble of Indaba's own. The listeners never throw: a logger never does.
 */
export function logEngineEvents(events: EventSource, logger: Logger): void {
  events.addListener(StepStatusChanged, (event) => {
    const failed = event.to === StepStatus.Failed || event.to === StepStatus.Escalated;
    logger
      .child({ taskId: event.taskId, stepId: event.stepId })
      .info('engine.step', failed ? 'a step did not complete' : 'a step changed state', {
        from: event.from,
        to: event.to,
        ...(event.reason === undefined ? {} : { reason: plain(event.reason) }),
      });
  });
  events.addListener(SpanEnded, (event) => {
    const span = event.span;
    if (span.status !== SpanStatus.Error) {
      return;
    }
    const duration = span.durationMs();
    logger.child({ traceId: span.traceId }).info('engine.span', 'a span ended with an error', {
      span: span.name,
      spanId: span.spanId,
      ...(span.statusMessage === undefined ? {} : { reason: plain(span.statusMessage) }),
      ...(duration === undefined ? {} : { durationMs: duration }),
    });
  });
  events.addListener(StepOutput, (event) => {
    logger.child({ traceId: event.traceId }).debug('engine.output', 'a step streamed output', {
      spanId: event.spanId,
      seq: event.seq,
      text: sanitize(event.text),
    });
  });
}
