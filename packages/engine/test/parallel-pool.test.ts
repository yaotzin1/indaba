import { RunResult, SimpleEventDispatcher, type Span, SpanEnded, Tracer } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  GitWorktreeManager,
  GuardRegistry,
  type ParallelSource,
  parseWorkflow,
  StepExecutor,
  WorkflowEngine,
  WorkflowStatus,
} from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, makeGitRepo, SequenceIds } from './support.js';

// specs/parallel-steps, slice 1 (T-05): the run loop goes through a pool, admission decides what starts, and with the cap at
// one step the run is what it was: same order, same states, one step at a time.

const HEAD = 'version: "1.0"\nname: t\nroles:\n  w: {runner: work}\n';
const THREE = `${HEAD}steps:\n  - {id: a, role: w, goal: GOAL-a}\n  - {id: b, role: w, goal: GOAL-b}\n  - {id: c, role: w, goal: GOAL-c, depends_on: [a, b]}\n`;

interface Setup {
  readonly maxParallelSteps?: number;
  readonly maxParallelSource?: Exclude<ParallelSource, 'workflow'>;
  readonly onStepOutput?: (id: string, chunk: string) => void;
  readonly onOutput?: (chunk: string) => void;
  readonly signal?: AbortSignal;
  readonly handler?: (goal: string, calls: number) => RunResult | Promise<RunResult>;
}

async function run(workflow: string, setup: Setup = {}) {
  const repo = await makeGitRepo();
  const events = new SimpleEventDispatcher();
  const spans: Span[] = [];
  events.addListener(SpanEnded, (e) => {
    spans.push(e.span);
  });
  let inFlight = 0;
  let maxInFlight = 0;
  const order: string[] = [];
  const work = new FakeRunner('work', async (request, calls) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    order.push(request.prompt.match(/step ([a-z]+)/)?.[1] ?? request.prompt.slice(0, 10));
    request.onOutput?.(`out-${calls}`);
    await Promise.resolve();
    inFlight -= 1;
    return setup.handler?.(request.prompt, calls) ?? new RunResult({ exitCode: 0, output: 'done' });
  });
  const ids = new SequenceIds();
  const tracer = new Tracer(new FixedClock(), events, ids);
  const engine = new WorkflowEngine({
    executor: new StepExecutor({
      runners: new FakeRegistry([work]),
      guards: GuardRegistry.withDefaults(),
      tracer,
      events,
    }),
    tracer,
    events,
    workspaces: new GitWorktreeManager(repo),
    projectDir: repo,
    ids,
    ...(setup.maxParallelSteps !== undefined ? { maxParallelSteps: setup.maxParallelSteps } : {}),
    ...(setup.maxParallelSource !== undefined ? { maxParallelSource: setup.maxParallelSource } : {}),
  });
  const result = await engine.run(parseWorkflow(workflow), {
    ...(setup.onStepOutput !== undefined ? { onStepOutput: setup.onStepOutput } : {}),
    ...(setup.onOutput !== undefined ? { onOutput: setup.onOutput } : {}),
    ...(setup.signal !== undefined ? { signal: setup.signal } : {}),
  });
  const root = spans.find((span) => span.name.startsWith('indaba.task'));
  return { result, root, spans, maxInFlight: () => maxInFlight, order, work };
}

describe('the limit on the root span (AC-31)', () => {
  it('records 1 and "default" when nothing asks for more', async () => {
    const { root } = await run(THREE);
    expect(root?.attributes['indaba.workflow.max_parallel']).toBe(1);
    expect(root?.attributes['indaba.workflow.max_parallel.source']).toBe('default');
  });

  it('records where a limit came from', async () => {
    for (const source of ['flag', 'env', 'config'] as const) {
      const { root } = await run(THREE, { maxParallelSteps: 1, maxParallelSource: source });
      expect(root?.attributes['indaba.workflow.max_parallel.source']).toBe(source);
    }
  });

  it('records the limit that runs: the limit asked, with no cap', async () => {
    const { root } = await run(THREE, { maxParallelSteps: 3, maxParallelSource: 'flag' });
    expect(root?.attributes['indaba.workflow.max_parallel']).toBe(3);
    expect(root?.attributes['indaba.workflow.max_parallel.source']).toBe('flag');
  });

  it('says "workflow" when max_parallel lowered the limit, and never raises it (AC-03)', async () => {
    const lowered = await run(THREE.replace('name: t\n', 'name: t\nmax_parallel: 2\n'), {
      maxParallelSteps: 4,
      maxParallelSource: 'env',
    });
    expect(lowered.root?.attributes['indaba.workflow.max_parallel.source']).toBe('workflow');

    const notRaised = await run(THREE.replace('name: t\n', 'name: t\nmax_parallel: 5\n'), {
      maxParallelSteps: 2,
      maxParallelSource: 'config',
    });
    expect(notRaised.root?.attributes['indaba.workflow.max_parallel.source']).toBe('config');
  });
});

