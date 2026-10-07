import { describe, expect, it } from 'vitest';
import {
  emptyRun,
  MAX_LINE_CHARS,
  MAX_NOTES,
  MAX_OUTPUT_LINES,
  type RunRecord,
  type RunState,
  reduceAll,
  reduceRun,
} from '../src/index.js';

const T = (n: number): string => new Date(Date.UTC(2026, 9, 5, 12, 0, n)).toISOString();
const TRACE = 'a'.repeat(32);
const ROOT = 'r'.repeat(16);

type Attributes = Record<string, string | number | boolean>;

const root = (
  at = T(0),
  attributes: Attributes = { 'indaba.task.id': 'task-1', 'indaba.workflow.name': 'demo' },
): RunRecord => ({
  type: 'span_started',
  at,
  traceId: TRACE,
  spanId: ROOT,
  parentSpanId: undefined,
  name: 'indaba.task demo',
  attributes,
});

const rootEnd = (status: string | undefined, at = T(60)): RunRecord => ({
  type: 'span_ended',
  at,
  traceId: TRACE,
  spanId: ROOT,
  status: 'ok',
  statusMessage: undefined,
  attributes: status === undefined ? {} : { 'indaba.workflow.status': status },
  events: [],
});

const stepStart = (id: string, at = T(1)): RecordOf<'span_started'> => ({
  type: 'span_started',
  at,
  traceId: TRACE,
  spanId: `s-${id}`,
  parentSpanId: ROOT,
  name: `step ${id}`,
  attributes: {},
});

type RecordOf<T extends RunRecord['type']> = Extract<RunRecord, { type: T }>;

const stepEnd = (
  id: string,
  attributes: Attributes = {},
  events: RecordOf<'span_ended'>['events'] = [],
  at = T(30),
): RunRecord => ({
  type: 'span_ended',
  at,
  traceId: TRACE,
  spanId: `s-${id}`,
  status: 'ok',
  statusMessage: undefined,
  attributes,
  events,
});

const runnerStart = (
  step: string,
  name: string,
  op = 'invoke_agent',
  attributes: Attributes = { 'indaba.runner': name },
  at = T(2),
): RecordOf<'span_started'> => ({
  type: 'span_started',
  at,
  traceId: TRACE,
  spanId: `p-${step}-${name}`,
  parentSpanId: `s-${step}`,
  name: `${op} ${name}`,
  attributes,
});

const runnerEnd = (
  step: string,
  name: string,
  attributes: Attributes = {},
  events: RecordOf<'span_ended'>['events'] = [],
  status = 'ok',
  at = T(20),
): RecordOf<'span_ended'> => ({
  type: 'span_ended',
  at,
  traceId: TRACE,
  spanId: `p-${step}-${name}`,
  status,
  statusMessage: undefined,
  attributes,
  events,
});

const change = (step: string, from: string, to: string, reason?: string, at = T(3)): RunRecord => ({
  type: 'step_status',
  at,
  traceId: TRACE,
  taskId: 'task-1',
  stepId: step,
  from,
  to,
  reason,
});

const out = (step: string, name: string, seq: number, text: string, at = T(5)): RunRecord => ({
  type: 'output',
  at,
  traceId: TRACE,
  spanId: `p-${step}-${name}`,
  seq,
  text,
  cut: false,
});

const stepOf = (state: RunState, id: string) => {
  const step = state.steps.find((s) => s.id === id);
  if (step === undefined) {
    throw new Error(`no step ${id}`);
  }
  return step;
};

