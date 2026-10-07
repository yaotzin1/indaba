import { describe, expect, it } from 'vitest';
import { isRunId, parseRecord, type RunRecord, serializeRecord, type UnknownRecord } from '../src/index.js';

const AT = '2026-10-05T12:00:00.000Z';
const TRACE = 'a'.repeat(32);
const SPAN = 'b'.repeat(16);

type Writable = Exclude<RunRecord, UnknownRecord>;

const SAMPLES: Writable[] = [
  {
    type: 'span_started',
    at: AT,
    traceId: TRACE,
    spanId: SPAN,
    parentSpanId: 'c'.repeat(16),
    name: 'step build',
    attributes: { 'indaba.runner': 'acp', 'indaba.n': 3, 'indaba.ok': true },
  },
  {
    type: 'span_started',
    at: AT,
    traceId: TRACE,
    spanId: SPAN,
    parentSpanId: undefined,
    name: 'indaba.task t',
    attributes: {},
  },
  {
    type: 'span_ended',
    at: AT,
    traceId: TRACE,
    spanId: SPAN,
    status: 'ERROR',
    statusMessage: 'boom',
    attributes: { 'indaba.exit_code': 1 },
    events: [{ name: 'indaba.runner.skipped', attributes: { 'indaba.runner': 'api' } }],
  },
  {
    type: 'span_ended',
    at: AT,
    traceId: TRACE,
    spanId: SPAN,
    status: 'OK',
    statusMessage: undefined,
    attributes: {},
    events: [],
  },
  {
    type: 'step_status',
    at: AT,
    traceId: TRACE,
    taskId: 't1',
    stepId: 'code',
    from: 'RUNNING',
    to: 'FAILED',
    reason: 'tests red',
  },
  {
    type: 'step_status',
    at: AT,
    traceId: TRACE,
    taskId: 't1',
    stepId: 'code',
    from: 'PENDING',
    to: 'RUNNING',
    reason: undefined,
  },
  { type: 'output', at: AT, traceId: TRACE, spanId: SPAN, seq: 0, text: 'hello\n', cut: false },
  { type: 'output', at: AT, traceId: TRACE, spanId: SPAN, seq: 7, text: 'x'.repeat(10), cut: true },
  { type: 'truncated', at: AT, traceId: TRACE, spanId: SPAN },
];

describe('serializeRecord and parseRecord', () => {
  it.each(SAMPLES.map((record, i) => [`${record.type} #${i}`, record] as const))(
    'a %s survives a round trip',
    (_name, record) => {
      const line = serializeRecord(record);
      expect(line).not.toContain('\n');
      expect(parseRecord(line)).toEqual(record);
    },
  );

  it('writes snake_case names on the wire', () => {
    const wire = JSON.parse(serializeRecord(SAMPLES[0] as Writable)) as Record<string, unknown>;
    expect(Object.keys(wire).sort()).toEqual([
      'at',
      'attributes',
      'name',
      'parent_span_id',
      'span_id',
      'trace_id',
      'type',
    ]);
    expect(wire.parent_span_id).toBe('c'.repeat(16));
  });

  it('writes a missing parent as null and a missing reason or message as nothing or null', () => {
    expect(JSON.parse(serializeRecord(SAMPLES[1] as Writable))).toMatchObject({ parent_span_id: null });
    expect(JSON.parse(serializeRecord(SAMPLES[3] as Writable))).toMatchObject({ status_message: null });
    expect(JSON.parse(serializeRecord(SAMPLES[5] as Writable))).not.toHaveProperty('reason');
  });

  it('writes the cut flag only when the text was cut', () => {
    expect(JSON.parse(serializeRecord(SAMPLES[6] as Writable))).not.toHaveProperty('cut');
    expect(JSON.parse(serializeRecord(SAMPLES[7] as Writable))).toHaveProperty('cut', true);
  });
});

