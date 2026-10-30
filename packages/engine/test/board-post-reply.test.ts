import {
  BoardKind,
  RunBoard,
  RunResult,
  SimpleEventDispatcher,
  type Span,
  Tracer,
  type WorkflowDefinition,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { GuardRegistry, parseWorkflow, StepExecutor } from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, makeTempDir, SequenceIds } from './support.js';

const WORKFLOW = `
version: "1.0"
name: posting
roles:
  worker: {runner: work}
steps:
  - id: writer
    role: worker
    goal: write
    board: {post: [note, fact]}
  - id: silent
    role: worker
    goal: write
`;

const REPLY = [
  'working on it',
  'BOARD note: the api is paged',
  'BOARD fact api.page: 50',
  'BOARD result: not allowed here',
  'BOARD nonsense',
].join('\n');

async function run(
  workflow: WorkflowDefinition,
  id: string,
  result: RunResult,
  withBoard = true,
  limits: ConstructorParameters<typeof RunBoard>[0]['limits'] = undefined,
) {
  const board = new RunBoard({
    traceId: 'abc',
    workflow: 'posting',
    clock: new FixedClock(),
    ...(limits === undefined ? {} : { limits }),
  });
  const runner = new FakeRunner('work', () => result);
  const tracer = new Tracer(new FixedClock(), new SimpleEventDispatcher(), new SequenceIds());
  const executor = new StepExecutor({
    runners: new FakeRegistry([runner]),
    guards: GuardRegistry.withDefaults(),
    tracer,
  });
  const span: Span = await tracer.startTrace('t');
  const step = workflow.steps.find((s) => s.id === id);
  if (step === undefined) {
    throw new Error(`no step ${id}`);
  }
  await executor.run(step, workflow, await makeTempDir(), span, withBoard ? { board, attempt: 2 } : {});
  return { board, span };
}

describe('posting from an agent reply', () => {
  const workflow = parseWorkflow(WORKFLOW);

  it('records the allowed lines as pending entries of the attempt, and counts the rest', async () => {
    const { board, span } = await run(workflow, 'writer', new RunResult({ exitCode: 0, output: REPLY }));
    const entries = board.entries({ states: ['pending'] });
    expect(entries.map((e) => [e.kind, e.key, e.text, e.attempt, e.source, e.sender])).toEqual([
      [BoardKind.Note, undefined, 'the api is paged', 2, 'agent', 'worker'],
      [BoardKind.Fact, 'api.page', '50', 2, 'agent', 'worker'],
    ]);
    expect(span.attributes?.['indaba.board.posted']).toBe(2);
    expect(span.attributes?.['indaba.board.ignored']).toBe(2);
  });

  it('scans under the limits the board was made with, not the defaults', async () => {
    const lines = Array.from({ length: 8 }, (_, i) => `BOARD note: line ${i}`).join(String.fromCharCode(10));
    const few = await run(workflow, 'writer', new RunResult({ exitCode: 0, output: lines }), true, {
      maxPostsPerReply: 3,
    });
    expect(few.board.entries({ states: ['pending'] })).toHaveLength(3);
    expect(few.span.attributes?.['indaba.board.posted']).toBe(3);
    expect(few.span.attributes?.['indaba.board.ignored']).toBe(5);

    const many = Array.from({ length: 12 }, (_, i) => `BOARD note: line ${i}`).join(String.fromCharCode(10));
    const wide = await run(workflow, 'writer', new RunResult({ exitCode: 0, output: many }), true, {
      maxPostsPerReply: 12,
    });
    expect(wide.board.entries({ states: ['pending'] })).toHaveLength(12);

    const long = `BOARD note: ${'x'.repeat(3000)}`;
    const big = await run(workflow, 'writer', new RunResult({ exitCode: 0, output: long }), true, {
      maxEntryChars: 5000,
    });
    expect(big.board.entries({ states: ['pending'] })[0]?.text).toHaveLength(3000);
  });

  it('counts a line the full board refused as ignored, not posted', async () => {
    const { board, span } = await run(
      workflow,
      'writer',
      new RunResult({ exitCode: 0, output: REPLY }),
      true,
      {
        maxEntries: 1,
      },
    );
    expect(board.entries({ states: ['pending'] })).toHaveLength(1);
    expect(span.attributes?.['indaba.board.posted']).toBe(1);
    expect(span.attributes?.['indaba.board.ignored']).toBe(3);
  });

  it('scans nothing for a step without board.post', async () => {
    const { board, span } = await run(workflow, 'silent', new RunResult({ exitCode: 0, output: REPLY }));
    expect(board.records().filter((r) => r.type === 'post')).toHaveLength(0);
    expect(span.attributes?.['indaba.board.posted']).toBeUndefined();
  });

  it('scans nothing from a failed result', async () => {
    const { board } = await run(workflow, 'writer', new RunResult({ exitCode: 1, output: REPLY }));
    expect(board.records().filter((r) => r.type === 'post')).toHaveLength(0);
  });

  it('does nothing without a run board', async () => {
    const { span } = await run(workflow, 'writer', new RunResult({ exitCode: 0, output: REPLY }), false);
    expect(span.attributes?.['indaba.board.posted']).toBeUndefined();
  });
});
