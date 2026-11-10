import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  RunResult,
  SimpleEventDispatcher,
  StepStatus,
  StepStatusChanged,
  Tracer,
  WorkspaceError,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  type ForkableWorkspace,
  Git,
  GitWorktreeManager,
  GuardRegistry,
  isForkable,
  parseWorkflow,
  StepExecutor,
  WorkflowEngine,
  WorkflowStatus,
  type Workspace,
  type WorkspaceManager,
} from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, type Handler, makeGitRepo, SequenceIds } from './support.js';

// specs/parallel-steps, T-09: `runOne` forks a worktree for each step, lands its change under the landing lock and writes the
// patch after each landing. The release cap is lifted through `maxParallelCap`; the engine's other tests keep the cap at 1.

const HEAD = 'version: "1.0"\nname: t\nroles:\n  w: {runner: work}\nartifacts:\n  patch: out/run.patch\n';
const steps = (...lines: string[]): string =>
  `${HEAD}steps:\n${lines.map((line) => `  - ${line}`).join('\n')}\n`;
const step = (id: string, extra = ''): string =>
  `{id: ${id}, role: w, isolation: git_worktree, goal: GOAL-${id}${extra}}`;

const ok = (): RunResult => new RunResult({ exitCode: 0, output: 'done' });
const idOf = (prompt: string): string => prompt.match(/GOAL-([a-z]+)/)?.[1] ?? '?';

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function put(workdir: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(workdir, path)), { recursive: true });
  await writeFile(join(workdir, path), text);
}

async function worktrees(repo: string): Promise<number> {
  const out = await new Git().run(['worktree', 'list', '--porcelain'], repo);
  return out.split('\n').filter((line) => line.startsWith('worktree ')).length;
}

interface Setup {
  readonly limit?: number;
  readonly signal?: AbortSignal;
  readonly wrap?: (manager: WorkspaceManager) => WorkspaceManager;
}

async function build(handler: Handler, setup: Setup = {}) {
  const repo = await makeGitRepo();
  const events = new SimpleEventDispatcher();
  const completed: string[] = [];
  const waiters = new Map<string, Array<() => void>>();
  const transitions: string[] = [];
  events.addListener(StepStatusChanged, (event) => {
    transitions.push(`${event.stepId}:${event.to}`);
    if (event.to === StepStatus.Completed) {
      completed.push(event.stepId);
    }
    for (const wake of waiters.get(`${event.stepId}:${event.to}`) ?? []) {
      wake();
    }
  });
  /** Resolves once the step has moved to the status. */
  const reached = (id: string, to: StepStatus): Promise<void> =>
    transitions.includes(`${id}:${to}`)
      ? Promise.resolve()
      : new Promise((resolve) => {
          waiters.set(`${id}:${to}`, [...(waiters.get(`${id}:${to}`) ?? []), resolve]);
        });
  let inFlight = 0;
  let maxInFlight = 0;
  const workdirs = new Map<string, string>();
  const work = new FakeRunner('work', async (request, call, signal) => {
    // The intent call of a step (specs/parallel-steps, slice 3): these tests are about forks and landing, so no step intends anything.
    if (request.prompt.includes('Before you start')) {
      return ok();
    }
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    workdirs.set(idOf(request.prompt), request.workdir);
    try {
      return await handler(request, call, signal);
    } finally {
      inFlight -= 1;
    }
  });
  const ids = new SequenceIds();
  const tracer = new Tracer(new FixedClock(), events, ids);
  const manager = new GitWorktreeManager(repo);
  const engine = new WorkflowEngine({
    executor: new StepExecutor({
      runners: new FakeRegistry([work]),
      guards: GuardRegistry.withDefaults(),
      tracer,
      events,
    }),
    tracer,
    events,
    workspaces: setup.wrap === undefined ? manager : setup.wrap(manager),
    projectDir: repo,
    ids,
    maxParallelSteps: setup.limit ?? 3,
    maxParallelCap: 8,
  });
  const run = (workflow: string, taskId = 'T9') =>
    engine.run(parseWorkflow(workflow), {
      taskId,
      ...(setup.signal !== undefined ? { signal: setup.signal } : {}),
    });
  const patch = async (): Promise<string> => {
    try {
      return await readFile(join(repo, 'out', 'run.patch'), 'utf8');
    } catch {
      return '';
    }
  };
  return {
    repo,
    run,
    patch,
    reached,
    completed,
    transitions,
    maxInFlight: () => maxInFlight,
    workdirs,
    work,
  };
}

