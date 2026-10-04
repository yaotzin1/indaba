import { WorkspaceError } from '@indaba/core';
import type { Git } from './git.js';
import type { Workspace } from './workspace.js';

export class GitWorktree implements Workspace {
  private destroyed = false;

  constructor(
    private readonly projectDir: string,
    private readonly worktreePath: string,
    private readonly git: Git,
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

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    await this.git.run(['worktree', 'remove', '--force', this.worktreePath], this.projectDir);
    await this.git.run(['worktree', 'prune'], this.projectDir);
  }
}
