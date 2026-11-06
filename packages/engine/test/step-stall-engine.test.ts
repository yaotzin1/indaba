import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  IndabaError,
  type Runner,
  type RunRequest,
  RunResult,
  SimpleEventDispatcher,
  type Span,
  SpanEnded,
  type StallCapable,
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
  type Workspace,
  type WorkspaceManager,
} from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, makeGitRepo, SequenceIds } from './support.js';

// specs/step-stalls, release 2: the stall limit and the retry of a stalled attempt.

const STALL_CODE = 125;
const stalled = (seconds: number) =>
  new RunResult({
    exitCode: STALL_CODE,
    output: '',
    errorOutput: `\nStalled: no activity for ${seconds} seconds.`,
    stalled: true,
  });
const ok = () => new RunResult({ exitCode: 0, output: 'done' });

class CapableRunner extends FakeRunner implements StallCapable {
  constructor(
    name: string,
    handler: ConstructorParameters<typeof FakeRunner>[1],
    readonly canReportActivity = true,
  ) {
    super(name, handler);
  }
}

const HEAD = 'version: "1.0"\nname: t\nroles:\n  w: {runner: work}\n';
const stallStep = (stall: string, extra = '    isolation: git_worktree\n', id = 'a') =>
  `${HEAD}steps:\n  - id: ${id}\n    role: w\n    goal: g\n${extra}    stall: ${stall}\n`;

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

async function build(runners: readonly Runner[], workspaces?: (repo: string) => WorkspaceManager) {
  const repo = await makeGitRepo();
  const events = new SimpleEventDispatcher();
  const spans: Span[] = [];
  const transitions: StepStatusChanged[] = [];
  events.addListener(SpanEnded, (e) => {
    spans.push(e.span);
  });
  events.addListener(StepStatusChanged, (e) => {
    transitions.push(e);
  });
  const ids = new SequenceIds();
  const tracer = new Tracer(new FixedClock(), events, ids);
  const engine = new WorkflowEngine({
    executor: new StepExecutor({
      runners: new FakeRegistry(runners),
      guards: GuardRegistry.withDefaults(),
      tracer,
      events,
    }),
    tracer,
    events,
    workspaces: workspaces?.(repo) ?? new GitWorktreeManager(repo),
    projectDir: repo,
    ids,
  });
  return { engine, spans, transitions, repo };
}

const reasons = (transitions: readonly StepStatusChanged[], id = 'a') =>
  transitions.filter((t) => t.stepId === id).map((t) => `${t.from}>${t.to}${t.reason ? `:${t.reason}` : ''}`);

describe('a stalled attempt that is retried (AC-06, AC-07, AC-09, AC-18)', () => {
  async function stallsOnce() {
    const seen: { prompt: string; partialThere: boolean; stallSeconds: number | undefined }[] = [];
    const runner = new CapableRunner('work', async (request: RunRequest, call: number) => {
      seen.push({
        prompt: request.prompt,
        partialThere: await exists(join(request.workdir, 'partial.txt')),
        stallSeconds: request.stallSeconds,
      });
      if (call === 1) {
        await writeFile(join(request.workdir, 'partial.txt'), 'half done');
        return stalled(90);
      }
      await writeFile(join(request.workdir, 'done.txt'), 'finished');
      return ok();
    });
    const built = await build([runner]);
    const result = await built.engine.run(parseWorkflow(stallStep('{after_seconds: 90, retries: 1}')));
    return { ...built, result, seen, runner };
  }

  it('runs the step again, with nothing the stalled attempt did, and completes', async () => {
    const { result, seen } = await stallsOnce();

    expect(result.status).toBe(WorkflowStatus.Completed);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.partialThere).toBe(false);
    expect(seen[1]?.partialThere).toBe(false);
  });

  it('sends the silence limit with every attempt', async () => {
    const { seen } = await stallsOnce();
    expect(seen.map((s) => s.stallSeconds)).toEqual([90, 90]);
  });

  it('carries only the stall as the feedback of the next attempt', async () => {
    const { seen } = await stallsOnce();

    expect(seen[0]?.prompt).not.toContain('previous attempt');
    expect(seen[1]?.prompt).toContain(
      'Your previous attempt stalled: no activity for 90 seconds. Nothing it did was kept.',
    );
  });

  it('moves the step through failed and pending, with the fixed reasons', async () => {
    const { transitions } = await stallsOnce();

    expect(reasons(transitions)).toEqual([
      'PENDING>RUNNING',
      'RUNNING>FAILED:Stalled: no activity for 90 seconds.',
      'FAILED>PENDING:Stalled: no activity for 90 seconds (retry 1 of 1).',
      'PENDING>RUNNING',
      'RUNNING>VALIDATING',
      'VALIDATING>COMPLETED',
    ]);
  });

  it('records the stall on the spans and as one event, with no prompt or output in them (AC-18, AC-19)', async () => {
    const { spans } = await stallsOnce();
    const stepSpan = spans.find((s) => s.name === 'step a');
    const calls = spans.filter((s) => s.name.startsWith('invoke_agent'));

    expect(stepSpan?.attributes['indaba.stall.after_seconds']).toBe(90);
    expect(stepSpan?.attributes['indaba.stall.retries']).toBe(1);
    expect(stepSpan?.attributes['indaba.stall.count']).toBe(1);
    expect(stepSpan?.events.filter((e) => e.name === 'indaba.step.stalled')).toEqual([
      {
        name: 'indaba.step.stalled',
        attributes: {
          'indaba.stall.attempt': 1,
          'indaba.stall.silent_seconds': 90,
          'indaba.stall.retry': 'restored',
        },
      },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.attributes['indaba.stall.silent_seconds']).toBe(90);
    expect('indaba.stall.silent_seconds' in (calls[1]?.attributes ?? {})).toBe(false);
    const everything = JSON.stringify([...spans.map((s) => [s.attributes, s.events])]);
    expect(everything).not.toContain('half done');
    expect(everything).not.toContain('Your previous attempt');
  });
});

