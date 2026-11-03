import { rm } from 'node:fs/promises';
import { WorkspaceError } from '@indaba/core';
import type { Git } from './git.js';
import type { Workspace } from './workspace.js';

/** How teardown copes with a folder that something still holds open (common on Windows). */
export interface TeardownOptions {
  /** Tries of `git worktree remove` before the folder is deleted directly. At least 1. Default 4. */
  readonly attempts?: number;
  /** Wait before the second try; it doubles each time. Default 250 ms. */
  readonly delayMs?: number;
  /** Injected so a test needs no real wait. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export class GitWorktree implements Workspace {
  private destroyed = false;

  constructor(
    private readonly projectDir: string,
    private readonly worktreePath: string,
    private readonly git: Git,
    private readonly teardown: TeardownOptions = {},
  ) {}

  path(): string {
    return this.worktreePath;
  }

  async diff(): Promise<string> {
    if (this.destroyed) {
      throw new WorkspaceError('The workspace has been destroyed.');
    }
    // Stage everything (a worktree's index is private to it) so new files are included.
    // .indaba holds runtime state, never part of a change.
    await this.git.run(['add', '-A', '--', '.', ':(exclude).indaba'], this.worktreePath);
    return await this.git.run(['diff', '--cached', '--binary', 'HEAD'], this.worktreePath);
  }

  /**
   * Removes the worktree. A handle another process still holds can make `git worktree remove` fail for a moment, so it
   * is tried a few times with a growing wait. If it keeps failing, the folder (which this class created, under the
   * confined worktree root) is deleted directly and the registration pruned. Only when that fails too does it throw.
   */
  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    const attempts = Math.max(1, this.teardown.attempts ?? 4);
    const sleep = this.teardown.sleep ?? defaultSleep;
    let wait = this.teardown.delayMs ?? 250;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.git.run(['worktree', 'remove', '--force', this.worktreePath], this.projectDir);
        await this.git.run(['worktree', 'prune'], this.projectDir);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await sleep(wait);
          wait *= 2;
        }
      }
    }
    try {
      await rm(this.worktreePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      await this.git.run(['worktree', 'prune'], this.projectDir);
    } catch {
      // Report the git failure, which names the folder and says why; the second error adds nothing.
      throw lastError instanceof Error
        ? lastError
        : new WorkspaceError('The workspace could not be removed.');
    }
  }
}
