import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { RunResult, SimpleEventDispatcher, StepStatus, Tracer } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  GuardRegistry,
  parseWorkflow,
  StepExecutor,
  WorkflowEngine,
  WorkflowStatus,
  type Workspace,
} from '../src/index.js';
import {
  FakeRegistry,
  FakeRunner,
  FixedClock,
  harness,
  makeGitRepo,
  makeTempDir,
  SequenceIds,
} from './support.js';

const ok = (): RunResult => new RunResult({ exitCode: 0, output: 'ok' });
const bad = (): RunResult => new RunResult({ exitCode: 1, output: '', errorOutput: 'nope' });

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const HEAD = 'version: "1.0"\nname: t\nroles:\n  a: {runner: agent}\n';

describe('failure policies', () => {
  it('fails the run when a step fails with no policy', async () => {
    const repo = await makeGitRepo();
    const { engine } = harness(repo, [new FakeRunner('agent', bad)]);

    const result = await engine.run(parseWorkflow(`${HEAD}steps:\n  - {id: x, role: a}\n`), { taskId: 'F1' });

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.steps.x).toBe(StepStatus.Failed);
  });

  it('fails the run when the policy is fail', async () => {
    const repo = await makeGitRepo();
    const { engine } = harness(repo, [new FakeRunner('agent', bad)]);
    const yaml = `${HEAD}steps:\n  - {id: x, role: a, on_failure: {action: fail}}\n`;

    const result = await engine.run(parseWorkflow(yaml), { taskId: 'F2' });

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.steps.x).toBe(StepStatus.Failed);
  });

  it('escalates the run when the policy is escalate', async () => {
    const repo = await makeGitRepo();
    const agent = new FakeRunner('agent', bad);
    const { engine } = harness(repo, [agent]);
    const yaml = `${HEAD}steps:\n  - {id: x, role: a, on_failure: {action: escalate}}\n`;

    const result = await engine.run(parseWorkflow(yaml), { taskId: 'F3' });

    expect(result.status).toBe(WorkflowStatus.Escalated);
    expect(result.steps.x).toBe(StepStatus.Escalated);
    expect(agent.requests).toHaveLength(1);
  });

  it('retries only the target and its descendants, leaving pending steps alone', async () => {
    const repo = await makeGitRepo();
    let calls = 0;
    const flaky = new FakeRunner('agent', () => {
      calls += 1;
      return calls === 2 ? bad() : ok();
    });
    const { engine, transitions } = harness(repo, [flaky]);
    const yaml = `${HEAD}steps:
  - {id: first, role: a}
  - {id: second, role: a, depends_on: [first], on_failure: {action: retry_step, target: second, max_retries: 1}}
  - {id: third, role: a, depends_on: [second]}
`;

    const result = await engine.run(parseWorkflow(yaml), { taskId: 'F4' });

    expect(result.status).toBe(WorkflowStatus.Completed);
    expect(calls).toBe(4);
    expect(transitions.filter((t) => t.stepId === 'first').map((t) => t.to)).not.toContain(
      StepStatus.Pending,
    );
  });
});

describe('isolated workspaces', () => {
  const ISOLATED = (artifacts: string, inputs: string) => `${HEAD}artifacts:
${artifacts}
steps:
  - id: code
    role: a
    isolation: git_worktree
    input_artifacts: [${inputs}]
`;

  it('stages only the input artifacts that exist in the project and not yet in the worktree', async () => {
    const repo = await makeGitRepo();
    await mkdir(join(repo, 'notes'));
    await writeFile(join(repo, 'notes', 'in.md'), 'from the project');
    const seen: Record<string, boolean | string> = {};
    const agent = new FakeRunner('agent', async (request) => {
      seen.staged = await readFile(join(request.workdir, 'notes', 'in.md'), 'utf8');
      seen.tracked = await readFile(join(request.workdir, 'src', 'app.txt'), 'utf8');
      seen.missing = await exists(join(request.workdir, 'missing.md'));
      return ok();
    });
    const { engine } = harness(repo, [agent]);
    const yaml = ISOLATED(
      '  patch: ".indaba/artifacts/change.patch"',
      'notes/in.md, src/app.txt, missing.md, ../escape.md',
    );

    const result = await engine.run(parseWorkflow(yaml), { taskId: 'W1' });

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(seen).toEqual({ staged: 'from the project', tracked: 'v1\n', missing: false });
  });

  it('survives a patch target it cannot write', async () => {
    const repo = await makeGitRepo();
    await writeFile(join(repo, 'blocker'), 'a file, not a directory');
    const { engine } = harness(repo, [new FakeRunner('agent', ok)]);
    const yaml = ISOLATED('  patch: "blocker/out.patch"', '');

    const result = await engine.run(parseWorkflow(yaml), { taskId: 'W2' });

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
  });

  it('writes no patch for a target outside the project', async () => {
    const repo = await makeGitRepo();
    const { engine } = harness(repo, [new FakeRunner('agent', ok)]);
    // A name unique to this repository: a fixed one shared between runs would hide a real escape
    // behind a stale file, or blame this run for another one's.
    const escapedName = `${basename(repo)}-escaped.patch`;
    const escaped = join(repo, '..', escapedName);
    const yaml = ISOLATED(`  patch: "../${escapedName}"`, '');

    try {
      const result = await engine.run(parseWorkflow(yaml), { taskId: 'W3' });

      expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
      expect(await exists(escaped)).toBe(false);
    } finally {
      await rm(escaped, { force: true });
    }
  });

  it('writes no patch when the workflow declares no patch artifact', async () => {
    const repo = await makeGitRepo();
    const { engine } = harness(repo, [new FakeRunner('agent', ok)]);
    const yaml = ISOLATED('  other: "x.md"', '');

    const result = await engine.run(parseWorkflow(yaml), { taskId: 'W4' });

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
  });
});

describe('teardown failures', () => {
  async function engineWith(destroyError: Error, agent: FakeRunner): Promise<WorkflowEngine> {
    const repo = await makeGitRepo();
    const worktree = await makeTempDir();
    const workspace: Workspace = {
      path: () => worktree,
      diff: async () => '',
      destroy: async () => {
        throw destroyError;
      },
    };
    const events = new SimpleEventDispatcher();
    const ids = new SequenceIds();
    const tracer = new Tracer(new FixedClock(), events, ids);
    const executor = new StepExecutor({
      runners: new FakeRegistry([agent]),
      guards: GuardRegistry.withDefaults(),
      tracer,
    });
    return new WorkflowEngine({
      executor,
      tracer,
      events,
      workspaces: { create: async () => workspace },
      projectDir: repo,
      ids,
    });
  }

  const YAML = `${HEAD}steps:\n  - {id: x, role: a, isolation: git_worktree}\n`;

  it('rethrows the teardown error after an otherwise clean run', async () => {
    const engine = await engineWith(new Error('cannot remove'), new FakeRunner('agent', ok));

    await expect(engine.run(parseWorkflow(YAML), { taskId: 'D1' })).rejects.toThrow('cannot remove');
  });

  it('prefers the original error over a teardown error', async () => {
    const agent = new FakeRunner('agent', () => {
      throw new TypeError('original');
    });
    const engine = await engineWith(new Error('cannot remove'), agent);

    await expect(engine.run(parseWorkflow(YAML), { taskId: 'D2' })).rejects.toThrow('original');
  });
});