describe('when the retries are used up (AC-06, AC-08)', () => {
  it('fails the step with the fixed reason, and records that nothing was left', async () => {
    const runner = new CapableRunner('work', () => stalled(90));
    const { engine, spans, transitions } = await build([runner]);
    const result = await engine.run(parseWorkflow(stallStep('{after_seconds: 90, retries: 1}')));

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.failureReason).toContain('Stalled: no activity for 90 seconds.');
    expect(runner.requests).toHaveLength(2);
    expect(reasons(transitions).at(-1)).toBe('RUNNING>FAILED:Stalled: no activity for 90 seconds.');
    const stepSpan = spans.find((s) => s.name === 'step a');
    expect(stepSpan?.attributes['indaba.stall.count']).toBe(2);
    expect(stepSpan?.events.map((e) => e.attributes['indaba.stall.retry'])).toEqual([
      'restored',
      'exhausted',
    ]);
  });

  it('with retries 0 (the default) makes one attempt and needs no worktree', async () => {
    const runner = new CapableRunner('work', () => stalled(120));
    const { engine, spans } = await build([runner]);
    const result = await engine.run(parseWorkflow(stallStep('{after_seconds: 120}', '')));

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(runner.requests).toHaveLength(1);
    expect(spans.find((s) => s.name === 'step a')?.events[0]?.attributes['indaba.stall.retry']).toBe(
      'exhausted',
    );
  });

  it('is never reported as a timeout (AC-06)', async () => {
    const runner = new CapableRunner('work', () => stalled(90));
    const { engine } = await build([runner]);
    const result = await engine.run(parseWorkflow(stallStep('{after_seconds: 90}', '')));
    expect(result.failureReason).not.toContain('Timed out');
  });
});

describe('the stall retries and on_failure are separate budgets (AC-08, AC-09)', () => {
  it('multiplies, and gives the stall retries back when the step is reset', async () => {
    const runner = new CapableRunner('work', () => stalled(90));
    const { engine } = await build([runner]);
    const workflow = parseWorkflow(
      stallStep(
        '{after_seconds: 90, retries: 1}',
        '    isolation: git_worktree\n    on_failure: {action: retry_step, target: a, max_retries: 1}\n',
      ),
    );
    const result = await engine.run(workflow);

    // (1 + stall retries) * (1 + on_failure retries) = 4 calls, then the run ends.
    expect(runner.requests).toHaveLength(4);
    expect(result.status).toBe(WorkflowStatus.Escalated);
  });

  it('does not let a stall use up the on_failure retries of another step', async () => {
    const counts: number[] = [];
    const runner = new CapableRunner('work', (_request, call) => {
      counts.push(call);
      return call === 1 ? stalled(90) : ok();
    });
    const { engine } = await build([runner]);
    const result = await engine.run(parseWorkflow(stallStep('{after_seconds: 90, retries: 1}')));
    expect(result.status).toBe(WorkflowStatus.Completed);
    expect(counts).toEqual([1, 2]);
  });
});

describe('a stall the step did not ask for (spec section 5)', () => {
  it('is an ordinary failure with no retry and no stall event', async () => {
    const runner = new FakeRunner('work', () => stalled(0));
    const { engine, spans } = await build([runner]);
    const result = await engine.run(parseWorkflow(`${HEAD}steps:\n  - id: a\n    role: w\n    goal: g\n`));

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(runner.requests).toHaveLength(1);
    expect(result.failureReason).toContain(`exited with code ${STALL_CODE}`);
    expect(spans.find((s) => s.name === 'step a')?.events).toEqual([]);
  });
});

