import {
  createLogger,
  type LogLevel,
  type LogRecord,
  SimpleEventDispatcher,
  Span,
  SpanEnded,
  SpanStatus,
  StepOutput,
  StepStatus,
  StepStatusChanged,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { logEngineEvents } from '../src/index.js';

const ESC = String.fromCharCode(0x1b);
const AT = new Date('2026-10-21T08:00:00.000Z');

function bridged(level: LogLevel = 'info') {
  const records: LogRecord[] = [];
  const events = new SimpleEventDispatcher();
  logEngineEvents(
    events,
    createLogger({ sinks: [{ write: (r) => records.push(r) }], clock: () => AT, level, pid: 7 }),
  );
  return { records, events };
}

function span(status: SpanStatus, message?: string): Span {
  const s = new Span('ab'.repeat(16), 'cd'.repeat(8), undefined, 'step build', AT);
  s.end(new Date(AT.getTime() + 1500), status, message);
  return s;
}

describe('logEngineEvents', () => {
  it('records each step state change with the task and step in the context', async () => {
    const { records, events } = bridged();
    await events.dispatch(new StepStatusChanged('t1', 'build', StepStatus.Pending, StepStatus.Running));
    expect(records).toEqual([
      {
        time: AT.toISOString(),
        level: 'info',
        component: 'engine.step',
        message: 'a step changed state',
        fields: { from: 'PENDING', to: 'RUNNING' },
        context: { taskId: 't1', stepId: 'build' },
        pid: 7,
      },
    ]);
  });

  it('says a step did not complete, with its reason on one printable line, at info', async () => {
    const { records, events } = bridged();
    const reason = `tests red${ESC}[2J\nsecond line`;
    await events.dispatch(
      new StepStatusChanged('t1', 'build', StepStatus.Running, StepStatus.Failed, reason),
    );
    await events.dispatch(new StepStatusChanged('t1', 'build', StepStatus.Failed, StepStatus.Escalated));
    expect(records.map((r) => [r.level, r.message, r.fields])).toEqual([
      ['info', 'a step did not complete', { from: 'RUNNING', to: 'FAILED', reason: 'tests red second line' }],
      ['info', 'a step did not complete', { from: 'FAILED', to: 'ESCALATED' }],
    ]);
  });

  it('records a span that ends with an error, and no other span', async () => {
    const { records, events } = bridged();
    await events.dispatch(new SpanEnded(span(SpanStatus.Ok)));
    await events.dispatch(new SpanEnded(span(SpanStatus.Error, 'runner exited 1')));
    await events.dispatch(new SpanEnded(span(SpanStatus.Error)));
    expect(records.map((r) => [r.message, r.fields, r.context])).toEqual([
      [
        'a span ended with an error',
        { span: 'step build', spanId: 'cd'.repeat(8), reason: 'runner exited 1', durationMs: 1500 },
        { traceId: 'ab'.repeat(16) },
      ],
      [
        'a span ended with an error',
        { span: 'step build', spanId: 'cd'.repeat(8), durationMs: 1500 },
        { traceId: 'ab'.repeat(16) },
      ],
    ]);
  });

  it('leaves out a span that has not ended', async () => {
    const { records, events } = bridged();
    const open = new Span('ab'.repeat(16), 'cd'.repeat(8), undefined, 'open', AT);
    await events.dispatch(new SpanEnded(open));
    expect(records).toEqual([]);
  });

  it('records what a step streams only at debug, printable-filtered', async () => {
    const quiet = bridged('info');
    await quiet.events.dispatch(new StepOutput('ab'.repeat(16), 'cd'.repeat(8), 0, 'hello'));
    expect(quiet.records).toEqual([]);

    const loud = bridged('debug');
    await loud.events.dispatch(
      new StepOutput('ab'.repeat(16), 'cd'.repeat(8), 3, `one${ESC}]0;title${ESC}\\\ntwo`),
    );
    expect(loud.records.map((r) => [r.level, r.component, r.fields, r.context])).toEqual([
      [
        'debug',
        'engine.output',
        { spanId: 'cd'.repeat(8), seq: 3, text: 'one\ntwo' },
        { traceId: 'ab'.repeat(16) },
      ],
    ]);
  });

  it('gives the same records in the same order for the same events and clock (AC-12)', async () => {
    const play = async (): Promise<LogRecord[]> => {
      const { records, events } = bridged('debug');
      await events.dispatch(new StepStatusChanged('t1', 'a', StepStatus.Pending, StepStatus.Running));
      await events.dispatch(new StepOutput('ab'.repeat(16), 'cd'.repeat(8), 0, 'x'));
      await events.dispatch(new SpanEnded(span(SpanStatus.Error, 'no')));
      await events.dispatch(new StepStatusChanged('t1', 'a', StepStatus.Running, StepStatus.Failed, 'no'));
      return records;
    };
    expect(await play()).toEqual(await play());
  });

  it('never fails the dispatch, even when every sink throws (AC-11)', async () => {
    const errors: unknown[] = [];
    const events = new SimpleEventDispatcher((error) => errors.push(error));
    const throwing = {
      write: () => {
        throw new Error('disk full');
      },
    };
    logEngineEvents(events, createLogger({ sinks: [throwing, throwing], clock: () => AT }));
    await events.dispatch(new StepStatusChanged('t1', 'a', StepStatus.Pending, StepStatus.Running));
    expect(errors).toEqual([]);
  });
});
