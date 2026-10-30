import {
  BoardKind,
  type BoardPostInput,
  RunBoard,
  RunResult,
  SimpleEventDispatcher,
  type Span,
  type StepDefinition,
  Tracer,
  type WorkflowDefinition,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { GuardRegistry, PromptBuilder, parseWorkflow, StepExecutor } from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, makeTempDir, SequenceIds } from './support.js';

const WORKFLOW = `
version: "1.0"
name: digest
roles:
  worker: {runner: work}
  critic: {runner: work}
steps:
  - {id: a, role: worker, goal: first}
  - {id: c, role: worker, goal: unrelated}
  - id: b
    role: worker
    goal: second
    depends_on: [a]
    inputs_placeholder: ignored
    outputs: [out.md]
    board: {read: {}}
  - id: me
    role: worker
    goal: third
    depends_on: [b]
    board: {read: {}}
`;

function definition(extra = ''): WorkflowDefinition {
  return parseWorkflow(WORKFLOW.replace('    inputs_placeholder: ignored\n', extra));
}

function step(workflow: WorkflowDefinition, id: string): StepDefinition {
  const found = workflow.steps.find((s) => s.id === id);
  if (found === undefined) {
    throw new Error(`no step ${id}`);
  }
  return found;
}

function newBoard(): RunBoard {
  return new RunBoard({ traceId: 'abc', workflow: 'digest', clock: new FixedClock() });
}

/** Posts the entries of one step attempt and settles it. */
function posted(
  board: RunBoard,
  stepId: string,
  entries: readonly (Partial<BoardPostInput> & { text: string })[],
  outcome: 'accepted' | 'discarded' | 'pending' = 'accepted',
  attempt = 1,
): void {
  for (const entry of entries) {
    board.post({ stepId, attempt, source: 'agent', sender: 'writer', kind: BoardKind.Note, ...entry });
  }
  if (outcome !== 'pending') {
    board.settle({ stepId, attempt, outcome });
  }
}

async function runStep(
  workflow: WorkflowDefinition,
  id: string,
  board: RunBoard | undefined,
  reply = 'done',
) {
  const dir = await makeTempDir();
  const runner = new FakeRunner('work', () => new RunResult({ exitCode: 0, output: reply }));
  const events = new SimpleEventDispatcher();
  const tracer = new Tracer(new FixedClock(), events, new SequenceIds());
  const executor = new StepExecutor({
    runners: new FakeRegistry([runner]),
    guards: GuardRegistry.withDefaults(),
    tracer,
  });
  const span: Span = await tracer.startTrace('t');
  const outcome = await executor.run(step(workflow, id), workflow, dir, span, {
    ...(board === undefined ? {} : { board, attempt: 1 }),
  });
  return { outcome, prompts: runner.requests.map((r) => r.prompt), span };
}

describe('PromptBuilder with a digest', () => {
  const builder = new PromptBuilder();
  const base = parseWorkflow(WORKFLOW).steps.find((s) => s.id === 'b') as StepDefinition;

  it('is byte-identical without a digest', () => {
    expect(builder.build(base, 'broke')).toBe(builder.build(base, 'broke', undefined));
    expect(builder.build(base)).not.toContain('Notes from earlier steps');
  });

  it('adds the digest as a section of its own, after the artifacts and before the required outputs', () => {
    const prompt = builder.build({ ...base, inputArtifacts: ['in.md'] }, 'broke', '| #1 a writer note: hi');
    const at = (text: string) => prompt.indexOf(text);
    expect(prompt).toContain('## The board: notes from earlier steps\n| #1 a writer note: hi');
    expect(at('## Input artifacts')).toBeLessThan(at('## The board'));
    expect(at('## The board')).toBeLessThan(at('## Required outputs'));
    expect(at('## Required outputs')).toBeLessThan(at('## The previous attempt failed'));
  });
});