describe('a workspace that cannot be restored (AC-07, section 5)', () => {
  it('fails the step with the fixed reason and makes no further attempt', async () => {
    const runner = new CapableRunner('work', () => stalled(90));
    const plainOnly = (repo: string): WorkspaceManager => {
      const inner = new GitWorktreeManager(repo);
      return {
        create: async (taskId, variant) => {
          const real = await inner.create(taskId, variant);
          const bare: Workspace = {
            path: () => real.path(),
            diff: () => real.diff(),
            destroy: () => real.destroy(),
          };
          return bare;
        },
      };
    };
    const { engine, spans } = await build([runner], plainOnly);
    const result = await engine.run(parseWorkflow(stallStep('{after_seconds: 90, retries: 2}')));

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.failureReason).toContain('The worktree could not be restored after a stall.');
    expect(runner.requests).toHaveLength(1);
    expect(spans.find((s) => s.name === 'step a')?.events[0]?.attributes['indaba.stall.retry']).toBe(
      'restore_failed',
    );
  });
});

describe('cancellation (spec section 5)', () => {
  it('ends cancelled, without another attempt, when the run is aborted while a stalled attempt is handled', async () => {
    const controller = new AbortController();
    const runner = new CapableRunner('work', () => {
      controller.abort();
      return stalled(90);
    });
    const { engine } = await build([runner]);
    const result = await engine.run(parseWorkflow(stallStep('{after_seconds: 90, retries: 2}')), {
      signal: controller.signal,
    });

    expect(result.status).toBe(WorkflowStatus.Cancelled);
    expect(runner.requests).toHaveLength(1);
  });
});

describe('the runner must be able to report activity (AC-12, AC-21)', () => {
  const refused = async (runners: Runner[], workflow: string): Promise<string> => {
    const { engine } = await build(runners);
    try {
      await engine.run(parseWorkflow(workflow));
    } catch (error) {
      if (error instanceof IndabaError) {
        return error.message;
      }
      throw error;
    }
    return '';
  };

  it('refuses a plugin runner written before the capability, naming the step and the runner', async () => {
    const message = await refused([new FakeRunner('work', ok)], stallStep('{after_seconds: 90}', ''));
    expect(message).toContain(
      'step "a": runner "work" cannot report activity, so stall cannot be used with it',
    );
  });

  it('refuses a runner that declines by configuration', async () => {
    const message = await refused(
      [new CapableRunner('work', ok, false)],
      stallStep('{after_seconds: 90}', ''),
    );
    expect(message).toContain('runner "work" cannot report activity');
  });

  it('refuses a chain in which only the first runner can', async () => {
    const message = await refused(
      [new CapableRunner('work', ok), new FakeRunner('other', ok)],
      `${HEAD}  x: {runner: [work, other]}\nsteps:\n  - id: a\n    role: x\n    goal: g\n    stall: {after_seconds: 90}\n`,
    );
    expect(message).toContain('step "a": runner "other" cannot report activity');
  });

  it('accepts a chain in which every runner can', async () => {
    const { engine } = await build([new CapableRunner('work', ok), new CapableRunner('other', ok)]);
    const result = await engine.run(
      parseWorkflow(
        `${HEAD}  x: {runner: [work, other]}\nsteps:\n  - id: a\n    role: x\n    goal: g\n    stall: {after_seconds: 90}\n`,
      ),
    );
    expect(result.status).toBe(WorkflowStatus.Completed);
  });
});

describe('a workflow that does not use stall is unchanged (AC-20)', () => {
  it('sends no silence limit, records no stall attribute and no event', async () => {
    const runner = new FakeRunner('work', ok);
    const { engine, spans, transitions } = await build([runner]);
    const result = await engine.run(parseWorkflow(`${HEAD}steps:\n  - id: a\n    role: w\n    goal: g\n`));

    expect(result.status).toBe(WorkflowStatus.Completed);
    expect('stallSeconds' in (runner.requests[0] ?? {})).toBe(false);
    const attributeNames = spans.flatMap((s) => Object.keys(s.attributes));
    expect(attributeNames.filter((n) => n.startsWith('indaba.stall.'))).toEqual([]);
    expect(spans.flatMap((s) => s.events.map((e) => e.name))).not.toContain('indaba.step.stalled');
    expect(reasons(transitions)).toEqual(['PENDING>RUNNING', 'RUNNING>VALIDATING', 'VALIDATING>COMPLETED']);
  });
});
