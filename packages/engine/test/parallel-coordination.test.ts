import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  BoardRecorded,
  type NegotiationDecider,
  RunResult,
  SimpleEventDispatcher,
  SpanEnded,
  StepStatus,
  StepStatusChanged,
  Tracer,
} from '@indaba/core';
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

// specs/parallel-steps, slice 3 (T-12): the intent call, the check against steps already working, the negotiation of steps
// admitted together, and what the decider says when they cannot agree.

const HEAD = 'version: "1.0"\nname: t\nroles:\n  w: {runner: work}\n';
const wf = (...lines: string[]): string =>
  `${HEAD}steps:\n${lines.map((line) => `  - ${line}`).join('\n')}\n`;
const step = (id: string, extra = ''): string =>
  `{id: ${id}, role: w, isolation: git_worktree, goal: GOAL-${id}${extra}}`;
const idOf = (prompt: string): string => prompt.match(/GOAL-([a-z]+)/)?.[1] ?? '?';
const ok = (output = 'done'): RunResult => new RunResult({ exitCode: 0, output });

/** A `work` hook that holds each step until `count` steps are working, so that overlapping can be seen. */
function together(count: number): NonNullable<Setup['work']> {
  let arrived = 0;
  let release: () => void = () => undefined;
  const all = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived >= count) {
      release();
    }
    await all;
    return undefined;
  };
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

interface Posted {
  readonly kind: string;
  readonly stepId: string;
  readonly text: string;
  readonly state?: string;
}

interface Setup {
  /** What each step answers to its intent call, by step id; a missing one answers with no line. */
  readonly intents?: Readonly<Record<string, string | RunResult>>;
  /** The reply of the negotiation's n-th turn (1-based). Default: a valid proposal, then agreement. */
  readonly negotiation?: (turn: number) => string;
  /** What a step does as work. */
  readonly work?: (id: string, workdir: string, prompt: string) => Promise<RunResult | undefined>;
  readonly decider?: NegotiationDecider;
  readonly maxWaits?: number;
  /** Holds each shell command until this many are running, so that overlapping can be seen. */
  readonly holdShell?: number;
}

const AGREE = (turn: number): string =>
  turn === 1 ? 'PROPOSAL: SPLIT a: src/a/\nSPLIT b: src/b/\nINTERFACE api: a function' : 'AGREEMENT: ok';

