import {
  BoardKind,
  type BoardRecord,
  BoardRecorded,
  type EntryState,
  type RunBoard,
  RunResult,
  SimpleEventDispatcher,
  type Span,
  type StepDefinition,
  Tracer,
  type WorkflowDefinition,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  GitWorktreeManager,
  GuardRegistry,
  parseWorkflow,
  StepExecutor,
  StepOutcome,
  type StepRunOptions,
  WorkflowEngine,
  WorkflowStatus,
} from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, makeGitRepo, SequenceIds } from './support.js';

type Script = (step: StepDefinition, board: RunBoard, attempt: number) => 'ok' | 'fail' | 'cancel';

/** An executor that posts to the board it is given, so the wiring is what is under test. */
class PostingExecutor extends StepExecutor {
  readonly seen: { stepId: string; attempt: number | undefined; hasBoard: boolean }[] = [];

  constructor(
    private readonly script: Script,
    deps: ConstructorParameters<typeof StepExecutor>[0],
  ) {
    super(deps);
  }

  override async run(
    step: StepDefinition,
    _workflow: WorkflowDefinition,
    _workdir: string,
    _span: Span,
    options: StepRunOptions = {},
  ): Promise<StepOutcome> {
    this.seen.push({ stepId: step.id, attempt: options.attempt, hasBoard: options.board !== undefined });
    const board = options.board;
    if (board === undefined) {
      throw new Error('the engine passed no board');
    }
    const attempt = options.attempt ?? 0;
    board.post({
      stepId: step.id,
      attempt,
      source: 'agent',
      sender: 'writer',
      kind: BoardKind.Note,
      text: `${step.id} attempt ${attempt} SECRET`,
    });
    const verdict = this.script(step, board, attempt);
    if (verdict === 'cancel') {
      return StepOutcome.cancelled();
    }
    return verdict === 'ok' ? StepOutcome.ok() : StepOutcome.failed('it failed');
  }

  override async validate(): Promise<StepOutcome> {
    return StepOutcome.ok();
  }
}

const WORKFLOW = `
version: "1.0"
name: board-run
roles:
  worker: {runner: work}
steps:
  - {id: a, role: worker, goal: first}
  - id: b
    role: worker
    goal: second
    depends_on: [a]
    on_failure: {action: retry_step, target: a, max_retries: 1}
`;

async function setup(
  script: Script,
  options: ConstructorParameters<typeof WorkflowEngine>[0]['board'] = undefined,
) {
  const repo = await makeGitRepo();
  const events = new SimpleEventDispatcher();
  const records: BoardRecorded[] = [];
  events.addListener(BoardRecorded, (e) => {
    records.push(e);
  });
  const ids = new SequenceIds();
  const tracer = new Tracer(new FixedClock(), events, ids);
  const executor = new PostingExecutor(script, {
    runners: new FakeRegistry([new FakeRunner('work', () => new RunResult({ exitCode: 0, output: '' }))]),
    guards: GuardRegistry.withDefaults(),
    tracer,
  });
  const engine = new WorkflowEngine({
    executor,
    tracer,
    events,
    workspaces: new GitWorktreeManager(repo),
    projectDir: repo,
    ids,
    ...(options === undefined ? {} : { board: options }),
  });
  return { engine, executor, records };
}

function stateOf(records: readonly BoardRecorded[], text: string): EntryState {
  const post = records.map((r) => r.record).find((r) => r.type === 'post' && r.text === text);
  if (post === undefined || post.type !== 'post') {
    throw new Error(`no post "${text}"`);
  }
  let state: EntryState = 'pending';
  for (const { record } of records) {
    if (
      record.type === 'settle' &&
      record.seq > post.seq &&
      record.stepId === post.stepId &&
      record.attempt === post.attempt
    ) {
      if (record.outcome === 'superseded' ? state === 'accepted' : state === 'pending') {
        state = record.outcome;
      }
    }
  }
  return state;
}

const types = (records: readonly BoardRecorded[]): BoardRecord['type'][] => records.map((r) => r.record.type);

