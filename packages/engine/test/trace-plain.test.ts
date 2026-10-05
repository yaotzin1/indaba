import { describe, expect, it } from 'vitest';
import {
  emptyRun,
  formatCost,
  formatDuration,
  formatEvent,
  formatPlain,
  type RunRecord,
  type RunState,
  reduceAll,
  watchExitCode,
} from '../src/index.js';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const T = (n: number): string => new Date(Date.UTC(2026, 9, 5, 12, 0, n)).toISOString();
const TRACE = 'a'.repeat(32);
const ROOT = 'r'.repeat(16);

const root = (name = 'demo'): RunRecord => ({
  type: 'span_started',
  at: T(0),
  traceId: TRACE,
  spanId: ROOT,
  parentSpanId: undefined,
  name: `indaba.task ${name}`,
  attributes: { 'indaba.workflow.name': name, 'indaba.task.id': 't' },
});
const stepStart = (id: string): RunRecord => ({
  type: 'span_started',
  at: T(1),
  traceId: TRACE,
  spanId: `s-${id}`,
  parentSpanId: ROOT,
  name: `step ${id}`,
  attributes: {},
});
const change = (step: string, to: string, reason?: string, at = T(2)): RunRecord => ({
  type: 'step_status',
  at,
  traceId: TRACE,
  taskId: 't',
  stepId: step,
  from: 'X',
  to,
  reason,
});
const runner = (
  step: string,
  name: string,
  start = T(2),
  end?: string,
  attributes: Record<string, string | number> = {},
): RunRecord[] => {
  const spanId = `p-${step}-${name}`;
  const records: RunRecord[] = [
    {
      type: 'span_started',
      at: start,
      traceId: TRACE,
      spanId,
      parentSpanId: `s-${step}`,
      name: `invoke_agent ${name}`,
      attributes: { 'indaba.runner': name },
    },
  ];
  if (end !== undefined) {
    records.push({
      type: 'span_ended',
      at: end,
      traceId: TRACE,
      spanId,
      status: 'ok',
      statusMessage: undefined,
      attributes,
      events: [],
    });
  }
  return records;
};
const output = (step: string, name: string, text: string): RunRecord => ({
  type: 'output',
  at: T(3),
  traceId: TRACE,
  spanId: `p-${step}-${name}`,
  seq: 0,
  text,
  cut: false,
});