async function build(setup: Setup = {}) {
  const repo = await makeGitRepo();
  const events = new SimpleEventDispatcher();
  const posts: Posted[] = [];
  events.addListener(BoardRecorded, (event) => {
    const record = event.record;
    if (record.type === 'post') {
      posts.push({ kind: record.kind, stepId: record.stepId, text: record.text });
    }
  });
  /** The `indaba.step.wait` spans that ended, with what they said (AC-30): the step, the step it waited for, how often. */
  const waitSpans: { readonly step: unknown; readonly blocker: unknown; readonly count: unknown }[] = [];
  events.addListener(SpanEnded, (event) => {
    if (event.span.name === 'indaba.step.wait') {
      const a = event.span.attributes;
      waitSpans.push({
        step: a['indaba.step.id'],
        blocker: a['indaba.wait.blocker'],
        count: a['indaba.wait.count'],
      });
    }
  });
  const completed: string[] = [];
  const started: string[] = [];
  events.addListener(StepStatusChanged, (event) => {
    if (event.to === StepStatus.Completed) {
      completed.push(event.stepId);
    }
    if (event.to === StepStatus.Running) {
      started.push(event.stepId);
    }
  });
  const intentCalls: string[] = [];
  const workPrompts = new Map<string, string>();
  let turn = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const work = new FakeRunner('work', async (request) => {
    const id = idOf(request.prompt);
    if (request.prompt.includes('Before you start')) {
      intentCalls.push(id);
      const answer = setup.intents?.[id] ?? '';
      return typeof answer === 'string' ? ok(answer) : answer;
    }
    if (request.prompt.includes('SPLIT <step id>')) {
      turn += 1;
      return ok((setup.negotiation ?? AGREE)(turn));
    }
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    workPrompts.set(id, request.prompt);
    try {
      const custom = await setup.work?.(id, request.workdir, request.prompt);
      if (custom !== undefined) {
        return custom;
      }
      await mkdir(dirname(join(request.workdir, 'out', `${id}.txt`)), { recursive: true });
      await writeFile(join(request.workdir, 'out', `${id}.txt`), `${id}\n`);
      return ok();
    } finally {
      inFlight -= 1;
    }
  });
  const holdShell = setup.holdShell === undefined ? undefined : together(setup.holdShell);
  const shell = new FakeRunner('shell', async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await holdShell?.('', '', '');
    inFlight -= 1;
    return ok();
  });
  const ids = new SequenceIds();
  const tracer = new Tracer(new FixedClock(), events, ids);
  const engine = new WorkflowEngine({
    executor: new StepExecutor({
      runners: new FakeRegistry([work, shell]),
      guards: GuardRegistry.withDefaults(),
      tracer,
      events,
    }),
    tracer,
    events,
    workspaces: new GitWorktreeManager(repo),
    projectDir: repo,
    ids,
    maxParallelSteps: 3,
    maxParallelCap: 8,
    ...(setup.maxWaits !== undefined ? { maxWaits: setup.maxWaits } : {}),
    ...(setup.decider !== undefined ? { negotiationDecider: setup.decider } : {}),
  });
  const run = (workflow: string) => engine.run(parseWorkflow(workflow), { taskId: 'T12' });
  return {
    run,
    posts,
    waitSpans,
    completed,
    started,
    intentCalls,
    workPrompts,
    maxInFlight: () => maxInFlight,
    work,
    shell,
    ofKind: (kind: string) => posts.filter((p) => p.kind === kind),
  };
}

describe('the intent call (AC-09, AC-11)', () => {
  it('asks each step in a worktree once, and posts what it said as an intent on the board', async () => {
    const t = await build({
      intents: { a: 'INTENT src/a/\nPROVIDES api: a function', b: 'INTENT src/b/' },
      work: together(2),
    });
    const result = await t.run(wf(step('a'), step('b')));
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(t.intentCalls.sort()).toEqual(['a', 'b']);
    const intents = t.ofKind('intent');
    expect(intents.map((p) => p.stepId).sort()).toEqual(['a', 'b']);
    expect(intents.find((p) => p.stepId === 'a')?.text).toBe('paths src/a/; provides api (a function)');
    // Intents that do not meet: no negotiation, no contract, both work at the same time.
    expect(t.ofKind('contract')).toHaveLength(0);
    expect(t.maxInFlight()).toBe(2);
  });

  it('lets a step that intends nothing, or answers nothing usable, go on', async () => {
    const t = await build({ intents: { a: 'I will think about it first.', b: '' } });
    const result = await t.run(wf(step('a'), step('b')));
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(t.ofKind('intent').map((p) => p.text)).toEqual(['intends nothing', 'intends nothing']);
  });

  it('fails the step when the call fails, and the step policy applies', async () => {
    const t = await build({
      intents: { a: new RunResult({ exitCode: 1, output: '', errorOutput: 'no model' }) },
    });
    const result = await t.run(wf(step('a'), step('b')));
    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.steps.a).toBe(StepStatus.Failed);
    expect(result.failureReason).toContain('intent call');
  });

  it('uses the paths a shell step declares, and asks no one', async () => {
    const t = await build({ holdShell: 2 });
    const shellStep = (id: string, touches: string): string =>
      `{id: ${id}, runner: shell, isolation: git_worktree, commands: ["true"], touches: ["${touches}"]}`;
    const result = await t.run(wf(shellStep('a', 'src/a.txt'), shellStep('b', 'src/b.txt')));
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(t.intentCalls).toEqual([]);
    expect(t.ofKind('intent').map((p) => p.text)).toEqual(['paths src/a.txt', 'paths src/b.txt']);
    expect(t.maxInFlight()).toBe(2);
  });

  it('asks nothing when the limit is 1', async () => {
    const repo = await makeGitRepo();
    const events = new SimpleEventDispatcher();
    const tracer = new Tracer(new FixedClock(), events, new SequenceIds());
    const work = new FakeRunner('work', async () => ok());
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
      ids: new SequenceIds(),
    });
    const result = await engine.run(parseWorkflow(wf(step('a'), step('b'))), { taskId: 'T12-one' });
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(work.requests.filter((r) => r.prompt.includes('Before you start'))).toHaveLength(0);
  });
});

