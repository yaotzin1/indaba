import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RunResult, StepStatus } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { PromptBuilder, parseWorkflow, WorkflowStatus } from '../src/index.js';
import { FakeRunner, type Handler, harness, makeGitRepo } from './support.js';

const PIPELINE = `
version: "1.0"
name: pipeline
artifacts:
  spec: ".indaba/artifacts/spec.md"
  patch: ".indaba/artifacts/change.patch"
roles:
  architect: {runner: arch}
  implementer: {runner: impl}
  reviewer: {runner: rev}
steps:
  - id: rfc
    role: architect
    goal: "Write \${{ artifacts.spec }}"
    outputs: ["\${{ artifacts.spec }}"]
    guards:
      - {type: git_diff_empty, paths: ["src/"]}
  - id: code
    depends_on: [rfc]
    role: implementer
    input_artifacts: ["\${{ artifacts.spec }}"]
    goal: Implement it
    isolation: git_worktree
  - id: verify
    depends_on: [code]
    runner: shell
    commands: ["grep -q fixed src/app.txt"]
    on_failure: {action: retry_step, target: code, max_retries: 2}
  - id: review
    depends_on: [verify]
    role: reviewer
    consensus_with: [architect]
    decision_type: consensus
    goal: Review the change
`;

const ok = (output = 'ok'): RunResult => new RunResult({ exitCode: 0, output });

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Stands in for the shell runner: understands the one command the pipeline declares. */
function shell(): FakeRunner {
  return new FakeRunner('shell', async (request) => {
    const text = await readFile(join(request.workdir, 'src', 'app.txt'), 'utf8').catch(() => '');
    return text.includes('fixed')
      ? ok()
      : new RunResult({ exitCode: 1, output: '', errorOutput: 'pattern not found' });
  });
}

function architect(): FakeRunner {
  // The first call is the RFC step, which writes the spec; later calls are debate turns.
  return new FakeRunner('arch', async (request, call) => {
    if (call === 1) {
      await mkdir(join(request.workdir, '.indaba', 'artifacts'), { recursive: true });
      await writeFile(join(request.workdir, '.indaba', 'artifacts', 'spec.md'), '# spec');
      return ok('done');
    }
    return ok('AGREEMENT: matches the spec');
  });
}

const reviewer = (reply = 'AGREEMENT: lgtm'): FakeRunner => new FakeRunner('rev', () => ok(reply));