describe('formatDuration', () => {
  it.each([
    [undefined, '-'],
    [Number.NaN, '-'],
    [Number.POSITIVE_INFINITY, '-'],
    [-1, '-'],
    [0, '0s'],
    [999, '0s'],
    [1000, '1s'],
    [59_999, '59s'],
    [60_000, '1m00s'],
    [123_000, '2m03s'],
    [3_599_000, '59m59s'],
    [3_600_000, '1h00m'],
    [3_723_000, '1h02m'],
    [90_000_000, '25h00m'],
  ])('%s is %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('formatCost', () => {
  it.each([
    [{ usd: 0, unknown: 0 }, 'none'],
    [{ usd: 0.5, unknown: 0 }, '$0.5000'],
    [{ usd: 0.01234, unknown: 0 }, '$0.0123'],
    [{ usd: 0, unknown: 2 }, 'unknown'],
    [{ usd: 0.5, unknown: 1 }, '$0.5000 + 1 unknown'],
    [{ usd: 12, unknown: 3 }, '$12.0000 + 3 unknown'],
  ])('%j is %s', (cost, expected) => {
    expect(formatCost(cost)).toBe(expected);
  });
});

describe('watchExitCode', () => {
  it.each([
    ['completed', 0],
    ['failed', 1],
    ['escalated', 2],
    ['cancelled', 130],
    ['running', 3],
    ['unknown', 3],
  ] as const)('%s is %i', (status, code) => {
    expect(watchExitCode(status)).toBe(code);
  });
});

describe('formatPlain', () => {
  const finished: RunRecord[] = [
    root(),
    stepStart('rfc'),
    change('rfc', 'RUNNING'),
    ...runner('rfc', 'openrouter', T(2), T(12), { 'indaba.cost.usd': 0.0123 }),
    change('rfc', 'COMPLETED', undefined, T(13)),
    stepStart('code'),
    change('code', 'RUNNING', undefined, T(14)),
    ...runner('code', 'acp', T(14), T(40), {}),
    output('code', 'acp', 'editing\nsecond line\n'),
    change('code', 'RUNNING', undefined, T(41)),
    change('code', 'FAILED', 'tests red\nsecond\nthird\nfourth', T(42)),
  ];

  it('prints a header with the run, its state, the step count, the elapsed time and the cost', () => {
    const text = formatPlain(reduceAll(finished));
    expect(text.split('\n')[0]).toBe(
      'indaba demo | ▶ running | 2 steps | elapsed 42s | cost $0.0123 + 1 unknown',
    );
  });

  it('gives every step a glyph, a word, and its attempts when there were several', () => {
    const lines = formatPlain(reduceAll(finished)).split('\n');
    expect(lines).toContain('  ✔ rfc   completed');
    expect(lines).toContain('  ✖ code  failed  attempt 2');
  });

  it('shows the runners a step used, with their state, time and cost', () => {
    const text = formatPlain(reduceAll(finished));
    expect(text).toContain('      runners: openrouter ok 10s $0.0123');
    expect(text).toContain('      runners: acp ok 26s');
  });

  it('shows the reason of a failure, at most three lines of it', () => {
    const text = formatPlain(reduceAll(finished));
    expect(text).toContain('      reason: tests red\n      reason: second\n      reason: third\n');
    expect(text).not.toContain('fourth');
  });

  it('shows the tail of the output of a step that is not completed, not of one that is', () => {
    const text = formatPlain(reduceAll(finished));
    expect(text).toContain('      | editing\n      | second line');
    const completed = formatPlain(reduceAll([...finished, output('rfc', 'openrouter', 'rfc text\n')]));
    expect(completed).not.toContain('rfc text');
    expect(
      formatPlain(reduceAll([...finished, output('rfc', 'openrouter', 'rfc text\n')]), { allOutput: true }),
    ).toContain('| rfc text');
  });

  it('limits the output tail, and shows the unfinished line last', () => {
    const lots = `${Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n')}\nunfinished`;
    const text = formatPlain(reduceAll([...finished, output('code', 'acp', lots)]), { outputLines: 3 });
    expect(text).toContain('      | l9\n      | unfinished');
    expect(text).not.toContain('| l7');
    expect(formatPlain(reduceAll(finished), { outputLines: 0 })).not.toContain('      | ');
  });

  it('says so when stored output ran out', () => {
    const text = formatPlain(
      reduceAll([...finished, { type: 'truncated', at: T(5), traceId: TRACE, spanId: 'p-code-acp' }]),
    );
    expect(text).toContain('| (output stored for this run ran out; the rest is not shown)');
  });

  it('shows skipped runners, tool calls, permission decisions and a consensus', () => {
    const records: RunRecord[] = [
      root(),
      stepStart('a'),
      change('a', 'RUNNING'),
      {
        type: 'span_started',
        at: T(2),
        traceId: TRACE,
        spanId: 'p-a-acp',
        parentSpanId: 's-a',
        name: 'invoke_agent acp',
        attributes: { 'indaba.runner': 'acp' },
      },
      {
        type: 'span_ended',
        at: T(9),
        traceId: TRACE,
        spanId: 'p-a-acp',
        status: 'ok',
        statusMessage: undefined,
        attributes: {},
        events: [
          {
            name: 'indaba.acp.tool_call',
            attributes: { 'acp.tool.kind': 'read', 'acp.tool.status': 'completed' },
          },
          {
            name: 'indaba.acp.tool_call',
            attributes: { 'acp.tool.kind': 'edit', 'acp.tool.status': 'completed' },
          },
          { name: 'indaba.acp.permission', attributes: { 'acp.permission.decision': 'allowed' } },
          { name: 'indaba.acp.permission', attributes: { 'acp.permission.decision': 'rejected' } },
        ],
      },
      {
        type: 'span_ended',
        at: T(10),
        traceId: TRACE,
        spanId: 's-a',
        status: 'ok',
        statusMessage: undefined,
        attributes: { 'indaba.consensus.outcome': 'reached', 'indaba.consensus.rounds': 2 },
        events: [
          {
            name: 'indaba.runner.skipped',
            attributes: {
              'indaba.runner': 'openrouter',
              'indaba.runner.skip_reason': 'OPENROUTER_API_KEY is not set.',
            },
          },
        ],
      },
    ];
    const text = formatPlain(reduceAll(records));
    expect(text).toContain('      skipped: openrouter (OPENROUTER_API_KEY is not set.)');
    expect(text).toContain('      tools: edit 1, read 1 | permissions: 1 allowed, 1 rejected');
    expect(text).toContain('      consensus: reached after 2 round(s)');
  });

  it('prints a skipped runner with no reason without empty brackets', () => {
    const text = formatPlain(
      reduceAll([
        root(),
        stepStart('a'),
        {
          type: 'span_ended',
          at: T(5),
          traceId: TRACE,
          spanId: 's-a',
          status: 'ok',
          statusMessage: undefined,
          attributes: {},
          events: [{ name: 'indaba.runner.skipped', attributes: { 'indaba.runner': 'acp' } }],
        },
      ]),
    );
    expect(text).toContain('      skipped: acp\n');
  });

  it('writes the singular for one step, and a note for something it could not read', () => {
    const text = formatPlain(reduceAll([root(), stepStart('only'), { type: 'unknown', text: 'garbled' }]));
    expect(text).toContain('| 1 step |');
    expect(text).toContain('  note: garbled');
  });

  it('copes with a run that has not started, and with every end state', () => {
    expect(formatPlain(emptyRun())).toBe('indaba run | ▶ running | 0 steps | elapsed - | cost none\n');
    for (const [status, word] of [
      ['COMPLETED', 'completed'],
      ['FAILED', 'failed'],
      ['ESCALATED', 'escalated'],
      ['CANCELLED', 'cancelled'],
      ['ODD', 'ended without a final state'],
    ] as const) {
      const state: RunState = reduceAll([
        root(),
        {
          type: 'span_ended',
          at: T(5),
          traceId: TRACE,
          spanId: ROOT,
          status: 'ok',
          statusMessage: undefined,
          attributes: { 'indaba.workflow.status': status },
          events: [],
        },
      ]);
      expect(formatPlain(state)).toContain(` ${word} |`);
    }
  });

  it('measures a finished run to its end and a running one to its latest record', () => {
    const ended = reduceAll([
      root(),
      {
        type: 'span_ended',
        at: T(75),
        traceId: TRACE,
        spanId: ROOT,
        status: 'ok',
        statusMessage: undefined,
        attributes: { 'indaba.workflow.status': 'COMPLETED' },
        events: [],
      },
    ]);
    expect(formatPlain(ended)).toContain('elapsed 1m15s');
    expect(formatPlain(reduceAll([root(), change('a', 'RUNNING', undefined, T(9))]))).toContain('elapsed 9s');
  });

  it('shows a step that has an unknown state as such', () => {
    expect(formatPlain(reduceAll([root(), change('a', 'SOMETHING')]))).toContain('  ? a  unknown');
  });

  it('uses ASCII glyphs when asked', () => {
    const text = formatPlain(reduceAll(finished), { ascii: true });
    expect(text).toContain('  + rfc   completed');
    expect(text).toContain('  x code  failed');
    expect(Array.from(text).every((char) => (char.codePointAt(0) ?? 0) < 128)).toBe(true);
  });

  it('adds colour only when asked, and always keeps the word beside the glyph', () => {
    const plain = formatPlain(reduceAll(finished));
    const coloured = formatPlain(reduceAll(finished), { color: true });
    expect(plain).not.toContain(ESC);
    expect(coloured).toContain(`${ESC}[32m`);
    expect(coloured).toContain(`${ESC}[31m`);
    expect(coloured.replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '')).toBe(plain);
  });

  it('never lets an agent put an escape sequence on the screen, in any field', () => {
    const evil = `x${ESC}[2J${ESC}]0;pwned${BEL}y`;
    const records: RunRecord[] = [
      root(evil),
      stepStart(evil),
      change(evil, 'FAILED', `reason ${evil}\nline two ${evil}`),
      {
        type: 'span_started',
        at: T(2),
        traceId: TRACE,
        spanId: 'p-x-r',
        parentSpanId: `s-${evil}`,
        name: 'invoke_agent r',
        attributes: { 'indaba.runner': evil },
      },
      {
        type: 'output',
        at: T(3),
        traceId: TRACE,
        spanId: 'p-x-r',
        seq: 0,
        text: `out ${evil}\n`,
        cut: false,
      },
      {
        type: 'span_ended',
        at: T(4),
        traceId: TRACE,
        spanId: `s-${evil}`,
        status: 'ok',
        statusMessage: undefined,
        attributes: { 'indaba.consensus.outcome': evil },
        events: [
          {
            name: 'indaba.runner.skipped',
            attributes: { 'indaba.runner': evil, 'indaba.runner.skip_reason': evil },
          },
        ],
      },
      { type: 'unknown', text: evil },
    ];
    const text = formatPlain(reduceAll(records), { allOutput: true });
    expect(text).not.toContain(ESC);
    expect(text).not.toContain(BEL);
    expect(text).not.toContain('pwned\u0007');
    expect(text).toContain('xy');
  });

  it('keeps each agent-supplied name on one line', () => {
    const text = formatPlain(reduceAll([root('two\nlines'), stepStart('a\nb'), change('a\nb', 'RUNNING')]));
    expect(text.split('\n')[0]).toBe('indaba two lines | ▶ running | 1 step | elapsed 2s | cost none');
    expect(text).toContain('  ▶ a b  running');
  });

  it('ends with exactly one newline', () => {
    expect(formatPlain(reduceAll(finished)).endsWith('\n')).toBe(true);
    expect(formatPlain(reduceAll(finished)).endsWith('\n\n')).toBe(false);
  });
});

