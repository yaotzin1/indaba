import { type BoardRecord, BoardRecorded, RunResult, SimpleEventDispatcher, Tracer } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  GitWorktreeManager,
  GuardRegistry,
  parseWorkflow,
  StepExecutor,
  WorkflowEngine,
  WorkflowStatus,
} from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, makeGitRepo, SequenceIds } from './support.js';

// AC-24: a retry's prompt holds the last failure and nothing the board kept from the attempt that failed.
const WORKFLOW = `
version: "1.0"
name: isolation
roles:
  worker: {runner: work}
steps:
  - id: a
    role: worker
    goal: GOAL-A
    board: {post: [note]}
  - id: b
    role: worker
    goal: GOAL-B
    depends_on: [a]
    board: {read: {}, post: [note]}
    on_failure: {action: retry_step, target: a, max_retries: 1}
  - id: c
    role: worker
    goal: GOAL-C
    depends_on: [b]
    board: {read: {}}
`;

async function run() {
  const repo = await makeGitRepo();
  const events = new SimpleEventDispatcher();
  const records: BoardRecord[] = [];
  events.addListener(BoardRecorded, (e) => {
    records.push(e.record);
  });
  const counts = new Map<string, number>();
  const runner = new FakeRunner('work', (request) => {
    const id = /GOAL-([ABC])/.exec(request.prompt)?.[1]?.toLowerCase() ?? '?';
    const n = (counts.get(id) ?? 0) + 1;
    counts.set(id, n);
    if (id === 'b' && n === 1) {
      return new RunResult({ exitCode: 1, output: 'the build broke' });
    }
    return new RunResult({ exitCode: 0, output: `BOARD note: ${id}-try-${n}` });
  });
  const ids = new SequenceIds();
  const tracer = new Tracer(new FixedClock(), events, ids);
  const engine = new WorkflowEngine({
    executor: new StepExecutor({
      runners: new FakeRegistry([runner]),
      guards: GuardRegistry.withDefaults(),
      tracer,
    }),
    tracer,
    events,
    workspaces: new GitWorktreeManager(repo),
    projectDir: repo,
    ids,
  });
  const result = await engine.run(parseWorkflow(WORKFLOW));
  const prompt = (id: string, nth: number) =>
    runner.requests.filter((r) => r.prompt.includes(`GOAL-${id.toUpperCase()}`))[nth - 1]?.prompt ?? '';
  return { result, prompt, records };
}

describe('retry isolation on the board (AC-24)', () => {
  it('gives the retried step the last failure and no entry of the failed attempt', async () => {
    const { result, prompt } = await run();
    expect(result.status).toBe(WorkflowStatus.Completed);
    const second = prompt('a', 2);
    expect(second).toContain('The previous attempt failed');
    expect(second).toContain('the build broke');
    expect(second).not.toContain('a-try-1');
    expect(second).not.toContain('b-try-1');
    expect(second).not.toContain('The board');
  });

  it('keeps the first attempt’s entries out of every later digest', async () => {
    const { prompt } = await run();
    // b's second attempt reads a's second note, not the superseded first
    expect(prompt('b', 2)).toContain('a-try-2');
    expect(prompt('b', 2)).not.toContain('a-try-1');
    expect(prompt('b', 2)).not.toContain('b-try-1');
    // c reads only what was accepted: a's and b's second attempts
    const c = prompt('c', 1);
    expect(c).toContain('a-try-2');
    expect(c).toContain('b-try-2');
    for (const gone of ['a-try-1', 'b-try-1']) {
      expect(c).not.toContain(gone);
    }
  });

  it('marks the failed attempt’s entries superseded or discarded and leaves them so when the step runs again', async () => {
    const { records } = await run();
    const posts = records.filter((r) => r.type === 'post');
    const first = posts.find((p) => p.text === 'a-try-1');
    expect(first).toBeDefined();
    const settles = records.filter((r) => r.type === 'settle' && r.stepId === 'a' && r.attempt === 1);
    // exactly accepted, then superseded; the second attempt's settlement never touches attempt 1
    expect(settles.map((s) => s.type === 'settle' && s.outcome)).toEqual(['accepted', 'superseded']);
    expect(posts.some((p) => p.text === 'b-try-1')).toBe(false); // a failed reply is never scanned
  });
});
