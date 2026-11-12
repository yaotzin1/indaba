import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  RunResult,
  SimpleEventDispatcher,
  SpanEnded,
  StepStatus,
  StepStatusChanged,
  Tracer,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { hasConflictMarkers, metStep, pathsOfDiff, resolutionGoal } from '../src/engine/resolution.js';
import {
  Git,
  GitWorktreeManager,
  GuardRegistry,
  parseWorkflow,
  StepExecutor,
  WorkflowEngine,
  WorkflowStatus,
} from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, makeGitRepo, SequenceIds } from './support.js';

// specs/parallel-steps, T-14: a landing that conflicts is resolved by the step's agent in the landing worktree, checked by the
// guards, examined by the agent of the step it met, and then lands. Real git, fake runners.

const HEAD =
  'version: "1.0"\nname: t\nroles:\n  x: {runner: work}\n  y: {runner: work}\nartifacts:\n  patch: out/run.patch\n';
const steps = (...lines: string[]): string =>
  `${HEAD}steps:\n${lines.map((line) => `  - ${line}`).join('\n')}\n`;
const step = (id: string, role: string, extra = ''): string =>
  `{id: ${id}, role: ${role}, isolation: git_worktree, goal: GOAL-${id}${extra}}`;

const ok = (output = 'done'): RunResult => new RunResult({ exitCode: 0, output });
const idOf = (prompt: string): string => prompt.match(/GOAL-([a-z]+)/)?.[1] ?? '?';

async function put(workdir: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(workdir, path)), { recursive: true });
  await writeFile(join(workdir, path), text);
}

async function worktrees(repo: string): Promise<number> {
  const out = await new Git().run(['worktree', 'list', '--porcelain'], repo);
  return out.split('\n').filter((line) => line.startsWith('worktree ')).length;
}

interface Setup {
  /** What the resolution call does in the landing worktree. Default: writes the combined file. */
  readonly resolve?: (workdir: string, prompt: string) => Promise<RunResult>;
  /** What each turn of the examining debate says. Default: agreement. */
  readonly debate?: (turn: number) => string;
  readonly signal?: AbortSignal;
}

async function build(setup: Setup = {}) {
  const repo = await makeGitRepo();
  const events = new SimpleEventDispatcher();
  const transitions: string[] = [];
  const waiters = new Map<string, Array<() => void>>();
  events.addListener(StepStatusChanged, (event) => {
    transitions.push(`${event.stepId}:${event.to}`);
    for (const wake of waiters.get(`${event.stepId}:${event.to}`) ?? []) {
      wake();
    }
  });
  const outcomes: { readonly how: unknown; readonly met: unknown; readonly files: unknown }[] = [];
  events.addListener(SpanEnded, (event) => {
    if (event.span.name === 'indaba.resolution') {
      const a = event.span.attributes;
      outcomes.push({
        how: a['indaba.resolution.outcome'],
        met: a['indaba.resolution.met_step'],
        files: a['indaba.resolution.files'],
      });
    }
  });
  const reached = (id: string, to: StepStatus): Promise<void> =>
    transitions.includes(`${id}:${to}`)
      ? Promise.resolve()
      : new Promise((resolve) => {
          waiters.set(`${id}:${to}`, [...(waiters.get(`${id}:${to}`) ?? []), resolve]);
        });
  const resolutionPrompts: string[] = [];
  const debatePrompts: string[] = [];
  let turn = 0;
  const work = new FakeRunner('work', async (request) => {
    if (request.prompt.includes('Before you start')) {
      return ok();
    }
    if (request.prompt.includes('conflicts with a change that landed before it')) {
      resolutionPrompts.push(request.prompt);
      return await (setup.resolve ?? combine)(request.workdir, request.prompt);
    }
    if (request.prompt.includes('Examine it')) {
      debatePrompts.push(request.prompt);
      turn += 1;
      return ok((setup.debate ?? agree)(turn));
    }
    const id = idOf(request.prompt);
    if (id === 'b') {
      await reached('a', StepStatus.Completed);
    }
    await put(request.workdir, join('src', 'app.txt'), `${id.toUpperCase()}\n`);
    return ok();
  });
  const shell = new FakeRunner('shell', async (request) => {
    const id = request.prompt.includes('write-b') ? 'b' : 'a';
    if (id === 'b') {
      await reached('a', StepStatus.Completed);
    }
    await put(request.workdir, join('src', 'app.txt'), `${id.toUpperCase()}\n`);
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
  });
  const run = (workflow: string) =>
    engine.run(parseWorkflow(workflow), {
      taskId: 'T14',
      ...(setup.signal !== undefined ? { signal: setup.signal } : {}),
    });
  const patch = async (): Promise<string> => {
    try {
      return await readFile(join(repo, 'out', 'run.patch'), 'utf8');
    } catch {
      return '';
    }
  };
  return { repo, run, patch, transitions, outcomes, resolutionPrompts, debatePrompts };
}