describe('parseRecord is total', () => {
  const unknownOf = (line: string): string => {
    const record = parseRecord(line);
    expect(record.type).toBe('unknown');
    return record.type === 'unknown' ? record.text : '';
  };

  it.each([
    ['not JSON', 'hello there'],
    ['an empty line', ''],
    ['a number', '42'],
    ['null', 'null'],
    ['a list', '[1,2,3]'],
    ['a string', '"x"'],
    ['an object with no type', '{"at":"t","trace_id":"a"}'],
    ['an unknown type', '{"type":"mystery","at":"t","trace_id":"a"}'],
    ['a type that is not a string', '{"type":7,"at":"t","trace_id":"a"}'],
    ['no time', '{"type":"truncated","trace_id":"a","span_id":"s"}'],
    ['no trace id', '{"type":"truncated","at":"t","span_id":"s"}'],
    ['a time that is not a string', '{"type":"truncated","at":5,"trace_id":"a","span_id":"s"}'],
    ['a half-written line', '{"type":"output","at":"t","trace_id":"a","span_id":"s","seq":0,"te'],
  ])('keeps %s as an unknown record', (_name, line) => {
    expect(unknownOf(line)).toBe(line);
  });

  it.each([
    ['span_started without a span id', { type: 'span_started', at: 't', trace_id: 'a', name: 'n' }],
    ['span_started without a name', { type: 'span_started', at: 't', trace_id: 'a', span_id: 's' }],
    ['span_ended without a status', { type: 'span_ended', at: 't', trace_id: 'a', span_id: 's' }],
    [
      'span_ended with a numeric status',
      { type: 'span_ended', at: 't', trace_id: 'a', span_id: 's', status: 1 },
    ],
    [
      'step_status without a step',
      { type: 'step_status', at: 't', trace_id: 'a', task_id: 'x', from: 'a', to: 'b' },
    ],
    [
      'step_status without a task',
      { type: 'step_status', at: 't', trace_id: 'a', step_id: 'x', from: 'a', to: 'b' },
    ],
    [
      'step_status without from',
      { type: 'step_status', at: 't', trace_id: 'a', task_id: 'x', step_id: 'y', to: 'b' },
    ],
    [
      'step_status without to',
      { type: 'step_status', at: 't', trace_id: 'a', task_id: 'x', step_id: 'y', from: 'b' },
    ],
    ['output without a span', { type: 'output', at: 't', trace_id: 'a', seq: 0, text: 'x' }],
    ['output without text', { type: 'output', at: 't', trace_id: 'a', span_id: 's', seq: 0 }],
    [
      'output with a negative seq',
      { type: 'output', at: 't', trace_id: 'a', span_id: 's', seq: -1, text: 'x' },
    ],
    [
      'output with a fractional seq',
      { type: 'output', at: 't', trace_id: 'a', span_id: 's', seq: 1.5, text: 'x' },
    ],
    [
      'output with a string seq',
      { type: 'output', at: 't', trace_id: 'a', span_id: 's', seq: '1', text: 'x' },
    ],
    ['truncated without a span', { type: 'truncated', at: 't', trace_id: 'a' }],
  ])('keeps %s as an unknown record', (_name, value) => {
    expect(parseRecord(JSON.stringify(value)).type).toBe('unknown');
  });

  it('accepts seq 0 and a large seq', () => {
    expect(
      parseRecord('{"type":"output","at":"t","trace_id":"a","span_id":"s","seq":0,"text":""}').type,
    ).toBe('output');
    expect(
      parseRecord('{"type":"output","at":"t","trace_id":"a","span_id":"s","seq":4000000000,"text":""}').type,
    ).toBe('output');
  });

  it('shortens an unknown line to 500 characters', () => {
    expect(unknownOf('x'.repeat(501))).toBe('x'.repeat(500));
    expect(unknownOf('x'.repeat(500))).toBe('x'.repeat(500));
    expect(unknownOf('x'.repeat(10_000))).toHaveLength(500);
  });

  it('keeps only attributes that are strings, numbers or booleans', () => {
    const record = parseRecord(
      JSON.stringify({
        type: 'span_started',
        at: 't',
        trace_id: 'a',
        span_id: 's',
        name: 'n',
        attributes: { s: 'x', n: 1, b: false, o: { deep: 1 }, a: [1], z: null },
      }),
    );
    expect(record).toMatchObject({ attributes: { s: 'x', n: 1, b: false } });
    expect(record.type === 'span_started' ? Object.keys(record.attributes).sort() : []).toEqual([
      'b',
      'n',
      's',
    ]);
  });

  it('reads attributes that are not an object as none', () => {
    for (const attributes of ['x', 5, null, [1, 2], true]) {
      const record = parseRecord(
        JSON.stringify({ type: 'span_started', at: 't', trace_id: 'a', span_id: 's', name: 'n', attributes }),
      );
      expect(record.type === 'span_started' ? record.attributes : undefined).toEqual({});
    }
  });

  it('keeps only span events that are objects with a name, and reads events that are not a list as none', () => {
    const base = { type: 'span_ended', at: 't', trace_id: 'a', span_id: 's', status: 'OK' };
    const mixed = parseRecord(
      JSON.stringify({
        ...base,
        events: [{ name: 'a', attributes: { k: 1 } }, null, 5, { x: 1 }, { name: 7 }, { name: 'b' }],
      }),
    );
    expect(mixed.type === 'span_ended' ? mixed.events : undefined).toEqual([
      { name: 'a', attributes: { k: 1 } },
      { name: 'b', attributes: {} },
    ]);
    for (const events of ['x', 5, null, { name: 'a' }]) {
      const record = parseRecord(JSON.stringify({ ...base, events }));
      expect(record.type === 'span_ended' ? record.events : undefined).toEqual([]);
    }
  });

  it('treats a null parent, a missing parent and a reason of the wrong type consistently', () => {
    const started = parseRecord(
      '{"type":"span_started","at":"t","trace_id":"a","span_id":"s","name":"n","parent_span_id":null}',
    );
    expect(started.type === 'span_started' ? started.parentSpanId : 'x').toBeUndefined();
    const status = parseRecord(
      '{"type":"step_status","at":"t","trace_id":"a","task_id":"x","step_id":"y","from":"a","to":"b","reason":5}',
    );
    expect(status.type === 'step_status' ? status.reason : 'x').toBeUndefined();
  });

  it('never throws, whatever the line is', () => {
    const lines: string[] = [];
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const pieces = [
      '{',
      '}',
      '[',
      ']',
      '"',
      ':',
      ',',
      'null',
      'true',
      '"type"',
      '"output"',
      '"at"',
      '"trace_id"',
      '1',
      '\\',
      '\u0000',
      ' ',
      'x',
    ];
    for (let i = 0; i < 400; i++) {
      let line = '';
      for (let j = next() % 14; j > 0; j--) {
        line += pieces[next() % pieces.length];
      }
      lines.push(line);
    }
    for (const sample of SAMPLES) {
      const text = serializeRecord(sample);
      for (const cut of [1, 5, text.length >> 1, text.length - 1]) {
        lines.push(text.slice(0, cut));
      }
    }
    for (const line of lines) {
      expect(() => parseRecord(line)).not.toThrow();
      expect(['unknown', 'span_started', 'span_ended', 'step_status', 'output', 'truncated']).toContain(
        parseRecord(line).type,
      );
    }
  });
});

describe('isRunId', () => {
  it.each(['a', '0', 'abcdef0123456789', 'a'.repeat(32), 'a'.repeat(64)])('accepts %s', (id) => {
    expect(isRunId(id)).toBe(true);
  });

  it.each([
    '',
    'A',
    'ABCDEF',
    'g',
    '../x',
    '..',
    'a/b',
    'a\\b',
    'a.b',
    ' a',
    'a ',
    'a\n',
    'a'.repeat(65),
    'a\u0000',
    'é',
  ])('refuses %j', (id) => {
    expect(isRunId(id)).toBe(false);
  });
});