describe('WorkflowEngine', () => {
  it('runs the whole pipeline, retries with isolated feedback and cleans up', async () => {
    const repo = await makeGitRepo();
    const implementer = new FakeRunner('impl', async (request, call) => {
      expect(request.workdir).toContain('worktrees');
      expect(await exists(join(request.workdir, '.indaba', 'artifacts', 'spec.md'))).toBe(true);
      await writeFile(join(request.workdir, 'src', 'app.txt'), call === 1 ? 'broken\n' : 'fixed\n');
      return ok();
    });
    const { engine, transitions } = harness(repo, [architect(), implementer, reviewer(), shell()]);

    const result = await engine.run(parseWorkflow(PIPELINE), { taskId: 'T1' });

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    for (const id of ['rfc', 'code', 'verify', 'review']) {
      expect(result.steps[id]).toBe(StepStatus.Completed);
    }

    expect(implementer.requests).toHaveLength(2);
    expect(implementer.requests[0]?.prompt).not.toContain('previous attempt failed');
    expect(implementer.requests[1]?.prompt).toContain('previous attempt failed');
    expect(implementer.requests[1]?.prompt).toContain('grep -q fixed src/app.txt');

    expect(await readFile(join(repo, '.indaba', 'artifacts', 'change.patch'), 'utf8')).toContain('+fixed');
    expect(await readFile(join(repo, 'src', 'app.txt'), 'utf8')).toBe('v1\n');
    expect(await exists(join(repo, '.indaba', 'worktrees', 'T1'))).toBe(false);

    const verify = transitions.filter((t) => t.stepId === 'verify').map((t) => t.to);
    expect(verify).toContain(StepStatus.Failed);
  });

  it('carries only the last failure into a retry prompt', async () => {
    const repo = await makeGitRepo();
    const implementer = new FakeRunner('impl', async (request, call) => {
      await writeFile(join(request.workdir, 'src', 'app.txt'), call === 3 ? 'fixed\n' : `broken ${call}\n`);
      return ok();
    });
    const failing = new FakeRunner('shell', async (request) => {
      const text = await readFile(join(request.workdir, 'src', 'app.txt'), 'utf8');
      return text.includes('fixed')
        ? ok()
        : new RunResult({ exitCode: 1, output: '', errorOutput: `FAILURE-${text.trim()}` });
    });
    const { engine } = harness(repo, [architect(), implementer, reviewer(), failing]);

    const result = await engine.run(parseWorkflow(PIPELINE), { taskId: 'T1b' });

    expect(result.status).toBe(WorkflowStatus.Completed);
    expect(implementer.requests).toHaveLength(3);
    const third = implementer.requests[2]?.prompt ?? '';
    expect(third).toContain('FAILURE-broken 2');
    expect(third).not.toContain('FAILURE-broken 1');
  });

  it('escalates when retries are exhausted', async () => {
    const repo = await makeGitRepo();
    const implementer = new FakeRunner('impl', () => ok('did nothing'));
    const { engine } = harness(repo, [architect(), implementer, reviewer(), shell()]);

    const result = await engine.run(parseWorkflow(PIPELINE), { taskId: 'T2' });

    expect(result.status).toBe(WorkflowStatus.Escalated);
    expect(implementer.requests).toHaveLength(3);
    expect(result.steps.verify).toBe(StepStatus.Escalated);
    expect(result.steps.review).toBe(StepStatus.Pending);
    expect(await exists(join(repo, '.indaba', 'worktrees', 'T2'))).toBe(false);
  });

  it('fails the RFC step when it touches the source', async () => {
    const repo = await makeGitRepo();
    const sneaky = new FakeRunner('arch', async (request) => {
      await mkdir(join(request.workdir, '.indaba', 'artifacts'), { recursive: true });
      await writeFile(join(request.workdir, '.indaba', 'artifacts', 'spec.md'), '# spec');
      await writeFile(join(request.workdir, 'src', 'app.txt'), 'sneaky\n');
      return ok('done');
    });
    const { engine } = harness(repo, [sneaky]);

    const result = await engine.run(parseWorkflow(PIPELINE), { taskId: 'T3' });

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.steps.rfc).toBe(StepStatus.Failed);
    expect(result.failureReason).toContain('Guard git_diff_empty failed');
    expect(result.failureReason).toContain('src/app.txt');
  });

  it('fails a step whose output was not produced', async () => {
    const repo = await makeGitRepo();
    const { engine } = harness(repo, [new FakeRunner('arch', () => ok('forgot the file'))]);

    const result = await engine.run(parseWorkflow(PIPELINE), { taskId: 'T4' });

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.failureReason).toContain('was not produced');
  });

  it('escalates without retrying when there is no consensus', async () => {
    const repo = await makeGitRepo();
    const implementer = new FakeRunner('impl', async (request) => {
      await writeFile(join(request.workdir, 'src', 'app.txt'), 'fixed\n');
      return ok();
    });
    const { engine } = harness(repo, [
      architect(),
      implementer,
      reviewer('CRITIQUE: needs more tests'),
      shell(),
    ]);

    const result = await engine.run(parseWorkflow(PIPELINE), { taskId: 'T5' });

    expect(result.status).toBe(WorkflowStatus.Escalated);
    expect(result.steps.review).toBe(StepStatus.Escalated);
    expect(result.failureReason).toContain('needs more tests');
    expect(implementer.requests).toHaveLength(1);
  });

  it('fails the step instead of crashing on an unknown runner', async () => {
    const repo = await makeGitRepo();
    const { engine } = harness(repo, []);

    const result = await engine.run(parseWorkflow(PIPELINE), { taskId: 'T6' });

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.failureReason).toContain('Unknown runner "arch"');
  });

  it('refuses to start a run that is already aborted, touching nothing', async () => {
    const repo = await makeGitRepo();
    const arch = architect();
    const { engine } = harness(repo, [arch]);

    const result = await engine.run(parseWorkflow(PIPELINE), { taskId: 'T7', signal: AbortSignal.abort() });

    expect(result.status).toBe(WorkflowStatus.Cancelled);
    expect(arch.requests).toHaveLength(0);
    expect(result.steps.rfc).toBe(StepStatus.Pending);
  });

  it('aborts during a step, stops the run and removes the worktree', async () => {
    const repo = await makeGitRepo();
    const controller = new AbortController();
    const hanging: Handler = (_request, _call, signal) =>
      new Promise<RunResult>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted by the caller')));
        controller.abort();
      });
    const implementer = new FakeRunner('impl', hanging);
    const rev = reviewer();
    const { engine } = harness(repo, [architect(), implementer, rev, shell()]);

    const result = await engine.run(parseWorkflow(PIPELINE), { taskId: 'T8', signal: controller.signal });

    expect(result.status).toBe(WorkflowStatus.Cancelled);
    expect(result.steps.code).toBe(StepStatus.Failed);
    expect(result.steps.verify).toBe(StepStatus.Pending);
    expect(implementer.requests).toHaveLength(1);
    expect(rev.requests).toHaveLength(0);
    expect(await exists(join(repo, '.indaba', 'worktrees', 'T8'))).toBe(false);
  });

  it('tears the worktree down when a runner throws', async () => {
    const repo = await makeGitRepo();
    const implementer = new FakeRunner('impl', () => {
      throw new TypeError('boom');
    });
    const { engine } = harness(repo, [architect(), implementer]);

    await expect(engine.run(parseWorkflow(PIPELINE), { taskId: 'T9' })).rejects.toThrow('boom');
    expect(await exists(join(repo, '.indaba', 'worktrees', 'T9'))).toBe(false);
  });

  it('names a task itself when none is given', async () => {
    const repo = await makeGitRepo();
    const { engine } = harness(repo, [new FakeRunner('arch', () => ok())]);

    const result = await engine.run(parseWorkflow(PIPELINE));

    expect(result.taskId).toMatch(/^task-/);
    expect(result.traceId).toHaveLength(32);
  });

  it('runs steps in dependency order, ties by declaration', async () => {
    const repo = await makeGitRepo();
    const order: string[] = [];
    const runner = new FakeRunner('r', (request) => {
      order.push(request.prompt.split('\n')[3] ?? '');
      return ok();
    });
    const yaml = `version: "1.0"
name: o
roles: {r: {runner: r}}
steps:
  - {id: c, role: r, goal: C, depends_on: [a]}
  - {id: a, role: r, goal: A}
  - {id: b, role: r, goal: B}
`;
    const { engine } = harness(repo, [runner]);
    await engine.run(parseWorkflow(yaml), { taskId: 'O' });
    expect(order).toEqual(['A', 'C', 'B']);
  });
});

describe('PromptBuilder', () => {
  it('keeps only the tail of a long failure', () => {
    const prompts = new PromptBuilder();
    const long = `${'x'.repeat(5000)}END`;
    const tail = prompts.tail(long);
    expect(tail.startsWith('[...truncated...]\n')).toBe(true);
    expect(tail.endsWith('END')).toBe(true);
    expect(tail.length).toBeLessThan(long.length);
  });
});
