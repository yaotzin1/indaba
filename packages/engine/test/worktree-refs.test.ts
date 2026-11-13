import { RunResult, SimpleEventDispatcher, Tracer } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  Git,
  GitWorktreeManager,
  GuardRegistry,
  isRestorable,
  parseWorkflow,
  type RestorableWorkspace,
  StepExecutor,
  WorkflowEngine,
  WorkflowStatus,
  type WorkspaceManager,
} from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, makeGitRepo, SequenceIds } from './support.js';

// specs/host-process-containment, AC-10 to AC-12: an isolated step shares the branches and tags of the repository.

const IDENTITY = [
  '-c',
  'user.name=Indaba Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
];
const git = new Git();

async function repoWithRefs(): Promise<{ repo: string; head: string }> {
  const repo = await makeGitRepo();
  const head = (await git.run(['rev-parse', 'HEAD'], repo)).trim();
  await git.run(['branch', 'other'], repo);
  await git.run(['branch', 'feature/x'], repo);
  await git.run(['tag', 'v1.0.0'], repo);
  return { repo, head };
}

async function restorable(repo: string): Promise<RestorableWorkspace> {
  const space = await new GitWorktreeManager(repo).create('t1');
  if (!isRestorable(space)) {
    throw new Error('the git worktree must be restorable');
  }
  return space;
}

