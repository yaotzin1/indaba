import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkspaceError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { Git, GitWorktree } from '../src/index.js';
import { makeTempDir } from './support.js';

/** A git that records its calls and fails `remove` (and optionally `prune`) on demand. */
class ScriptedGit extends Git {
  readonly calls: string[] = [];
  removeFailures: number;
  pruneFails: boolean;

  constructor(removeFailures: number, pruneFails = false) {
    super();
    this.removeFailures = removeFailures;
    this.pruneFails = pruneFails;
  }

  override async run(args: readonly string[]): Promise<string> {
    const verb = args.slice(0, 2).join(' ');
    this.calls.push(verb);
    if (verb === 'worktree remove' && this.removeFailures > 0) {
      this.removeFailures -= 1;
      throw new WorkspaceError('error: failed to delete: Permission denied');
    }
    if (verb === 'worktree prune' && this.pruneFails) {
      throw new WorkspaceError('prune failed');
    }
    return '';
  }
}

async function folder(): Promise<string> {
  const path = join(await makeTempDir(), 'task-1');
  await mkdir(join(path, 'deep'), { recursive: true });
  await writeFile(join(path, 'deep', 'file.txt'), 'x');
  return path;
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe('worktree teardown (#110)', () => {
  it('retries a refused removal with a doubling wait, then succeeds', async () => {
    const git = new ScriptedGit(2);
    const waits: number[] = [];
    const path = await folder();
    const ws = new GitWorktree('/p', path, git, { sleep: async (ms) => void waits.push(ms) });
    await ws.destroy();
    expect(waits).toEqual([250, 500]);
    expect(git.calls).toEqual(['worktree remove', 'worktree remove', 'worktree remove', 'worktree prune']);
    expect(await exists(path)).toBe(true); // git was trusted to delete it; the fallback was not needed
  });

  it('deletes the folder itself and prunes when git keeps refusing', async () => {
    const git = new ScriptedGit(99);
    const waits: number[] = [];
    const path = await folder();
    const ws = new GitWorktree('/p', path, git, {
      attempts: 3,
      delayMs: 10,
      sleep: async (ms) => void waits.push(ms),
    });
    await ws.destroy();
    expect(waits).toEqual([10, 20]);
    expect(git.calls).toEqual(['worktree remove', 'worktree remove', 'worktree remove', 'worktree prune']);
    expect(await exists(path)).toBe(false);
  });

  it('copes with a folder git already unregistered but left behind', async () => {
    const git = new ScriptedGit(99);
    const path = await folder();
    await new GitWorktree('/p', path, git, { attempts: 1 }).destroy();
    expect(await exists(path)).toBe(false);
  });

  it('with one attempt does not wait', async () => {
    const waits: number[] = [];
    await new GitWorktree('/p', await folder(), new ScriptedGit(99), {
      attempts: 1,
      sleep: async (ms) => void waits.push(ms),
    }).destroy();
    expect(waits).toEqual([]);
  });

  it('still throws the git error when the fallback cannot finish either', async () => {
    const ws = new GitWorktree('/p', await folder(), new ScriptedGit(99, true), { attempts: 1 });
    await expect(ws.destroy()).rejects.toThrow('Permission denied');
  });

  it('is idempotent', async () => {
    const git = new ScriptedGit(0);
    const ws = new GitWorktree('/p', await folder(), git);
    await ws.destroy();
    await ws.destroy();
    expect(git.calls).toEqual(['worktree remove', 'worktree prune']);
  });
});