describe('steps in worktrees of their own', () => {
  it('runs independent steps at the same time, each in its own fork, and lands both', async () => {
    const both = deferred();
    let started = 0;
    const t = await build(async (request) => {
      started += 1;
      if (started === 2) {
        both.resolve();
      }
      await both.promise;
      await put(request.workdir, `${idOf(request.prompt)}.txt`, `${idOf(request.prompt)}\n`);
      return ok();
    });

    const result = await t.run(steps(step('a'), step('b')));

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(result.steps).toEqual({ a: StepStatus.Completed, b: StepStatus.Completed });
    expect(t.maxInFlight()).toBe(2);
    expect(new Set(t.workdirs.values()).size).toBe(2);
    const patch = await t.patch();
    expect(patch).toContain('a.txt');
    expect(patch).toContain('b.txt');
  });

  it('lands in the order the steps finish, not the order they started (AC-22)', async () => {
    const release = { a: deferred(), b: deferred(), c: deferred() };
    const t = await build(async (request) => {
      const id = idOf(request.prompt) as 'a' | 'b' | 'c';
      await put(request.workdir, `${id}.txt`, `${id}\n`);
      await release[id].promise;
      return ok();
    });

    const running = t.run(steps(step('a'), step('b'), step('c')));
    release.c.resolve();
    await t.reached('c', StepStatus.Completed);
    release.b.resolve();
    await t.reached('b', StepStatus.Completed);
    release.a.resolve();
    const result = await running;

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(t.completed).toEqual(['c', 'b', 'a']);
    const patch = await t.patch();
    for (const file of ['a.txt', 'b.txt', 'c.txt']) {
      expect(patch).toContain(file);
    }
  });

  it('starts a step that depends on others from the combined state, with their change in its fork', async () => {
    let seen = '';
    const t = await build(async (request) => {
      const id = idOf(request.prompt);
      if (id === 'c') {
        seen = `${await readFile(join(request.workdir, 'a.txt'), 'utf8')}${await readFile(join(request.workdir, 'b.txt'), 'utf8')}`;
      } else {
        await put(request.workdir, `${id}.txt`, `${id}\n`);
      }
      return ok();
    });

    const result = await t.run(steps(step('a'), step('b'), step('c', ', depends_on: [a, b]')));

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(seen).toBe('a\nb\n');
  });

  it('writes the patch after each landing, so it holds the first step while the second still works', async () => {
    const hold = deferred();
    let patchWhileSecondWorks = '';
    const t = await build(async (request) => {
      const id = idOf(request.prompt);
      await put(request.workdir, `${id}.txt`, `${id}\n`);
      if (id === 'b') {
        await t.reached('a', StepStatus.Completed);
        patchWhileSecondWorks = await t.patch();
        hold.resolve();
      }
      return ok();
    });

    const result = await t.run(steps(step('a'), step('b')));

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(patchWhileSecondWorks).toContain('a.txt');
    expect(patchWhileSecondWorks).not.toContain('b.txt');
    await hold.promise;
  });

  it('leaves no worktree behind but the project itself', async () => {
    const t = await build(async (request) => {
      await put(request.workdir, `${idOf(request.prompt)}.txt`, 'x\n');
      return ok();
    });
    const result = await t.run(steps(step('a'), step('b')));
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(await worktrees(t.repo)).toBe(1);
  });

  it('takes one step at a time in the run worktree when the limit is 1, as it always did', async () => {
    const t = await build(
      async (request) => {
        await put(request.workdir, `${idOf(request.prompt)}.txt`, 'x\n');
        return ok();
      },
      { limit: 1 },
    );
    const result = await t.run(steps(step('a'), step('b')));
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(t.maxInFlight()).toBe(1);
    expect(new Set(t.workdirs.values()).size).toBe(1);
  });
});

describe('a landing that conflicts', () => {
  it('fails the step with the files named, applies none of it and keeps what landed before', async () => {
    const t = await build(async (request) => {
      const id = idOf(request.prompt);
      if (id === 'b') {
        await t.reached('a', StepStatus.Completed);
      }
      await put(request.workdir, join('src', 'app.txt'), `${id.toUpperCase()}\n`);
      if (id === 'a') {
        await put(request.workdir, 'a-only.txt', 'a\n');
      }
      return ok();
    });
    // b forks while a still works, so both start from v1 and a lands first.
    const result = await t.run(steps(step('a'), step('b')));

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.steps).toEqual({ a: StepStatus.Completed, b: StepStatus.Failed });
    expect(result.failureReason).toContain('src/app.txt');
    expect(result.failureReason).toContain('Step "b"');
    const patch = await t.patch();
    expect(patch).toContain('+A');
    expect(patch).not.toContain('+B');
    expect(await worktrees(t.repo)).toBe(1);
  });

  it('is a failure the step policy applies to: the retry forks from the combined state and lands', async () => {
    const t = await build(async (request, call) => {
      const id = idOf(request.prompt);
      if (id === 'b' && call <= 2) {
        await t.reached('a', StepStatus.Completed);
      }
      const base = await readFile(join(request.workdir, 'src', 'app.txt'), 'utf8');
      await put(request.workdir, join('src', 'app.txt'), `${base}${id}\n`);
      return ok();
    });
    const result = await t.run(
      steps(step('a'), step('b', ', on_failure: {action: retry_step, target: b, max_retries: 1}')),
    );

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(result.steps).toEqual({ a: StepStatus.Completed, b: StepStatus.Completed });
    expect(await t.patch()).toMatch(/\+a\n\+b\n/);
  });
});