describe('the run board in the engine', () => {
  it('dispatches the start record first, with the trace id and the workflow name', async () => {
    const { engine, records } = await setup(() => 'ok');
    const result = await engine.run(parseWorkflow(WORKFLOW));
    expect(records[0]?.traceId).toBe(result.traceId);
    expect(records[0]?.record).toMatchObject({
      type: 'board',
      v: 1,
      workflow: 'board-run',
      traceId: result.traceId,
    });
    expect(records.every((r) => r.traceId === result.traceId)).toBe(true);
  });

  it('hands every step the board and its attempt number', async () => {
    const { engine, executor } = await setup(() => 'ok');
    await engine.run(parseWorkflow(WORKFLOW));
    expect(executor.seen).toEqual([
      { stepId: 'a', attempt: 1, hasBoard: true },
      { stepId: 'b', attempt: 1, hasBoard: true },
    ]);
  });

  it('accepts a completed step attempt’s entries, and every record has reached the listeners when run returns', async () => {
    const { engine, records } = await setup(() => 'ok');
    const result = await engine.run(parseWorkflow(WORKFLOW));
    expect(result.status).toBe(WorkflowStatus.Completed);
    expect(types(records)).toEqual(['board', 'post', 'settle', 'post', 'settle']);
    expect(stateOf(records, 'a attempt 1 SECRET')).toBe('accepted');
    expect(stateOf(records, 'b attempt 1 SECRET')).toBe('accepted');
  });

  it('discards the entries of a step that fails with no retry, and of one that escalates', async () => {
    const failing = await setup((step) => (step.id === 'a' ? 'fail' : 'ok'));
    const failed = await failing.engine.run(parseWorkflow(WORKFLOW));
    expect(failed.status).toBe(WorkflowStatus.Failed);
    expect(stateOf(failing.records, 'a attempt 1 SECRET')).toBe('discarded');

    const escalating = await setup((step) => (step.id === 'b' ? 'fail' : 'ok'));
    const escalated = await escalating.engine.run(
      parseWorkflow(WORKFLOW.replace(/on_failure:.*/, 'on_failure: {action: escalate}')),
    );
    expect(escalated.status).toBe(WorkflowStatus.Escalated);
    expect(stateOf(escalating.records, 'b attempt 1 SECRET')).toBe('discarded');
    expect(stateOf(escalating.records, 'a attempt 1 SECRET')).toBe('accepted');
  });

  it('settles nothing for a cancelled step: its entries stay pending', async () => {
    const { engine, records } = await setup(() => 'cancel');
    const result = await engine.run(parseWorkflow(WORKFLOW));
    expect(result.status).toBe(WorkflowStatus.Cancelled);
    expect(stateOf(records, 'a attempt 1 SECRET')).toBe('pending');
    expect(types(records)).toEqual(['board', 'post']);
  });

  it('supersedes the accepted entries of every step a retry resets, before the target runs again', async () => {
    const { engine, executor, records } = await setup((step, _board, attempt) =>
      step.id === 'b' && attempt === 1 ? 'fail' : 'ok',
    );
    const result = await engine.run(parseWorkflow(WORKFLOW));
    expect(result.status).toBe(WorkflowStatus.Completed);
    expect(executor.seen.map((s) => `${s.stepId}#${s.attempt}`)).toEqual(['a#1', 'b#1', 'a#2', 'b#2']);
    // a's first attempt was accepted, then superseded by b's retry; b's failed attempt was discarded
    expect(stateOf(records, 'a attempt 1 SECRET')).toBe('superseded');
    expect(stateOf(records, 'b attempt 1 SECRET')).toBe('discarded');
    expect(stateOf(records, 'a attempt 2 SECRET')).toBe('accepted');
    expect(stateOf(records, 'b attempt 2 SECRET')).toBe('accepted');
    // the supersede record comes before a's second attempt posts
    const order = records.map((r) => r.record);
    const superseded = order.findIndex((r) => r.type === 'settle' && r.outcome === 'superseded');
    const rerun = order.findIndex((r) => r.type === 'post' && r.text === 'a attempt 2 SECRET');
    expect(superseded).toBeGreaterThan(-1);
    expect(superseded).toBeLessThan(rerun);
  });

  it('redacts with the function it was given and applies its limits', async () => {
    const { engine, records } = await setup(() => 'ok', {
      redact: (text) => text.replaceAll('SECRET', '[redacted]'),
      limits: { maxEntries: 1 },
    });
    await engine.run(parseWorkflow(WORKFLOW));
    const posts = records.flatMap((r) => (r.record.type === 'post' ? [r.record.text] : []));
    expect(posts).toEqual(['a attempt 1 [redacted]']);
    expect(types(records)).toContain('truncated');
  });

  it('runs a workflow with no board field as before: its steps still get a board, and the run is unchanged', async () => {
    const { engine } = await setup(() => 'ok');
    const result = await engine.run(parseWorkflow(WORKFLOW));
    expect(result.steps).toEqual({ a: 'COMPLETED', b: 'COMPLETED' });
  });
});