async function combine(workdir: string): Promise<RunResult> {
  await put(workdir, join('src', 'app.txt'), 'A+B\n');
  return ok();
}

const agree = (): string => 'AGREEMENT: the combined change keeps both';

describe('a conflicting landing is resolved (AC-24, AC-25)', () => {
  it('lands the combined change when the guards pass and the other step accepts', async () => {
    const t = await build();
    const result = await t.run(steps(step('a', 'x'), step('b', 'y')));

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(result.steps).toEqual({ a: StepStatus.Completed, b: StepStatus.Completed });
    const patch = await t.patch();
    expect(patch).toContain('+A+B');
    expect(t.outcomes).toEqual([{ how: 'resolved', met: 'a', files: 1 }]);
    expect(await worktrees(t.repo)).toBe(1);
  });

  it('shows the agent its goal, the conflict and the step it met, every foreign line fenced', async () => {
    const t = await build();
    await t.run(steps(step('a', 'x'), step('b', 'y')));

    const prompt = t.resolutionPrompts[0] ?? '';
    expect(prompt).toContain('GOAL-b');
    expect(prompt).toContain('src/app.txt');
    expect(prompt).toMatch(/^\| ours \(landed before\):$/m);
    expect(prompt).toMatch(/^\| theirs \(yours\):$/m);
    expect(prompt).toContain('The step whose change yours met: a');
    expect(prompt).toMatch(/^\| goal: GOAL-a$/m);
    expect(t.debatePrompts.length).toBeGreaterThan(0);
    expect(t.debatePrompts[0]).toMatch(/^\| \+A\+B$/m);
  });

  it('does not count against max_retries', async () => {
    const t = await build();
    const result = await t.run(
      steps(step('a', 'x'), step('b', 'y', ', on_failure: {action: retry_step, target: b, max_retries: 1}')),
    );

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(t.transitions.filter((entry) => entry === 'b:RUNNING')).toHaveLength(1);
  });

  it('fails the step, applying none of it, when the agent leaves a conflict marker', async () => {
    const t = await build({
      resolve: async (workdir) => {
        const left = ['<'.repeat(7), ' mine', '='.repeat(7), 'theirs', '>'.repeat(7)].join('\n');
        await put(workdir, join('src', 'app.txt'), `${left}\n`);
        return ok();
      },
    });
    const result = await t.run(steps(step('a', 'x'), step('b', 'y')));

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.steps).toEqual({ a: StepStatus.Completed, b: StepStatus.Failed });
    expect(result.failureReason).toContain('left conflict markers in src/app.txt');
    const patch = await t.patch();
    expect(patch).toContain('+A');
    expect(patch).not.toContain('+B');
    expect(t.outcomes[0]?.how).toBe('markers_left');
    expect(await worktrees(t.repo)).toBe(1);
  });

  it('fails the step when the resolution breaks a guard of the step', async () => {
    const t = await build({
      resolve: async (workdir) => {
        await put(workdir, join('src', 'app.txt'), 'A+B\n');
        await put(workdir, join('docs', 'extra.txt'), 'more\n');
        return ok();
      },
    });
    const result = await t.run(
      steps(step('a', 'x'), step('b', 'y', ', guards: [{type: git_diff_empty, paths: ["docs/"]}]')),
    );

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.failureReason).toContain('The resolution failed its check');
    expect(t.outcomes[0]?.how).toBe('guard_failed');
    expect(await t.patch()).not.toContain('+A+B');
    expect(await worktrees(t.repo)).toBe(1);
  });

  it('cannot resolve for a step with no agent, and says so', async () => {
    const t = await build();
    const shellStep = (id: string, touches: string): string =>
      `{id: ${id}, runner: shell, isolation: git_worktree, commands: ["write-${id}"], touches: ["${touches}"]}`;
    const result = await t.run(steps(shellStep('a', 'src/a.txt'), shellStep('b', 'src/b.txt')));

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.failureReason).toContain('The step has no agent to resolve the conflict');
    expect(t.resolutionPrompts).toEqual([]);
    expect(t.outcomes).toEqual([]);
    expect(await worktrees(t.repo)).toBe(1);
  });

  it('fails the step when the resolution call itself fails', async () => {
    const t = await build({ resolve: async () => new RunResult({ exitCode: 3, output: 'boom' }) });
    const result = await t.run(steps(step('a', 'x'), step('b', 'y')));

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.failureReason).toContain('The resolution failed');
    expect(t.outcomes[0]?.how).toBe('agent_failed');
    expect(await worktrees(t.repo)).toBe(1);
  });

  it('fails the step when the agent of the step it met does not accept, and applies none of it', async () => {
    const t = await build({ debate: () => 'CRITIQUE: this drops what a wrote' });
    const result = await t.run(steps(step('a', 'x'), step('b', 'y')));

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.failureReason).toContain('did not accept the resolution');
    expect(t.outcomes[0]?.how).toBe('rejected');
    expect(await t.patch()).not.toContain('+A+B');
    expect(await worktrees(t.repo)).toBe(1);
  });

  it('removes the landing worktree when the run is cancelled during the resolution', async () => {
    const stop = new AbortController();
    const t = await build({
      signal: stop.signal,
      resolve: async (workdir) => {
        stop.abort();
        await put(workdir, join('src', 'app.txt'), 'A+B\n');
        return new RunResult({ exitCode: 130, output: 'aborted' });
      },
    });
    const result = await t.run(steps(step('a', 'x'), step('b', 'y')));

    expect(result.status).toBe(WorkflowStatus.Cancelled);
    expect(await worktrees(t.repo)).toBe(1);
  });
});

