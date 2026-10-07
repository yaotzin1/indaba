import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GuardResult, GuardType, WorkspaceError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { GitDiffEmptyGuard, GitWorktreeManager, GuardRegistry, PatchService } from '../src/index.js';
import { makeGitRepo, makeTempDir } from './support.js';

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('git worktrees', () => {
  it('isolates changes, produces a patch and cleans up', async () => {
    const repo = await makeGitRepo();
    const ws = await new GitWorktreeManager(repo).create('task-1');

    expect(ws.path()).toBe(join(repo, '.indaba', 'worktrees', 'task-1'));
    await writeFile(join(ws.path(), 'src', 'app.txt'), 'v2\n');
    await writeFile(join(ws.path(), 'src', 'new.txt'), 'new\n');
    await mkdir(join(ws.path(), '.indaba', 'artifacts'), { recursive: true });
    await writeFile(join(ws.path(), '.indaba', 'artifacts', 'spec.md'), 'never in the patch');

    expect(await readFile(join(repo, 'src', 'app.txt'), 'utf8')).toBe('v1\n');

    const patch = await ws.diff();
    expect(patch).toContain('+v2');
    expect(patch).toContain('src/new.txt');
    expect(patch).not.toContain('spec.md');

    const patches = new PatchService();
    expect(await patches.canApply(patch, repo)).toBe(true);
    await patches.apply(patch, repo);
    expect(await readFile(join(repo, 'src', 'app.txt'), 'utf8')).toBe('v2\n');
    expect(await patches.canApply(patch, repo)).toBe(false);

    await ws.destroy();
    await ws.destroy();
    expect(await exists(join(repo, '.indaba', 'worktrees', 'task-1'))).toBe(false);
    await expect(ws.diff()).rejects.toThrow('The workspace has been destroyed.');
  }, 30_000); // about ten git calls in a row: more than the default 5 s on a loaded Windows machine

  it('an empty patch always applies', async () => {
    const patches = new PatchService();
    const repo = await makeGitRepo();
    expect(await patches.canApply('  \n', repo)).toBe(true);
    await patches.apply('', repo);
  });

  it.each(['../escape', '..', 'a/b', 'a\\b', '-flag', '', 'x..y'])(
    'rejects the unsafe name %j',
    async (name) => {
      const manager = new GitWorktreeManager(await makeGitRepo());
      await expect(manager.create(name)).rejects.toBeInstanceOf(WorkspaceError);
      await expect(manager.create('ok', name)).rejects.toBeInstanceOf(WorkspaceError);
    },
  );

  it('refuses to reuse a worktree path', async () => {
    const manager = new GitWorktreeManager(await makeGitRepo());
    await manager.create('same');
    await expect(manager.create('same')).rejects.toBeInstanceOf(WorkspaceError);
  });

  it('names a variant worktree after the task', async () => {
    const repo = await makeGitRepo();
    const ws = await new GitWorktreeManager(repo).create('t', 'v2');
    expect(ws.path()).toBe(join(repo, '.indaba', 'worktrees', 't-v2'));
    await ws.destroy();
  });
});

describe('GitDiffEmptyGuard', () => {
  const definition = { type: GuardType.GitDiffEmpty, paths: ['src/'] };

  it('passes until something under the guarded paths changes', async () => {
    const repo = await makeGitRepo();
    const guard = new GitDiffEmptyGuard();

    expect((await guard.check(definition, repo)).passed).toBe(true);

    await writeFile(join(repo, 'other.txt'), 'outside the guarded paths');
    expect((await guard.check(definition, repo)).passed).toBe(true);

    await writeFile(join(repo, 'src', 'added.txt'), 'x');
    const result = await guard.check(definition, repo);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('src/added.txt');
  });

  it('fails closed outside a git repository', async () => {
    const result = await new GitDiffEmptyGuard().check(definition, await makeTempDir());
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Cannot inspect git state');
  });

  it('does not let a path be taken for an option', async () => {
    const repo = await makeGitRepo();
    const result = await new GitDiffEmptyGuard().check(
      { type: GuardType.GitDiffEmpty, paths: ['--version'] },
      repo,
    );
    expect(result.passed).toBe(true);
  });
});

describe('GuardRegistry', () => {
  it('fails a type with no implementation', async () => {
    const result = await new GuardRegistry().check({ type: 'ghost', paths: [] }, '.');
    expect(result.passed).toBe(false);
    expect(result.message).toBe('No implementation registered for guard "ghost".');
  });

  it('dispatches to a registered guard and lists its types', async () => {
    const registry = GuardRegistry.withDefaults().register({
      type: 'always_fail',
      check: async () => GuardResult.fail('nope'),
    });
    expect(registry.types()).toEqual(['git_diff_empty', 'diff_within_scope', 'always_fail']);
    expect((await registry.check({ type: 'always_fail', paths: [] }, '.')).message).toBe('nope');
  });
});
