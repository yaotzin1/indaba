import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkspaceError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { type ForkableWorkspace, Git, GitWorktreeManager, isForkable, type Workspace } from '../src/index.js';
import { makeGitRepo } from './support.js';

// specs/parallel-steps, T-08: Workspace.fork and Workspace.land against real temporary repositories.

async function run(): Promise<{ readonly space: ForkableWorkspace; readonly repo: string }> {
  const repo = await makeGitRepo();
  const space = await new GitWorktreeManager(repo).create('run');
  if (!isForkable(space)) {
    throw new Error('the git worktree must be forkable');
  }
  return { space, repo };
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const read = (dir: string, ...parts: string[]): Promise<string> => readFile(join(dir, ...parts), 'utf8');

async function worktreeCount(repo: string): Promise<number> {
  const out = await new Git().run(['worktree', 'list', '--porcelain'], repo);
  return out.split('\n').filter((line) => line.startsWith('worktree ')).length;
}

describe('fork', () => {
  it('is what a git worktree is, and a plain Workspace is not', () => {
    expect(isForkable({ path: () => '', diff: async () => '', destroy: async () => undefined })).toBe(false);
  });

  it('carries the parent change, and its own diff is only what it changes itself', async () => {
    const { space } = await run();
    await writeFile(join(space.path(), 'src', 'app.txt'), 'parent change\n');
    const child = await space.fork('a');

    expect(await read(child.path(), 'src', 'app.txt')).toBe('parent change\n');
    expect(await child.diff()).toBe('');
    await writeFile(join(child.path(), 'src', 'own.txt'), 'child only\n');
    const diff = await child.diff();
    expect(diff).toContain('own.txt');
    expect(diff).not.toContain('app.txt');
  });

  it('leaves the parent as it was, with no commit on any branch and no stray worktree entry', async () => {
    const { space, repo } = await run();
    await writeFile(join(space.path(), 'src', 'app.txt'), 'parent change\n');
    const before = await space.diff();
    const child = await space.fork('a');
    await child.destroy();

    expect(await space.diff()).toBe(before);
    expect((await new Git().run(['rev-list', '--all', '--count'], repo)).trim()).toBe('1');
    expect(await worktreeCount(repo)).toBe(2);
  });

  it('refuses a name that could leave the worktree root, and a name already used', async () => {
    const { space } = await run();
    await expect(space.fork('../escape')).rejects.toBeInstanceOf(WorkspaceError);
    await expect(space.fork('--detach')).rejects.toBeInstanceOf(WorkspaceError);
    await space.fork('a');
    await expect(space.fork('a')).rejects.toThrow(/already exists/);
  });

  it('refuses a destroyed parent', async () => {
    const { space } = await run();
    await space.destroy();
    await expect(space.fork('a')).rejects.toThrow(/destroyed/);
  });
});

describe('land', () => {
  it('lands a clean change and removes the landing worktree', async () => {
    const { space, repo } = await run();
    const child = await space.fork('a');
    await writeFile(join(child.path(), 'src', 'new.txt'), 'new\n');
    const result = await space.land(child);

    expect(result).toEqual({ ok: true });
    expect(await read(space.path(), 'src', 'new.txt')).toBe('new\n');
    expect(await worktreeCount(repo)).toBe(3);
  });

  it('lands two steps that touched different files, whatever the order they finish in', async () => {
    const { space } = await run();
    const a = await space.fork('a');
    const b = await space.fork('b');
    await writeFile(join(a.path(), 'src', 'a.txt'), 'a\n');
    await writeFile(join(b.path(), 'src', 'b.txt'), 'b\n');

    expect(await space.land(b)).toEqual({ ok: true });
    expect(await space.land(a)).toEqual({ ok: true });
    expect(await read(space.path(), 'src', 'a.txt')).toBe('a\n');
    expect(await read(space.path(), 'src', 'b.txt')).toBe('b\n');
  });

  it('merges two edits of different regions of one file', async () => {
    const { space } = await run();
    await writeFile(join(space.path(), 'src', 'app.txt'), 'one\n2\n3\n4\n5\n6\n7\n8\nnine\n');
    const a = await space.fork('a');
    const b = await space.fork('b');
    await writeFile(join(a.path(), 'src', 'app.txt'), 'ONE\n2\n3\n4\n5\n6\n7\n8\nnine\n');
    await writeFile(join(b.path(), 'src', 'app.txt'), 'one\n2\n3\n4\n5\n6\n7\n8\nNINE\n');

    expect(await space.land(a)).toEqual({ ok: true });
    expect(await space.land(b)).toEqual({ ok: true });
    expect(await read(space.path(), 'src', 'app.txt')).toBe('ONE\n2\n3\n4\n5\n6\n7\n8\nNINE\n');
  });

  it('reports a conflict with both sides, leaves the run workspace unchanged and hands back the landing', async () => {
    const { space } = await run();
    const a = await space.fork('a');
    const b = await space.fork('b');
    await writeFile(join(a.path(), 'src', 'app.txt'), 'from a\n');
    await writeFile(join(b.path(), 'src', 'app.txt'), 'from b\n');
    expect(await space.land(a)).toEqual({ ok: true });
    const before = await space.diff();

    const result = await space.land(b);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.conflicts).toEqual([{ path: 'src/app.txt', ours: 'from a', theirs: 'from b' }]);
    expect(await space.diff()).toBe(before);
    expect(await read(result.workspace.path(), 'src', 'app.txt')).toContain('<<<<<<<');
    await result.workspace.destroy();
    expect(await exists(result.workspace.path())).toBe(false);
  });

  it('lands a new file, a deleted file and a binary file', async () => {
    const { space } = await run();
    await writeFile(join(space.path(), 'src', 'gone.txt'), 'bye\n');
    const child = await space.fork('a');
    await writeFile(join(child.path(), 'src', 'bin.dat'), Buffer.from([0, 1, 2, 255, 0, 7]));
    await writeFile(join(child.path(), 'src', 'fresh.txt'), 'fresh\n');
    await new Git().run(['rm', '-q', '-f', '--', 'src/gone.txt'], child.path());

    expect(await space.land(child)).toEqual({ ok: true });
    expect(await exists(join(space.path(), 'src', 'gone.txt'))).toBe(false);
    expect(await read(space.path(), 'src', 'fresh.txt')).toBe('fresh\n');
    expect([...(await readFile(join(space.path(), 'src', 'bin.dat')))]).toEqual([0, 1, 2, 255, 0, 7]);
  });

  it('names a binary conflict without its content', async () => {
    const { space } = await run();
    await writeFile(join(space.path(), 'src', 'bin.dat'), Buffer.from([0, 1, 2]));
    const a = await space.fork('a');
    const b = await space.fork('b');
    await writeFile(join(a.path(), 'src', 'bin.dat'), Buffer.from([0, 9, 9]));
    await writeFile(join(b.path(), 'src', 'bin.dat'), Buffer.from([0, 8, 8]));
    await space.land(a);

    const result = await space.land(b);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflicts.map((hunk) => hunk.path)).toEqual(['src/bin.dat']);
      await result.workspace.destroy();
    }
  });

  it('bounds a large hunk and strips control characters before it can reach a prompt', async () => {
    const { space } = await run();
    const a = await space.fork('a');
    const b = await space.fork('b');
    await writeFile(join(a.path(), 'src', 'app.txt'), `${'x'.repeat(5000)}\u001b[31m\n`);
    await writeFile(join(b.path(), 'src', 'app.txt'), 'plain\n');
    await space.land(a);

    const result = await space.land(b);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const [hunk] = result.conflicts;
      expect(hunk?.ours.length).toBeLessThan(2100);
      expect(hunk?.ours).not.toContain('\u001b');
      expect(hunk?.ours.endsWith('[cut]')).toBe(true);
      await result.workspace.destroy();
    }
  });

  it('treats a step that changed nothing as landed', async () => {
    const { space, repo } = await run();
    const child = await space.fork('a');
    expect(await space.land(child)).toEqual({ ok: true });
    expect(await worktreeCount(repo)).toBe(3);
  });

  it('shows a guard in a fork only the fork change, not the parent change', async () => {
    const { space } = await run();
    await mkdir(join(space.path(), 'docs'));
    await writeFile(join(space.path(), 'docs', 'note.txt'), 'parent work\n');
    const child = await space.fork('a');
    await writeFile(join(child.path(), 'src', 'mine.txt'), 'mine\n');

    const status = await new Git().run(['status', '--porcelain'], child.path());
    expect(status).toContain('src/mine.txt');
    expect(status).not.toContain('docs/note.txt');
  });

  it('removes a landing that failed for a reason other than a conflict', async () => {
    const { space, repo } = await run();
    const broken: Workspace = {
      path: () => space.path(),
      diff: async () => 'diff --git a/nope b/nope\n--- a/nope\n+++ b/nope\n@@ -1 +1 @@\n-x\n+y\n',
      destroy: async () => undefined,
    };
    await expect(space.land(broken)).rejects.toBeInstanceOf(WorkspaceError);
    expect(await worktreeCount(repo)).toBe(2);
  });
});