describe('reduceRun: the run', () => {
  it('starts empty and running', () => {
    expect(emptyRun()).toMatchObject({
      status: 'running',
      steps: [],
      cost: { usd: 0, unknown: 0 },
      notes: [],
    });
    expect(emptyRun().traceId).toBeUndefined();
  });

  it('learns the workflow, task and start from the root span', () => {
    const state = reduceAll([root()]);
    expect(state).toMatchObject({
      traceId: TRACE,
      taskId: 'task-1',
      workflow: 'demo',
      startedAt: T(0),
      status: 'running',
      lastAt: T(0),
    });
  });

  it('falls back to the span name for the workflow, and tolerates a missing task id', () => {
    const state = reduceAll([root(T(0), {})]);
    expect(state.workflow).toBe('demo');
    expect(state.taskId).toBeUndefined();
  });

  it.each([
    ['COMPLETED', 'completed'],
    ['FAILED', 'failed'],
    ['ESCALATED', 'escalated'],
    ['CANCELLED', 'cancelled'],
    ['WHATEVER', 'unknown'],
  ])('ends as %s -> %s, from the status the engine recorded on the root span', (named, expected) => {
    const state = reduceAll([root(), rootEnd(named)]);
    expect(state.status).toBe(expected);
    expect(state.endedAt).toBe(T(60));
  });

  it('ends as unknown when the root says nothing', () => {
    expect(reduceAll([root(), rootEnd(undefined)]).status).toBe('unknown');
  });

  it('is still running after a step span ends', () => {
    expect(
      reduceAll([root(), stepStart('a'), stepEnd('a', { 'indaba.workflow.status': 'FAILED' })]).status,
    ).toBe('running');
  });

  it('keeps the time of the latest record', () => {
    const state = reduceAll([root(T(0)), change('a', 'PENDING', 'RUNNING', undefined, T(9))]);
    expect(state.lastAt).toBe(T(9));
  });
});

describe('reduceRun: steps', () => {
  it('lists steps in the order they first appear, from a span or from a status change', () => {
    const state = reduceAll([
      root(),
      stepStart('first'),
      change('second', 'PENDING', 'RUNNING'),
      stepStart('third'),
    ]);
    expect(state.steps.map((s) => s.id)).toEqual(['first', 'second', 'third']);
  });

  it('starts a step pending, with nothing in it', () => {
    expect(stepOf(reduceAll([root(), stepStart('a')]), 'a')).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      reason: undefined,
      runners: [],
      skipped: [],
      toolCalls: {},
      permissions: { allowed: 0, rejected: 0 },
      output: [],
      partialLine: '',
      outputTruncated: false,
      startedAt: T(1),
    });
  });

  it('follows the status, and counts an attempt each time it runs', () => {
    const state = reduceAll([
      root(),
      change('a', 'PENDING', 'RUNNING'),
      change('a', 'RUNNING', 'VALIDATING'),
      change('a', 'VALIDATING', 'FAILED', 'tests red'),
      change('a', 'PENDING', 'RUNNING'),
    ]);
    expect(stepOf(state, 'a')).toMatchObject({ status: 'RUNNING', attempts: 2 });
  });

  it('keeps the reason of the last move, and clears it when the step runs again', () => {
    let state = reduceAll([root(), change('a', 'RUNNING', 'FAILED', 'tests red')]);
    expect(stepOf(state, 'a').reason).toBe('tests red');
    state = reduceRun(state, change('a', 'FAILED', 'ESCALATED'));
    expect(stepOf(state, 'a').reason).toBe('tests red');
    state = reduceRun(state, change('a', 'PENDING', 'RUNNING'));
    expect(stepOf(state, 'a').reason).toBeUndefined();
  });

  it('takes the start and end of a step from its span, keeping the first start', () => {
    const state = reduceAll([
      root(),
      stepStart('a', T(1)),
      stepStart('a', T(7)),
      stepEnd('a', {}, [], T(30)),
    ]);
    expect(stepOf(state, 'a')).toMatchObject({ startedAt: T(1), endedAt: T(30) });
  });

  it('records the runners a step skipped, with their reasons', () => {
    const state = reduceAll([
      root(),
      stepStart('a'),
      stepEnd('a', {}, [
        {
          name: 'indaba.runner.skipped',
          attributes: { 'indaba.runner': 'openrouter', 'indaba.runner.skip_reason': 'no key' },
        },
        { name: 'indaba.runner.skipped', attributes: { 'indaba.runner': 'acp' } },
        { name: 'something.else', attributes: {} },
      ]),
    ]);
    expect(stepOf(state, 'a').skipped).toEqual([
      { runner: 'openrouter', reason: 'no key' },
      { runner: 'acp', reason: '' },
    ]);
  });

  it('reads a consensus outcome and its rounds from the step span', () => {
    const state = reduceAll([
      root(),
      stepStart('a'),
      stepEnd('a', { 'indaba.consensus.outcome': 'reached', 'indaba.consensus.rounds': 3 }),
    ]);
    expect(stepOf(state, 'a').consensus).toEqual({ outcome: 'reached', rounds: 3 });
    const noRounds = reduceAll([
      root(),
      stepStart('a'),
      stepEnd('a', { 'indaba.consensus.outcome': 'ping_pong' }),
    ]);
    expect(stepOf(noRounds, 'a').consensus).toEqual({ outcome: 'ping_pong', rounds: 0 });
    expect(stepOf(reduceAll([root(), stepStart('a'), stepEnd('a')]), 'a').consensus).toBeUndefined();
  });
});

