import { type RunRecord, type RunState, reduceAll } from '@indaba/engine';

export const T = (n: number): string => new Date(Date.UTC(2026, 9, 5, 12, 0, n)).toISOString();
export const TRACE = 'a'.repeat(32);
export const ROOT = 'r'.repeat(16);

export const root = (at = T(0)): RunRecord => ({
  type: 'span_started',
  at,
  traceId: TRACE,
  spanId: ROOT,
  parentSpanId: undefined,
  name: 'indaba.task demo',
  attributes: { 'indaba.task.id': 'task-1', 'indaba.workflow.name': 'demo' },
});

export const rootEnd = (status: string, at = T(60)): RunRecord => ({
  type: 'span_ended',
  at,
  traceId: TRACE,
  spanId: ROOT,
  status: 'ok',
  statusMessage: undefined,
  attributes: { 'indaba.workflow.status': status },
  events: [],
});

export const stepStart = (id: string, at = T(1)): RunRecord => ({
  type: 'span_started',
  at,
  traceId: TRACE,
  spanId: `s-${id}`,
  parentSpanId: ROOT,
  name: `step ${id}`,
  attributes: {},
});

export const status = (id: string, to: string, reason?: string, at = T(2)): RunRecord => ({
  type: 'step_status',
  at,
  traceId: TRACE,
  taskId: 'task-1',
  stepId: id,
  from: 'PENDING',
  to,
  reason,
});

export const output = (id: string, seq: number, text: string, at = T(3)): RunRecord => ({
  type: 'output',
  at,
  traceId: TRACE,
  spanId: `s-${id}`,
  seq,
  text,
  cut: false,
});

export const run = (...records: RunRecord[]): RunState => reduceAll(records);

export const sampleRecords = (): RunRecord[] => [
  root(),
  stepStart('plan'),
  status('plan', 'RUNNING'),
  output('plan', 1, 'line one\nline two\n'),
  stepStart('build', T(5)),
  status('build', 'RUNNING', undefined, T(5)),
  output('build', 1, 'compiling\n', T(6)),
];