describe('failure, cancellation and retry among running steps', () => {
  it('does not land a step whose guard fails, and removes its worktree', async () => {
    const t = await build(async (request) => {
      const id = idOf(request.prompt);
      await put(request.workdir, id === 'a' ? join('src', 'a.txt') : 'b.txt', `${id}\n`);
      return ok();
    });
    const result = await t.run(
      steps(step('a', ', guards: [{type: git_diff_empty, paths: ["src/"]}]'), step('b')),
    );

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.steps).toEqual({ a: StepStatus.Failed, b: StepStatus.Completed });
    const patch = await t.patch();
    expect(patch).toContain('b.txt');
    expect(patch).not.toContain('a.txt');
    expect(await worktrees(t.repo)).toBe(1);
  });

  it('lets a running step finish and land after another failed for good (AC-27)', async () => {
    const t = await build(async (request) => {
      const id = idOf(request.prompt);
      if (id === 'a') {
        return new RunResult({ exitCode: 1, output: '', errorOutput: 'broken' });
      }
      await t.reached('a', StepStatus.Failed);
      await put(request.workdir, 'b.txt', 'b\n');
      return ok();
    });
    const result = await t.run(steps(step('a'), step('b'), step('c', ', depends_on: [a]')));

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.steps).toEqual({ a: StepStatus.Failed, b: StepStatus.Completed, c: StepStatus.Pending });
    expect(await t.patch()).toContain('b.txt');
    expect(await worktrees(t.repo)).toBe(1);
  });

  it('cancels every running step and removes every worktree (AC-29)', async () => {
    const controller = new AbortController();
    let started = 0;
    const hanging: Handler = (_request, _call, signal) =>
      new Promise<RunResult>((resolve) => {
        signal?.addEventListener('abort', () =>
          resolve(new RunResult({ exitCode: 130, output: '', errorOutput: 'Aborted.' })),
        );
        started += 1;
        if (started === 2) {
          controller.abort();
        }
      });
    const t = await build(hanging, { signal: controller.signal });

    const result = await t.run(steps(step('a'), step('b')));

    expect(result.status).toBe(WorkflowStatus.Cancelled);
    expect(started).toBe(2);
    expect(await t.patch()).toBe('');
    expect(await worktrees(t.repo)).toBe(1);
  });

  it('aborts a running step that a retry resets, sends it back to PENDING and runs it again (AC-28)', async () => {
    let xCalls = 0;
    let yCalls = 0;
    const t = await build(async (request, _call, signal) => {
      const id = idOf(request.prompt);
      if (id === 'x') {
        xCalls += 1;
        if (xCalls === 1) {
          // Hangs until the retry aborts it.
          await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
          return new RunResult({ exitCode: 130, output: '', errorOutput: 'Aborted.' });
        }
      }
      if (id === 'y') {
        yCalls += 1;
        if (yCalls === 1) {
          await t.reached('x', StepStatus.Running);
          return new RunResult({ exitCode: 1, output: '', errorOutput: 'not yet' });
        }
      }
      await put(request.workdir, `${id}.txt`, `${id}\n`);
      return ok();
    });
    const dependent = (id: string): string =>
      step(id, ', depends_on: [t], on_failure: {action: retry_step, target: t, max_retries: 1}');

    const result = await t.run(steps(step('t'), dependent('x'), dependent('y')));

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(xCalls).toBe(2);
    expect(yCalls).toBe(2);
    expect(t.transitions).toContain(`x:${StepStatus.Pending}`);
    expect(await worktrees(t.repo)).toBe(1);
  });
});

/** A manager whose run worktree behaves as asked, to reach the failures git does not produce on demand. */
function broken(how: 'fork' | 'remove'): (manager: WorkspaceManager) => WorkspaceManager {
  return (manager) => ({
    async create(taskId, variant) {
      const real = await manager.create(taskId, variant);
      if (!isForkable(real)) {
        throw new Error('the git worktree must be forkable');
      }
      const forkable: ForkableWorkspace = {
        path: () => real.path(),
        diff: () => real.diff(),
        destroy: () => real.destroy(),
        land: (child) => real.land(child),
        async fork(name) {
          if (how === 'fork') {
            throw new WorkspaceError('The worktree for the step could not be created.');
          }
          const child: Workspace = await real.fork(name);
          return {
            path: () => child.path(),
            diff: () => child.diff(),
            destroy: async () => {
              await child.destroy();
              throw new WorkspaceError('stuck');
            },
          };
        },
      };
      return forkable;
    },
  });
}

describe('a worktree that cannot be created or removed', () => {
  it('fails the step with the reason when its fork cannot be created', async () => {
    const t = await build(async () => ok(), { wrap: broken('fork') });
    const result = await t.run(steps(step('a')));
    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.steps.a).toBe(StepStatus.Failed);
    expect(result.failureReason).toContain('could not be created');
  });

  it('lets the run go on and ends it FAILED when a step worktree cannot be removed', async () => {
    const t = await build(
      async (request) => {
        await put(request.workdir, 'a.txt', 'a\n');
        return ok();
      },
      { wrap: broken('remove') },
    );
    const result = await t.run(steps(step('a')));
    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.steps.a).toBe(StepStatus.Completed);
    expect(result.failureReason).toBe('The workspace could not be removed.');
    expect(await t.patch()).toContain('a.txt');
  });
});