describe('the digest in an agent step’s prompt', () => {
  it('holds what the ancestors posted and was accepted, and nothing else', async () => {
    const board = newBoard();
    posted(board, 'a', [{ text: 'from the ancestor' }]);
    posted(board, 'c', [{ text: 'from a step that is not an ancestor' }]);
    posted(board, 'a', [{ text: 'a failed try' }], 'discarded', 2);
    posted(board, 'a', [{ text: 'still pending' }], 'pending', 3);
    posted(board, 'b', [{ text: 'my own earlier note' }]);
    posted(board, 'a', [{ text: 'a long critique', kind: BoardKind.Critique }]);
    const { prompts } = await runStep(definition(), 'b', board);
    const prompt = prompts[0] ?? '';
    expect(prompt).toContain('from the ancestor');
    for (const absent of [
      'not an ancestor',
      'failed try',
      'still pending',
      'my own earlier',
      'long critique',
    ]) {
      expect(prompt).not.toContain(absent);
    }
  });

  it('reads transitive ancestors by default, and only the listed steps and kinds when told', async () => {
    const board = newBoard();
    posted(board, 'a', [{ text: 'deep note' }, { text: 'deep result', kind: BoardKind.Result }]);
    posted(board, 'b', [{ text: 'near note' }]);
    const all = await runStep(definition(), 'me', board);
    expect(all.prompts[0]).toContain('deep note');
    expect(all.prompts[0]).toContain('near note');

    const limited = parseWorkflow(
      WORKFLOW.replace('    board: {read: {}}\n', '    board: {read: {}}\n').replace(
        '    goal: third\n    depends_on: [b]\n    board: {read: {}}',
        '    goal: third\n    depends_on: [b]\n    board: {read: {steps: [a], kinds: [result]}}',
      ),
    );
    const only = await runStep(limited, 'me', board);
    expect(only.prompts[0]).toContain('deep result');
    expect(only.prompts[0]).not.toContain('deep note');
    expect(only.prompts[0]).not.toContain('near note');
  });

  it('leaves a step without board.read exactly as it was, with no attributes', async () => {
    const board = newBoard();
    posted(board, 'a', [{ text: 'a note' }]);
    const withBoard = await runStep(definition(), 'a', board);
    const without = await runStep(definition(), 'a', undefined);
    expect(withBoard.prompts).toEqual(without.prompts);
    expect(withBoard.span.attributes).not.toHaveProperty('indaba.board.digest.entries');
    const noBoardAtAll = await runStep(definition(), 'b', undefined);
    expect(noBoardAtAll.prompts[0]).not.toContain('The board');
  });

  it('is built from the board as it stands when the call starts, so a retry differs only by what other steps posted', async () => {
    const board = newBoard();
    posted(board, 'a', [{ text: 'first note' }]);
    const first = await runStep(definition(), 'b', board);
    posted(board, 'b', [{ text: 'the failed attempt’s own note' }], 'discarded');
    const second = await runStep(definition(), 'b', board);
    expect(second.prompts[0]).toBe(first.prompts[0]);
    posted(board, 'a', [{ text: 'a later note by an accepted step' }], 'accepted', 2);
    const third = await runStep(definition(), 'b', board);
    expect(third.prompts[0]).toContain('a later note by an accepted step');
  });

  it('records the entries, characters and omitted count on the step’s span, and no text', async () => {
    const board = newBoard();
    posted(board, 'a', [{ text: 'one' }, { text: 'two' }]);
    const { span, prompts } = await runStep(definition(), 'b', board);
    const attributes = span.attributes;
    expect(attributes['indaba.board.digest.entries']).toBe(2);
    expect(attributes['indaba.board.digest.omitted']).toBe(0);
    expect(attributes['indaba.board.digest.chars']).toBeGreaterThan(0);
    expect(JSON.stringify(attributes)).not.toContain('one');
    expect(prompts[0]).toContain('| #1 a writer note: one');
  });

  it('honours digest_chars and counts what did not fit', async () => {
    const board = newBoard();
    posted(
      board,
      'a',
      Array.from({ length: 30 }, (_, i) => ({ text: `entry number ${i} ${'x'.repeat(40)}` })),
    );
    const small = parseWorkflow(
      WORKFLOW.replace('board: {read: {}}\n  - id: me', 'board: {read: {}, digest_chars: 400}\n  - id: me'),
    );
    const { span } = await runStep(small, 'b', board);
    expect(span.attributes['indaba.board.digest.omitted']).toBeGreaterThan(0);
    expect(Number(span.attributes['indaba.board.digest.chars'])).toBeLessThanOrEqual(400);
  });
});

describe('the digest in a debate’s topic', () => {
  const DEBATE = `
version: "1.0"
name: digest
roles:
  worker: {runner: work}
  critic: {runner: work}
steps:
  - {id: a, role: worker, goal: first}
  - id: d
    role: worker
    goal: Is it fine?
    depends_on: [a]
    consensus_with: [critic]
    board: {read: {}}
`;

  it('adds the digest to what the participants are asked, when the step reads', async () => {
    const board = newBoard();
    posted(board, 'a', [{ text: 'the earlier finding' }]);
    const { prompts } = await runStep(parseWorkflow(DEBATE), 'd', board, 'AGREEMENT: fine');
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      expect(prompt).toContain('Is it fine?');
      expect(prompt).toContain('| #1 a writer note: the earlier finding');
    }
  });

  it('leaves a debate without board.read as it was', async () => {
    const board = newBoard();
    posted(board, 'a', [{ text: 'the earlier finding' }]);
    const plain = DEBATE.replace('    board: {read: {}}\n', '');
    const { prompts } = await runStep(parseWorkflow(plain), 'd', board, 'AGREEMENT: fine');
    for (const prompt of prompts) {
      expect(prompt).not.toContain('earlier finding');
    }
  });
});