describe('formatEvent', () => {
  /** The lines for the record at `index`, given the state after it. */
  const linesFor = (records: RunRecord[], index: number, options?: { output?: boolean }): string[] => {
    const record = records[index];
    if (record === undefined) {
      throw new Error('no such record');
    }
    return formatEvent(reduceAll(records.slice(0, index + 1)), record, options);
  };

  const base: RunRecord[] = [root(), stepStart('code'), change('code', 'RUNNING', undefined, T(3))];
  const withRunner = [...base, ...runner('code', 'acp', T(4), T(14), { 'indaba.cost.usd': 0.25 })];

  it('prints a step moving, with the first line of its reason', () => {
    expect(linesFor(base, 2)).toEqual(['12:00:03 code: X -> RUNNING']);
    const failed = [...base, change('code', 'FAILED', 'tests red\nmore detail', T(9))];
    expect(linesFor(failed, 3)).toEqual(['12:00:09 code: X -> FAILED (tests red)']);
    const blank = [...base, change('code', 'FAILED', '', T(9))];
    expect(linesFor(blank, 3)).toEqual(['12:00:09 code: X -> FAILED']);
  });

  it('prints a runner starting and ending, with its cost when it has one', () => {
    expect(linesFor(withRunner, 3)).toEqual(['12:00:04 code: runner acp started']);
    expect(linesFor(withRunner, 4)).toEqual(['12:00:14 code: runner acp ok $0.2500']);
  });

  it('calls a shell step a command, and prints an error as such', () => {
    const records: RunRecord[] = [
      root(),
      stepStart('verify'),
      {
        type: 'span_started',
        at: T(2),
        traceId: TRACE,
        spanId: 'p-verify-shell',
        parentSpanId: 's-verify',
        name: 'execute_tool shell',
        attributes: { 'indaba.runner': 'shell' },
      },
      {
        type: 'span_ended',
        at: T(5),
        traceId: TRACE,
        spanId: 'p-verify-shell',
        status: 'error',
        statusMessage: undefined,
        attributes: {},
        events: [],
      },
    ];
    expect(linesFor(records, 2)).toEqual(['12:00:02 verify: command started']);
    expect(linesFor(records, 3)).toEqual(['12:00:05 verify: command error']);
  });

  it('prints nothing for the start of the root span or of a span that is neither a step nor a runner', () => {
    expect(linesFor(base, 0)).toEqual([]);
    const other: RunRecord[] = [
      ...base,
      {
        type: 'span_started',
        at: T(5),
        traceId: TRACE,
        spanId: 'x',
        parentSpanId: ROOT,
        name: 'something else',
        attributes: {},
      },
      {
        type: 'span_ended',
        at: T(6),
        traceId: TRACE,
        spanId: 'x',
        status: 'ok',
        statusMessage: undefined,
        attributes: {},
        events: [],
      },
    ];
    expect(linesFor(other, 3)).toEqual([]);
    expect(linesFor(other, 4)).toEqual([]);
  });

  it('prints how the run ended', () => {
    for (const [status, word] of [
      ['COMPLETED', 'completed'],
      ['FAILED', 'failed'],
      ['ESCALATED', 'escalated'],
      ['CANCELLED', 'cancelled'],
    ] as const) {
      const records: RunRecord[] = [
        root(),
        {
          type: 'span_ended',
          at: T(61),
          traceId: TRACE,
          spanId: ROOT,
          status: 'ok',
          statusMessage: undefined,
          attributes: { 'indaba.workflow.status': status },
          events: [],
        },
      ];
      expect(linesFor(records, 1)).toEqual([`12:01:01 run ${word}`]);
    }
  });

  it('prints streamed output only when asked, one line each, and keeps blank lines in the middle', () => {
    const records = [...withRunner, output('code', 'acp', 'one\n\ntwo\n')];
    expect(linesFor(records, 5)).toEqual([]);
    expect(linesFor(records, 5, { output: true })).toEqual([
      '12:00:03 code | one',
      '12:00:03 code |',
      '12:00:03 code | two',
    ]);
    expect(linesFor(records, 5, { output: false })).toEqual([]);
  });

  it('prints nothing for output of a span it does not know, even when asked', () => {
    const records: RunRecord[] = [
      root(),
      { type: 'output', at: T(3), traceId: TRACE, spanId: 'ghost', seq: 0, text: 'lost\n', cut: false },
    ];
    expect(linesFor(records, 1, { output: true })).toEqual([]);
  });

  it('says when stored output ran out, and keeps a note for a line it could not read', () => {
    const records: RunRecord[] = [
      ...withRunner,
      { type: 'truncated', at: T(8), traceId: TRACE, spanId: 'p-code-acp' },
      { type: 'unknown', text: 'garbled' },
    ];
    expect(linesFor(records, 5)).toEqual(['12:00:08 output for this run ran out; the rest is not stored']);
    expect(linesFor(records, 6)).toEqual(['note: garbled']);
  });

  it('shows a dashed time for a record whose time it cannot read', () => {
    const odd: RunRecord = {
      type: 'step_status',
      at: 'not a time',
      traceId: TRACE,
      taskId: 't',
      stepId: 'a',
      from: 'X',
      to: 'Y',
      reason: undefined,
    };
    expect(formatEvent(reduceAll([root(), odd]), odd)).toEqual(['--:--:-- a: X -> Y']);
  });

  it('never lets an escape sequence through, in a step name, a reason, a runner, or output', () => {
    const evil = `x${ESC}[2J${ESC}]0;pwned${BEL}y`;
    const records: RunRecord[] = [
      root(),
      stepStart(evil),
      change(evil, 'FAILED', `why ${evil}`, T(3)),
      {
        type: 'span_started',
        at: T(4),
        traceId: TRACE,
        spanId: 'p-e-r',
        parentSpanId: `s-${evil}`,
        name: 'invoke_agent r',
        attributes: { 'indaba.runner': evil },
      },
      {
        type: 'output',
        at: T(5),
        traceId: TRACE,
        spanId: 'p-e-r',
        seq: 0,
        text: `out ${evil}\n`,
        cut: false,
      },
    ];
    const all = [2, 3, 4].flatMap((i) => linesFor(records, i, { output: true })).join('\n');
    expect(all).not.toContain(ESC);
    expect(all).not.toContain(BEL);
    expect(all).toContain('xy');
  });
});