describe('reduceRun: runners, cost and ACP events', () => {
  it('shows a runner while it runs and when it ends', () => {
    let state = reduceAll([root(), stepStart('a'), runnerStart('a', 'acp')]);
    expect(stepOf(state, 'a').runners).toEqual([
      expect.objectContaining({
        name: 'acp',
        operation: 'invoke_agent',
        status: 'running',
        startedAt: T(2),
        endedAt: undefined,
      }),
    ]);
    state = reduceRun(
      state,
      runnerEnd('a', 'acp', {
        'indaba.exit_code': 0,
        'gen_ai.request.model': 'm',
        'gen_ai.usage.input_tokens': 10,
        'gen_ai.usage.output_tokens': 4,
        'indaba.cost.usd': 0.25,
      }),
    );
    expect(stepOf(state, 'a').runners[0]).toMatchObject({
      status: 'ok',
      endedAt: T(20),
      exitCode: 0,
      model: 'm',
      inputTokens: 10,
      outputTokens: 4,
      costUsd: 0.25,
    });
  });

  it('marks a runner span that ended in error', () => {
    const state = reduceAll([
      root(),
      stepStart('a'),
      runnerStart('a', 'acp'),
      runnerEnd('a', 'acp', {}, [], 'error'),
    ]);
    expect(stepOf(state, 'a').runners[0]?.status).toBe('error');
  });

  it('names a runner from the attribute, or from the rest of the span name', () => {
    const state = reduceAll([
      root(),
      stepStart('a'),
      runnerStart('a', 'one', 'invoke_agent', {}),
      runnerStart('a', 'two', 'execute_tool'),
    ]);
    expect(stepOf(state, 'a').runners.map((r) => [r.name, r.operation])).toEqual([
      ['one', 'invoke_agent'],
      ['two', 'execute_tool'],
    ]);
  });

  it('keeps the runners of a step in the order they started, for a fallback chain', () => {
    const state = reduceAll([
      root(),
      stepStart('a'),
      runnerStart('a', 'openrouter'),
      runnerEnd('a', 'openrouter', {}, [], 'error'),
      runnerStart('a', 'acp'),
    ]);
    expect(stepOf(state, 'a').runners.map((r) => `${r.name}:${r.status}`)).toEqual([
      'openrouter:error',
      'acp:running',
    ]);
  });

  it('adds up the cost of agent runs, and counts an agent with no cost as unknown, never as zero', () => {
    const state = reduceAll([
      root(),
      stepStart('a'),
      runnerStart('a', 'one'),
      runnerEnd('a', 'one', { 'indaba.cost.usd': 0.1 }),
      runnerStart('a', 'two'),
      runnerEnd('a', 'two', { 'indaba.cost.usd': 0.25 }),
      runnerStart('a', 'three'),
      runnerEnd('a', 'three', {}),
    ]);
    expect(state.cost.usd).toBeCloseTo(0.35, 10);
    expect(state.cost.unknown).toBe(1);
  });

  it('counts a cost of exactly zero as known', () => {
    const state = reduceAll([
      root(),
      stepStart('a'),
      runnerStart('a', 'free'),
      runnerEnd('a', 'free', { 'indaba.cost.usd': 0 }),
    ]);
    expect(state.cost).toEqual({ usd: 0, unknown: 0 });
  });

  it('does not count a shell command as unknown cost', () => {
    const state = reduceAll([
      root(),
      stepStart('v'),
      runnerStart('v', 'shell', 'execute_tool'),
      runnerEnd('v', 'shell', { 'indaba.exit_code': 0 }),
    ]);
    expect(state.cost).toEqual({ usd: 0, unknown: 0 });
  });

  it('counts finished tool calls by kind, once each, and permission decisions', () => {
    const tool = (kind: string, status: string) => ({
      name: 'indaba.acp.tool_call',
      attributes: { 'acp.tool.kind': kind, 'acp.tool.status': status },
    });
    const state = reduceAll([
      root(),
      stepStart('a'),
      runnerStart('a', 'acp'),
      runnerEnd('a', 'acp', {}, [
        tool('read', 'pending'),
        tool('read', 'completed'),
        tool('edit', 'pending'),
        tool('edit', 'failed'),
        tool('read', 'in_progress'),
        tool('read', 'completed'),
        { name: 'indaba.acp.tool_call', attributes: { 'acp.tool.status': 'completed' } },
        { name: 'indaba.acp.permission', attributes: { 'acp.permission.decision': 'allowed' } },
        { name: 'indaba.acp.permission', attributes: { 'acp.permission.decision': 'rejected' } },
        { name: 'indaba.acp.permission', attributes: { 'acp.permission.decision': 'rejected' } },
        { name: 'indaba.acp.session', attributes: {} },
      ]),
    ]);
    expect(stepOf(state, 'a').toolCalls).toEqual({ read: 2, edit: 1, other: 1 });
    expect(stepOf(state, 'a').permissions).toEqual({ allowed: 1, rejected: 2 });
  });

  it('adds the events of a second runner to the first, in one step', () => {
    const tool = {
      name: 'indaba.acp.tool_call',
      attributes: { 'acp.tool.kind': 'read', 'acp.tool.status': 'completed' },
    };
    const state = reduceAll([
      root(),
      stepStart('a'),
      runnerStart('a', 'one'),
      runnerEnd('a', 'one', {}, [tool]),
      runnerStart('a', 'two'),
      runnerEnd('a', 'two', {}, [tool]),
    ]);
    expect(stepOf(state, 'a').toolCalls).toEqual({ read: 2 });
  });

  it('ignores the end of a span it never saw start', () => {
    const state = reduceAll([root(), runnerEnd('ghost', 'x', { 'indaba.cost.usd': 5 })]);
    expect(state.cost).toEqual({ usd: 0, unknown: 0 });
    expect(state.steps).toEqual([]);
  });
});