const refNames = async (repo: string): Promise<string[]> =>
  (await git.run(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags'], repo))
    .split('\n')
    .filter((line) => line !== '');

describe('GitWorktree.verifyRefs and restore (AC-10, AC-11)', () => {
  it('records the branches and tags in the checkpoint, and finds nothing changed when nothing was', async () => {
    const { repo } = await repoWithRefs();
    const space = await restorable(repo);
    const checkpoint = await space.checkpoint();

    expect(checkpoint.refs).toContain(' refs/heads/other');
    expect(checkpoint.refs).toContain(' refs/tags/v1.0.0');
    expect(await space.verifyRefs?.(checkpoint)).toEqual([]);
  });

  it('detects git branch -D, git branch -f, git tag -d and a new branch made from inside the worktree', async () => {
    const { repo } = await repoWithRefs();
    const space = await restorable(repo);
    const checkpoint = await space.checkpoint();
    await git.run([...IDENTITY, 'commit', '--allow-empty', '-q', '-m', 'move'], space.path());

    await git.run(['branch', '-D', 'other'], space.path());
    await git.run(['branch', '-f', 'feature/x', 'HEAD'], space.path());
    await git.run(['tag', '-d', 'v1.0.0'], space.path());
    await git.run(['branch', 'created-by-step'], space.path());

    expect(await space.verifyRefs?.(checkpoint)).toEqual([
      'refs/heads/created-by-step',
      'refs/heads/feature/x',
      'refs/heads/other',
      'refs/tags/v1.0.0',
    ]);
  });

  it('puts every branch and tag back on restore, and removes the one that was made', async () => {
    const { repo, head } = await repoWithRefs();
    const before = await refNames(repo);
    const space = await restorable(repo);
    const checkpoint = await space.checkpoint();
    await git.run([...IDENTITY, 'commit', '--allow-empty', '-q', '-m', 'move'], space.path());
    await git.run(['branch', '-D', 'other'], space.path());
    await git.run(['branch', '-f', 'feature/x', 'HEAD'], space.path());
    await git.run(['tag', '-d', 'v1.0.0'], space.path());
    await git.run(['branch', 'created-by-step'], space.path());

    await space.restore(checkpoint);

    expect(await refNames(repo)).toEqual(before);
    expect((await git.run(['rev-parse', 'refs/heads/feature/x'], repo)).trim()).toBe(head);
    expect((await git.run(['rev-parse', 'refs/heads/other'], repo)).trim()).toBe(head);
    expect(await space.verifyRefs?.(checkpoint)).toEqual([]);
  });

  it('checks nothing for a checkpoint that recorded no references, and never runs a line that is not a ref', async () => {
    const { repo } = await repoWithRefs();
    const space = await restorable(repo);
    const checkpoint = await space.checkpoint();
    const { refs: _dropped, ...without } = checkpoint;
    await git.run(['branch', '-D', 'other'], space.path());

    expect(await space.verifyRefs?.(without)).toEqual([]);

    const forged = {
      ...checkpoint,
      refs: `${'a'.repeat(40)} refs/heads/--delete\n${'b'.repeat(40)} HEAD\nnot a line`,
    };
    await space.restore(forged);
    expect(await refNames(repo)).not.toContain('refs/heads/--delete');
  });
});

describe('a step that touches the references of the repository (AC-12)', () => {
  async function run(
    handler: ConstructorParameters<typeof FakeRunner>[1],
    workspaces?: (repo: string) => WorkspaceManager,
  ) {
    const { repo } = await repoWithRefs();
    const events = new SimpleEventDispatcher();
    const ids = new SequenceIds();
    const tracer = new Tracer(new FixedClock(), events, ids);
    const runner = new FakeRunner('work', handler);
    const engine = new WorkflowEngine({
      executor: new StepExecutor({
        runners: new FakeRegistry([runner]),
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
    const workflow = parseWorkflow(
      'version: "1.0"\nname: t\nroles:\n  w: {runner: work}\nsteps:\n  - id: a\n    role: w\n    goal: g\n    isolation: git_worktree\n',
    );
    const before = await refNames(repo);
    return { result: await engine.run(workflow), repo, before };
  }
  const ok = () => new RunResult({ exitCode: 0, output: 'done' });

  it('fails the step, names the reference, and leaves the branch where it was', async () => {
    const { result, repo, before } = await run(async (request) => {
      await git.run(['branch', '-D', 'other'], request.workdir);
      return ok();
    });

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.failureReason).toContain(
      'Step "a" modified git references outside its isolated worktree (refs/heads/other); changes to branches and tags were rolled back.',
    );
    expect(await refNames(repo)).toEqual(before);
  });

  it('does the same for a deleted tag and a moved branch', async () => {
    const { result, repo, before } = await run(async (request) => {
      await git.run(['tag', '-d', 'v1.0.0'], request.workdir);
      await git.run([...IDENTITY, 'commit', '--allow-empty', '-q', '-m', 'move'], request.workdir);
      await git.run(['branch', '-f', 'feature/x', 'HEAD'], request.workdir);
      return ok();
    });

    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.failureReason).toContain('refs/heads/feature/x, refs/tags/v1.0.0');
    expect(await refNames(repo)).toEqual(before);
  });

  it('lists at most ten references and says how many more there were', async () => {
    const { result } = await run(async (request) => {
      for (let i = 0; i < 12; i += 1) {
        await git.run(['branch', `extra-${String(i).padStart(2, '0')}`], request.workdir);
      }
      return ok();
    });

    expect(result.failureReason).toContain(', and 2 more)');
    expect(result.failureReason).not.toContain('extra-11');
  });

  it('leaves a step that touched nothing alone', async () => {
    const { result } = await run(async () => ok());
    expect(result.status).toBe(WorkflowStatus.Completed);
  });

  it('does not fail a step because the check itself could not be made', async () => {
    const { result } = await run(
      async () => ok(),
      (repo) => ({
        create: async (taskId, variant) => {
          const space = await new GitWorktreeManager(repo).create(taskId, variant);
          if (!isRestorable(space)) {
            throw new Error('restorable');
          }
          return Object.assign(Object.create(Object.getPrototypeOf(space)), space, {
            verifyRefs: () => Promise.reject(new Error('git is gone')),
          });
        },
      }),
    );
    expect(result.status).toBe(WorkflowStatus.Completed);
  });

  it('says so when the references could not be put back', async () => {
    const { result } = await run(
      async (request) => {
        await git.run(['branch', '-D', 'other'], request.workdir);
        return ok();
      },
      (repo) => ({
        create: async (taskId, variant) => {
          const space = await new GitWorktreeManager(repo).create(taskId, variant);
          if (!isRestorable(space)) {
            throw new Error('restorable');
          }
          const restore = space.restore.bind(space);
          let calls = 0;
          return Object.assign(Object.create(Object.getPrototypeOf(space)), space, {
            restore: (checkpoint: Parameters<typeof restore>[0]) => {
              calls += 1;
              return calls === 1 ? Promise.reject(new Error('locked')) : restore(checkpoint);
            },
          });
        },
      }),
    );
    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.failureReason).toContain('The rollback itself failed');
  });
});
