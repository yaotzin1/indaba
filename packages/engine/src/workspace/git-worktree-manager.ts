import { access, mkdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { WorkspaceError } from '@indaba/core';
import { Git } from './git.js';
import { GitWorktree } from './git-worktree.js';
import type { Workspace, WorkspaceManager } from './workspace.js';

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** Creates detached worktrees under `<project>/.indaba/worktrees/<taskId>[-<variant>]`. */
export class GitWorktreeManager implements WorkspaceManager {
  constructor(
    private readonly projectDir: string,
    private readonly git: Git = new Git(),
  ) {}

  async create(taskId: string, variant?: string): Promise<Workspace> {
    const name = this.safeName(taskId) + (variant === undefined ? '' : `-${this.safeName(variant)}`);
    const root = resolve(this.projectDir, '.indaba', 'worktrees');
    const path = join(root, name);
    if (!isInside(root, resolve(path))) {
      throw new WorkspaceError(`Unsafe task or variant name "${name}".`);
    }

    if (await exists(path)) {
      throw new WorkspaceError(`Worktree path already exists: ${path}`);
    }
    try {
      await mkdir(root, { recursive: true });
    } catch {
      throw new WorkspaceError(`Cannot create ${root}`);
    }

    await this.git.run(['worktree', 'add', '--detach', path, 'HEAD'], this.projectDir);
    return new GitWorktree(this.projectDir, path, this.git);
  }

  private safeName(value: string): string {
    if (!SAFE_NAME.test(value) || value.includes('..')) {
      throw new WorkspaceError(`Unsafe task or variant name "${value}".`);
    }
    return value;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
