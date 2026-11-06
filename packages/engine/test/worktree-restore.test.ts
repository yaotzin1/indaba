import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkspaceError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { Git, GitWorktreeManager, isRestorable, type RestorableWorkspace } from '../src/index.js';
import { makeGitRepo } from './support.js';

// specs/step-stalls, release 2: the restore of a worktree after a stalled attempt (AC-07, C-06, section 6).

const IDENTITY = [
  '-c',
  'user.name=Indaba Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
];

async function worktree(): Promise<{
  readonly space: RestorableWorkspace;
  readonly dir: string;
  readonly git: Git;
}> {
  const repo = await makeGitRepo();
  const space = await new GitWorktreeManager(repo).create('t1');
  if (!isRestorable(space)) {
    throw new Error('the git worktree must be restorable');
  }
  return { space, dir: space.path(), git: new Git() };
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

describe('RestorableWorkspace on a git worktree', () => {
  it('is what a git worktree is, and a plain Workspace is not', () => {
    expect(isRestorable({ path: () => '', diff: async () => '', destroy: async () => undefined })).toBe(
      false,
    );
  });

  it('puts a tracked file back and removes a file the attempt created', async () => {
    const { space, dir } = await worktree();
    const checkpoint = await space.checkpoint();
    await writeFile(join(dir, 'src', 'app.txt'), 'changed by the attempt\n');
    await writeFile(join(dir, 'src', 'new.txt'), 'created by the attempt\n');
    await space.restore(checkpoint);

    expect(await readFile(join(dir, 'src', 'app.txt'), 'utf8')).toBe('v1\n');
    expect(await exists(join(dir, 'src', 'new.txt'))).toBe(false);
  });

  it('puts back a file the attempt deleted', async () => {
    const { space, dir } = await worktree();
    const checkpoint = await space.checkpoint();
    await writeFile(join(dir, 'src', 'app.txt'), 'x');
    await import('node:fs/promises').then((fs) => fs.rm(join(dir, 'src', 'app.txt')));
    await space.restore(checkpoint);

    expect(await readFile(join(dir, 'src', 'app.txt'), 'utf8')).toBe('v1\n');
  });

  it('keeps what earlier steps left uncommitted, including after diff() staged it', async () => {
    const { space, dir } = await worktree();
    await mkdir(join(dir, 'out'), { recursive: true });
    await writeFile(join(dir, 'out', 'spec.md'), 'written by an earlier step\n');
    await space.diff(); // the engine's patch export runs `git add -A`, so this file is now in the index
    await writeFile(join(dir, 'out', 'notes.md'), 'untracked and never staged\n');

    const checkpoint = await space.checkpoint();
    await writeFile(join(dir, 'out', 'spec.md'), 'overwritten by the stalled attempt\n');
    await writeFile(join(dir, 'out', 'notes.md'), 'overwritten too\n');
    await writeFile(join(dir, 'out', 'partial.md'), 'half done\n');
    await space.restore(checkpoint);

    expect(await readFile(join(dir, 'out', 'spec.md'), 'utf8')).toBe('written by an earlier step\n');
    expect(await readFile(join(dir, 'out', 'notes.md'), 'utf8')).toBe('untracked and never staged\n');
    expect(await exists(join(dir, 'out', 'partial.md'))).toBe(false);
  });

  it('puts HEAD back when the attempt committed', async () => {
    const { space, dir, git } = await worktree();
    const before = (await git.run(['rev-parse', 'HEAD'], dir)).trim();
    const checkpoint = await space.checkpoint();
    await writeFile(join(dir, 'src', 'app.txt'), 'committed by the attempt\n');
    await git.run(['add', '-A'], dir);
    await git.run([...IDENTITY, 'commit', '-q', '-m', 'attempt'], dir);
    await space.restore(checkpoint);

    expect((await git.run(['rev-parse', 'HEAD'], dir)).trim()).toBe(before);
    expect(await readFile(join(dir, 'src', 'app.txt'), 'utf8')).toBe('v1\n');
    expect((await git.run(['status', '--porcelain'], dir)).trim()).toBe('');
  });

  it('never touches an ignored file', async () => {
    const { space, dir } = await worktree();
    await writeFile(join(dir, '.gitignore'), 'cache/\n');
    await mkdir(join(dir, 'cache'), { recursive: true });
    await writeFile(join(dir, 'cache', 'keep.bin'), 'before');
    const checkpoint = await space.checkpoint();
    await writeFile(join(dir, 'cache', 'keep.bin'), 'during');
    await writeFile(join(dir, 'cache', 'made.bin'), 'during');
    await space.restore(checkpoint);

    expect(await readFile(join(dir, 'cache', 'keep.bin'), 'utf8')).toBe('during');
    expect(await exists(join(dir, 'cache', 'made.bin'))).toBe(true);
  });

  it('leaves Indaba runtime state alone, ignored or not', async () => {
    const { space, dir } = await worktree();
    await mkdir(join(dir, '.indaba', 'artifacts'), { recursive: true });
    await writeFile(join(dir, '.indaba', 'artifacts', 'plan.md'), 'from an earlier step');
    const checkpoint = await space.checkpoint();
    await writeFile(join(dir, 'src', 'x.txt'), 'x');
    await space.restore(checkpoint);

    expect(await readFile(join(dir, '.indaba', 'artifacts', 'plan.md'), 'utf8')).toBe('from an earlier step');
  });

  it('can restore the same checkpoint twice', async () => {
    const { space, dir } = await worktree();
    const checkpoint = await space.checkpoint();
    for (const text of ['one', 'two']) {
      await writeFile(join(dir, 'src', 'app.txt'), text);
      await space.restore(checkpoint);
      expect(await readFile(join(dir, 'src', 'app.txt'), 'utf8')).toBe('v1\n');
    }
  });
});

describe('a checkpoint is data, never trusted (section 6)', () => {
  it.each([
    ['an option', { head: '--upload-pack=x', tree: 'a'.repeat(40) }],
    ['a short hash', { head: 'abc', tree: 'a'.repeat(40) }],
    ['an uppercase hash', { head: 'A'.repeat(40), tree: 'a'.repeat(40) }],
    ['a revision expression', { head: 'HEAD~1', tree: 'a'.repeat(40) }],
    ['a missing tree', { head: 'a'.repeat(40) }],
    ['nothing', {}],
  ])('refuses %s', async (_label, bad) => {
    const { space } = await worktree();
    await expect(space.restore(bad)).rejects.toBeInstanceOf(WorkspaceError);
  });

  it('refuses a checkpoint after the workspace is destroyed', async () => {
    const { space } = await worktree();
    const checkpoint = await space.checkpoint();
    await space.destroy();
    await expect(space.restore(checkpoint)).rejects.toBeInstanceOf(WorkspaceError);
    await expect(space.checkpoint()).rejects.toBeInstanceOf(WorkspaceError);
  });
});
