import { defineStep, FailureAction, RunResult, SpanStarted, type StepStructure } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  describeStructure,
  MAX_STRUCTURE_STEPS,
  parseWorkflow,
  readStructure,
  reduceAll,
  WORKFLOW_STRUCTURE_ATTRIBUTE,
} from '../src/index.js';
import { FakeRunner, harness, makeGitRepo } from './support.js';

const RETRY = `version: "1.0"
name: retry
roles: {r: {runner: r}}
steps:
  - {id: rfc, role: r, goal: Write}
  - {id: code, role: r, goal: Code, depends_on: [rfc]}
  - id: verify
    role: r
    goal: Check
    depends_on: [code]
    on_failure: {action: retry_step, target: code, max_retries: 3}
  - {id: review, role: r, goal: Review, depends_on: [verify], on_failure: {action: escalate}}
`;

const expected: readonly StepStructure[] = [
  { id: 'rfc', dependsOn: [], onFailure: undefined },
  { id: 'code', dependsOn: ['rfc'], onFailure: undefined },
  { id: 'verify', dependsOn: ['code'], onFailure: { action: 'retry_step', target: 'code', maxRetries: 3 } },
  {
    id: 'review',
    dependsOn: ['verify'],
    onFailure: { action: 'escalate', target: undefined, maxRetries: 0 },
  },
];

/** The structure attribute of the root span of a run of this workflow, as the engine wrote it. */
async function recordedBy(yaml: string): Promise<unknown> {
  const repo = await makeGitRepo();
  const { engine, events } = harness(repo, [
    new FakeRunner('r', () => new RunResult({ exitCode: 0, output: 'ok' })),
  ]);
  const roots: unknown[] = [];
  events.addListener(SpanStarted, (event) => {
    if (event.span.parentSpanId === undefined) {
      roots.push(event.span.attributes[WORKFLOW_STRUCTURE_ATTRIBUTE]);
    }
  });
  await engine.run(parseWorkflow(yaml), { taskId: 'S' });
  expect(roots).toHaveLength(1);
  return roots[0];
}

describe('the recorded structure of a run', () => {
  it('reads back what it wrote, for a retry, an escalation and a step with no on_failure', () => {
    const workflow = parseWorkflow(RETRY);
    expect(readStructure(describeStructure(workflow.steps))).toEqual(expected);
  });

  it('writes nothing for an absent target, so the record stays small', () => {
    const text = describeStructure([
      defineStep({ id: 'a', goal: 'A', onFailure: { action: FailureAction.Fail, maxRetries: 0 } }),
    ]);
    expect(text).toBe('[{"id":"a","dependsOn":[],"onFailure":{"action":"fail","maxRetries":0}}]');
  });

  it('is written on the root span when the run starts, before any step runs', async () => {
    expect(readStructure(await recordedBy(RETRY))).toEqual(expected);
  });

  it('lists the steps in the order the engine runs them, not the order of the file', async () => {
    const recorded = readStructure(
      await recordedBy(`version: "1.0"
name: o
roles: {r: {runner: r}}
steps:
  - {id: c, role: r, goal: C, depends_on: [a]}
  - {id: a, role: r, goal: A}
`),
    );
    expect(recorded?.map((s) => s.id)).toEqual(['a', 'c']);
  });

  describe('reading a value it cannot trust gives undefined, never a partial graph', () => {
    const one = (patch: Record<string, unknown>): string =>
      JSON.stringify([{ id: 'a', dependsOn: [], ...patch }]);

    it.each([
      ['no value', undefined],
      ['a number', 7],
      ['not JSON', '[{"id":'],
      ['not a list', '{"id":"a"}'],
      ['a step that is not an object', '["a"]'],
      ['a step with no id', JSON.stringify([{ dependsOn: [] }])],
      ['an empty id', one({ id: '' })],
      ['an id too long to be one', one({ id: 'x'.repeat(201) })],
      ['dependsOn that is not a list', one({ dependsOn: 'b' })],
      ['dependsOn with a number', one({ dependsOn: [1] })],
      ['an edge to a step it does not list', one({ dependsOn: ['ghost'] })],
      ['a failure route that is not an object', one({ onFailure: 'retry' })],
      ['a failure route with no action', one({ onFailure: { maxRetries: 1 } })],
      [
        'a retry count that is negative',
        one({ onFailure: { action: 'retry_step', target: 'a', maxRetries: -1 } }),
      ],
      [
        'a retry count that is not whole',
        one({ onFailure: { action: 'retry_step', target: 'a', maxRetries: 1.5 } }),
      ],
      ['a target that is not text', one({ onFailure: { action: 'retry_step', target: 3, maxRetries: 1 } })],
      [
        'a target it does not list',
        one({ onFailure: { action: 'retry_step', target: 'ghost', maxRetries: 1 } }),
      ],
      [
        'the same id twice',
        JSON.stringify([
          { id: 'a', dependsOn: [] },
          { id: 'a', dependsOn: [] },
        ]),
      ],
      [
        'more steps than it reads',
        JSON.stringify(
          Array.from({ length: MAX_STRUCTURE_STEPS + 1 }, (_, i) => ({ id: `s${i}`, dependsOn: [] })),
        ),
      ],
    ])('%s', (_name, value) => {
      expect(readStructure(value)).toBeUndefined();
    });
  });

  it('keeps an id it does not understand as text, for the server to sanitise', () => {
    const odd = `a${String.fromCharCode(27)}[31m<b>`;
    expect(readStructure(JSON.stringify([{ id: odd, dependsOn: [] }]))).toEqual([
      { id: odd, dependsOn: [], onFailure: undefined },
    ]);
  });
});

describe('the run view and the structure', () => {
  const TRACE = 'a'.repeat(32);
  const root = (attributes: Record<string, string>) =>
    ({
      type: 'span_started',
      at: '2026-10-20T12:00:00.000Z',
      traceId: TRACE,
      spanId: 'r'.repeat(16),
      parentSpanId: undefined,
      name: 'indaba.task retry',
      attributes: { 'indaba.workflow.name': 'retry', ...attributes },
    }) as const;

  it('takes the structure from the root span and leaves the steps to the records', () => {
    const run = reduceAll([
      root({ [WORKFLOW_STRUCTURE_ATTRIBUTE]: describeStructure(parseWorkflow(RETRY).steps) }),
    ]);
    expect(run.structure).toEqual(expected);
    expect(run.steps).toEqual([]);
  });

  it('says nothing about the structure of a run recorded before it was written', () => {
    expect(reduceAll([root({})]).structure).toBeUndefined();
  });

  it('ignores a structure it cannot read and still shows the run', () => {
    const run = reduceAll([root({ [WORKFLOW_STRUCTURE_ATTRIBUTE]: 'not json' })]);
    expect(run.structure).toBeUndefined();
    expect(run.workflow).toBe('retry');
  });
});