describe('what the resolution works from', () => {
  const diff = [
    'diff --git a/src/app.txt b/src/app.txt',
    '--- a/src/app.txt',
    '+++ b/src/app.txt',
    'diff --git a/old.txt b/new.txt',
    'rename from old.txt',
    'diff --git a/"odd name" b/"odd name"',
    'diff --git a/../escape b/../escape',
  ].join('\n');

  it('reads the paths a diff changes, both sides of a rename, and skips quoted and escaping names', () => {
    expect(pathsOfDiff(diff)).toEqual(['src/app.txt', 'new.txt', 'old.txt']);
    expect(pathsOfDiff('')).toEqual([]);
  });

  it('names the step that landed last among those that touched a path, never the step itself', () => {
    const landed = [
      { stepId: 'a', paths: ['x', 'y'] },
      { stepId: 'b', paths: ['y'] },
      { stepId: 'c', paths: ['z'] },
    ];
    expect(metStep(landed, ['y'], 'c')).toBe('b');
    expect(metStep(landed, ['x'], 'c')).toBe('a');
    expect(metStep(landed, ['y'], 'b')).toBe('a');
    expect(metStep(landed, ['q'], 'c')).toBeUndefined();
  });

  it('finds the start or the end of a conflict at the start of a line, and nothing in prose or a heading', () => {
    expect(hasConflictMarkers(`ok\n${'<'.repeat(7)} HEAD\nx`)).toBe(true);
    expect(hasConflictMarkers(`x\n${'>'.repeat(7)} theirs\n`)).toBe(true);
    expect(hasConflictMarkers(`Title\n${'='.repeat(7)}\ntext`)).toBe(false);
    expect(hasConflictMarkers(`a ${'<'.repeat(7)} b`)).toBe(false);
  });

  it('puts the step it met in the goal only when one is known', () => {
    const base = { step: { goal: 'GOAL' } as never, hunks: [{ path: 'p', ours: 'o', theirs: 't' }] };
    expect(resolutionGoal({ ...base, met: undefined })).not.toContain('The step whose change yours met');
    const withMet = resolutionGoal({
      ...base,
      met: { id: 'a', goal: 'G', intent: 'paths p', contract: 'a: p' },
    });
    expect(withMet).toContain('| it said it would change: paths p');
    expect(withMet).toContain('| its contract:');
  });
});