describe('reduceRun: output', () => {
  const base = [root(), stepStart('a'), runnerStart('a', 'acp')];

  it('puts complete lines in order and keeps the unfinished one apart', () => {
    const state = reduceAll([...base, out('a', 'acp', 0, 'one\ntw'), out('a', 'acp', 1, 'o\nthree')]);
    expect(stepOf(state, 'a')).toMatchObject({ output: ['one', 'two'], partialLine: 'three' });
  });

  it('turns a partial line into a complete one when its newline arrives', () => {
    const state = reduceAll([...base, out('a', 'acp', 0, 'part'), out('a', 'acp', 1, 'ial\n')]);
    expect(stepOf(state, 'a')).toMatchObject({ output: ['partial'], partialLine: '' });
  });

  it('keeps blank lines', () => {
    expect(stepOf(reduceAll([...base, out('a', 'acp', 0, 'a\n\nb\n')]), 'a').output).toEqual(['a', '', 'b']);
  });

  it('keeps only the newest lines, up to the limit', () => {
    const lots = Array.from({ length: MAX_OUTPUT_LINES + 25 }, (_, i) => `line ${i}`).join('\n');
    const lines = stepOf(reduceAll([...base, out('a', 'acp', 0, `${lots}\n`)]), 'a').output;
    expect(lines).toHaveLength(MAX_OUTPUT_LINES);
    expect(lines.at(-1)).toBe(`line ${MAX_OUTPUT_LINES + 24}`);
    expect(lines[0]).toBe('line 25');
  });

  it('cuts a line that is too long, complete or not', () => {
    const long = 'x'.repeat(MAX_LINE_CHARS + 50);
    const state = reduceAll([...base, out('a', 'acp', 0, `${long}\n${long}`)]);
    expect(stepOf(state, 'a').output[0]).toHaveLength(MAX_LINE_CHARS);
    expect(stepOf(state, 'a').partialLine).toHaveLength(MAX_LINE_CHARS);
    const exact = 'y'.repeat(MAX_LINE_CHARS);
    expect(stepOf(reduceAll([...base, out('a', 'acp', 0, `${exact}\n`)]), 'a').output[0]).toHaveLength(
      MAX_LINE_CHARS,
    );
  });

  it('files each chunk under the step its span belongs to', () => {
    const state = reduceAll([
      root(),
      stepStart('a'),
      stepStart('b'),
      runnerStart('a', 'acp'),
      runnerStart('b', 'shell', 'execute_tool'),
      out('b', 'shell', 0, 'from b\n'),
      out('a', 'acp', 0, 'from a\n'),
    ]);
    expect(stepOf(state, 'a').output).toEqual(['from a']);
    expect(stepOf(state, 'b').output).toEqual(['from b']);
  });

  it('drops output for a span it does not know, and leaves the state alone', () => {
    const before = reduceAll(base);
    const after = reduceRun(before, out('nope', 'nope', 0, 'lost\n'));
    expect(after.steps).toEqual(before.steps);
  });

  it('marks the step when stored output ran out', () => {
    const state = reduceAll([...base, { type: 'truncated', at: T(6), traceId: TRACE, spanId: 'p-a-acp' }]);
    expect(stepOf(state, 'a').outputTruncated).toBe(true);
    const ignored = reduceRun(state, { type: 'truncated', at: T(7), traceId: TRACE, spanId: 'ghost' });
    expect(ignored.steps).toEqual(state.steps);
  });
});