describe('a run through the pool with the cap at one step', () => {
  it('runs the steps in order, one at a time, at a limit of 1', async () => {
    const { result, maxInFlight, work } = await run(THREE);
    expect(result.status).toBe(WorkflowStatus.Completed);
    expect(result.steps).toEqual({ a: 'COMPLETED', b: 'COMPLETED', c: 'COMPLETED' });
    expect(maxInFlight()).toBe(1);
    expect(work.requests).toHaveLength(3);
  });

  it('runs one at a time at a limit of 3 too, as the cap says', async () => {
    const { result, maxInFlight, work } = await run(THREE, {
      maxParallelSteps: 3,
      maxParallelSource: 'flag',
    });
    expect(result.status).toBe(WorkflowStatus.Completed);
    expect(maxInFlight()).toBe(1);
    expect(work.requests).toHaveLength(3);
  });

  it('runs the steps in declaration order, a step after the steps it depends on', async () => {
    const { work } = await run(THREE, { maxParallelSteps: 3 });
    expect(work.requests.map((r) => r.prompt.match(/GOAL-[abc]/)?.[0])).toEqual([
      'GOAL-a',
      'GOAL-b',
      'GOAL-c',
    ]);
  });

  it('halts at the first failure that is not retried, and starts nothing after it (AC-27)', async () => {
    const { result, work } = await run(THREE, {
      handler: (_goal, calls) =>
        calls === 1
          ? new RunResult({ exitCode: 1, output: '', errorOutput: 'broke' })
          : new RunResult({ exitCode: 0, output: 'ok' }),
    });
    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.steps.a).toBe('FAILED');
    expect(result.steps.b).toBe('PENDING');
    expect(result.steps.c).toBe('PENDING');
    expect(work.requests).toHaveLength(1);
  });

  it('retries the target and its descendants and not a step that does not depend on it', async () => {
    const workflow = `${HEAD}steps:
  - {id: a, role: w, goal: g}
  - {id: b, role: w, goal: g}
  - {id: c, role: w, goal: g, depends_on: [a], on_failure: {action: retry_step, target: a, max_retries: 1}}
`;
    const { result, work } = await run(workflow, {
      handler: (_goal, calls) =>
        calls === 3
          ? new RunResult({ exitCode: 1, output: '', errorOutput: 'c broke' })
          : new RunResult({ exitCode: 0, output: 'ok' }),
    });
    // a, b, c(fails), then a again and c again; b is not a descendant of a and does not run again.
    expect(work.requests).toHaveLength(5);
    expect(result.status).toBe(WorkflowStatus.Completed);
    expect(result.steps).toEqual({ a: 'COMPLETED', b: 'COMPLETED', c: 'COMPLETED' });
  });

  it('is cancelled before any step starts when the run is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { result, work } = await run(THREE, { signal: controller.signal });
    expect(result.status).toBe(WorkflowStatus.Cancelled);
    expect(result.failureReason).toBe('The run was cancelled.');
    expect(work.requests).toHaveLength(0);
  });
});

describe('live output of the steps', () => {
  it('forwards each chunk with the id of its step, and still to onOutput', async () => {
    const perStep: [string, string][] = [];
    const plain: string[] = [];
    await run(THREE, {
      onStepOutput: (id, chunk) => perStep.push([id, chunk]),
      onOutput: (chunk) => plain.push(chunk),
    });
    expect(perStep.map(([id]) => id)).toEqual(['a', 'b', 'c']);
    expect(plain).toEqual(perStep.map(([, chunk]) => chunk));
  });

  it('tells onOutput alone to the old consumer, unchanged', async () => {
    const plain: string[] = [];
    await run(THREE, { onOutput: (chunk) => plain.push(chunk) });
    expect(plain).toHaveLength(3);
  });
});