describe('a step that meets a step already working waits for it (AC-13)', () => {
  it('is put back, frees its slot, and says its intent again once the other has landed', async () => {
    const release = deferred();
    const seen: string[] = [];
    const t = await build({
      intents: { a: 'INTENT src/', b: 'INTENT src/x.ts', c: 'INTENT docs/' },
      work: async (id) => {
        if (id === 'a') {
          await release.promise;
        }
        seen.push(id);
        return undefined;
      },
    });
    const running = t.run(wf(step('a'), step('c'), step('b', ', depends_on: [c]')));
    // b is admitted when c has landed, meets a (still working), and is put back: a second intent call comes after a lands.
    const waitForTwoCalls = async (): Promise<void> => {
      for (let i = 0; i < 400 && t.intentCalls.filter((id) => id === 'b').length < 1; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      release.resolve();
    };
    await waitForTwoCalls();
    const result = await running;

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(t.intentCalls.filter((id) => id === 'b')).toHaveLength(2);
    expect(t.completed.indexOf('a')).toBeLessThan(t.completed.indexOf('b'));
    expect(seen).toEqual(['c', 'a', 'b']);
    // The earlier declaration of b is replaced, not added to (AC-11): both were posted, the first is superseded.
    expect(t.ofKind('intent').filter((p) => p.stepId === 'b')).toHaveLength(2);
    // The wait is in the trace for a view to show: one span, naming the step it waited for, ended once b was admitted.
    expect(t.waitSpans).toEqual([{ step: 'b', blocker: 'a', count: 1 }]);
  });

  it('records no wait span for a step that was never put back', async () => {
    const t = await build({ intents: { a: 'INTENT src/a/', b: 'INTENT docs/' } });
    const result = await t.run(wf(step('a'), step('b')));
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(t.waitSpans).toEqual([]);
  });

  it('is admitted alone once it was put back max_waits times', async () => {
    const releaseA = deferred();
    const releaseD = deferred();
    const order: string[] = [];
    const t = await build({
      maxWaits: 1,
      intents: { a: 'INTENT src/', d: 'INTENT lib/', c: 'INTENT docs/', b: 'INTENT src/x.ts' },
      work: async (id) => {
        if (id === 'a') {
          await releaseA.promise;
        }
        if (id === 'd') {
          await releaseD.promise;
        }
        order.push(id);
        return undefined;
      },
    });
    const running = t.run(wf(step('a'), step('d'), step('c'), step('b', ', depends_on: [c]')));
    // limit 3: a, d, c start; c lands; b meets a and is put back once (that is max_waits).
    for (let i = 0; i < 400 && !t.intentCalls.includes('b'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    releaseA.resolve();
    await new Promise((resolve) => setTimeout(resolve, 300));
    // a landed, but d still runs: b may not start beside it, it waits to be admitted alone.
    expect(order).not.toContain('b');
    releaseD.resolve();
    const result = await running;
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(order.indexOf('d')).toBeLessThan(order.indexOf('b'));
  });
});

describe('steps admitted together that meet negotiate (AC-14, AC-15)', () => {
  const overlapping = { a: 'INTENT src/', b: 'INTENT src/b/' };

  it('agree on a contract, post it, and carry it in each work prompt', async () => {
    const t = await build({ intents: overlapping, work: together(2) });
    const result = await t.run(wf(step('a'), step('b')));

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    const contract = t.ofKind('contract');
    expect(contract).toHaveLength(1);
    expect(contract[0]?.text).toContain('consensus: a: src/a/; b: src/b/');
    for (const id of ['a', 'b']) {
      const prompt = t.workPrompts.get(id) ?? '';
      expect(prompt).toContain('The split agreed with the steps that run beside yours');
      expect(prompt).toContain('a changes: src/a/');
      expect(prompt).toContain('interface api: a function');
    }
    // The negotiation is a debate of its own on the board, under an id that no step uses.
    expect(t.posts.some((p) => p.stepId === 'negotiate-a')).toBe(true);
    expect(t.maxInFlight()).toBe(2);
  });

  it('runs one after another, in order, when they cannot agree and nobody decides (AC-16, C-09)', async () => {
    const t = await build({
      intents: overlapping,
      negotiation: () => 'PROPOSAL: we should talk more',
    });
    const result = await t.run(wf(step('a'), step('b')));

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(t.maxInFlight()).toBe(1);
    expect(t.completed).toEqual(['a', 'b']);
    expect(t.ofKind('contract')).toHaveLength(0);
    expect(t.ofKind('decision').some((p) => p.text.includes('one after another: a, b (default)'))).toBe(true);
    // The step that went second saw the first one's change when its own call came (it declared again).
    expect(t.intentCalls.filter((id) => id === 'b')).toHaveLength(2);
  });

  it('follows the order the decider names', async () => {
    const decider: NegotiationDecider = { decide: async () => ({ order: ['b', 'a'] }) };
    const t = await build({ intents: overlapping, negotiation: () => 'PROPOSAL: no', decider });
    const result = await t.run(wf(step('a'), step('b')));
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(t.completed).toEqual(['b', 'a']);
    expect(t.ofKind('decision').some((p) => p.text.includes('b, a (decider)'))).toBe(true);
  });

  it('runs them one after another when the decider says so, or names an order that is not theirs', async () => {
    for (const answer of ['sequence', { order: ['a', 'z'] }] as const) {
      const decider: NegotiationDecider = { decide: async () => answer };
      const t = await build({ intents: overlapping, negotiation: () => 'PROPOSAL: no', decider });
      const result = await t.run(wf(step('a'), step('b')));
      expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
      expect(t.completed).toEqual(['a', 'b']);
    }
  });

  it('stops the run, escalated, when the decider says stop', async () => {
    const decider: NegotiationDecider = { decide: async () => 'stop' };
    const t = await build({ intents: overlapping, negotiation: () => 'PROPOSAL: no', decider });
    const result = await t.run(wf(step('a'), step('b')));
    expect(result.status).toBe(WorkflowStatus.Escalated);
    expect(result.failureReason).toContain('could not agree');
    expect(t.workPrompts.size).toBe(0);
  });

  it('falls back to one after another when the decider throws, as an extension that fails alone', async () => {
    const decider: NegotiationDecider = {
      decide: async () => {
        throw new Error('decider down');
      },
    };
    const t = await build({ intents: overlapping, negotiation: () => 'PROPOSAL: no', decider });
    const result = await t.run(wf(step('a'), step('b')));
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(t.completed).toEqual(['a', 'b']);
  });

  it('runs steps that meet but have nobody to talk, two shell steps, one after another', async () => {
    const t = await build();
    const shellStep = (id: string): string =>
      `{id: ${id}, runner: shell, isolation: git_worktree, commands: ["true"], touches: ["src/"]}`;
    const result = await t.run(wf(shellStep('a'), shellStep('b')));
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(t.maxInFlight()).toBe(1);
    expect(t.completed).toEqual(['a', 'b']);
  });

  it('takes a negotiation id no declared step uses', async () => {
    const t = await build({ intents: overlapping });
    const result = await t.run(
      wf(step('a'), step('b'), '{id: negotiate-a, runner: shell, commands: ["true"], depends_on: [b]}'),
    );
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(t.posts.some((p) => p.stepId === 'negotiate-a-2')).toBe(true);
  });
});