describe('reduceRun: what it does not understand', () => {
  it('keeps a note of a record it could not read, newest last, up to a limit', () => {
    let state = emptyRun();
    for (let i = 0; i < MAX_NOTES + 5; i++) {
      state = reduceRun(state, { type: 'unknown', text: `bad line ${i}` });
    }
    expect(state.notes).toHaveLength(MAX_NOTES);
    expect(state.notes.at(-1)).toBe(`bad line ${MAX_NOTES + 4}`);
    expect(state.notes[0]).toBe('bad line 5');
  });

  it('shortens a long note', () => {
    const state = reduceRun(emptyRun(), { type: 'unknown', text: 'z'.repeat(500) });
    expect(state.notes[0]).toBe(`${'z'.repeat(200)}...`);
    expect(reduceRun(emptyRun(), { type: 'unknown', text: 'z'.repeat(200) }).notes[0]).toBe('z'.repeat(200));
  });
});

describe('reduceRun: properties', () => {
  const sample: RunRecord[] = [
    root(),
    stepStart('a'),
    change('a', 'PENDING', 'RUNNING'),
    runnerStart('a', 'acp'),
    out('a', 'acp', 0, 'hello\nwor'),
    runnerEnd('a', 'acp', { 'indaba.cost.usd': 0.2 }, [
      { name: 'indaba.acp.permission', attributes: { 'acp.permission.decision': 'allowed' } },
    ]),
    change('a', 'RUNNING', 'VALIDATING'),
    change('a', 'VALIDATING', 'COMPLETED'),
    stepEnd('a'),
    { type: 'unknown', text: '???' },
    rootEnd('COMPLETED'),
  ];

  it('does not change the state it was given', () => {
    let state = emptyRun();
    for (const record of sample) {
      const frozen = JSON.stringify(state);
      const next = reduceRun(state, record);
      expect(JSON.stringify(state)).toBe(frozen);
      state = next;
    }
  });

  it('gives the same state for the same records, however they are batched', () => {
    expect(reduceAll(sample)).toEqual(sample.reduce(reduceRun, emptyRun()));
    expect(JSON.stringify(reduceAll(sample))).toBe(JSON.stringify(reduceAll([...sample])));
  });

  it('never throws, for any order, any prefix, or any repetition of records', () => {
    let seed = 99;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let round = 0; round < 200; round++) {
      let state = emptyRun();
      for (let i = next() % 25; i > 0; i--) {
        const record = sample[next() % sample.length];
        if (record !== undefined) {
          state = reduceRun(state, record);
        }
      }
      expect(state.steps.length).toBeGreaterThanOrEqual(0);
      expect(['running', 'completed', 'failed', 'escalated', 'cancelled', 'unknown']).toContain(state.status);
    }
  });

  it('shows the finished run as it happened', () => {
    const state = reduceAll(sample);
    expect(state.status).toBe('completed');
    expect(stepOf(state, 'a')).toMatchObject({
      status: 'COMPLETED',
      attempts: 1,
      output: ['hello'],
      partialLine: 'wor',
    });
    expect(state.cost).toEqual({ usd: 0.2, unknown: 0 });
    expect(state.notes).toEqual(['???']);
  });
});
