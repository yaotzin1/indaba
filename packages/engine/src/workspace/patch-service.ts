import { WorkspaceError } from '@indaba/core';
import { Git } from './git.js';

/** Validates and applies unified diffs with `git apply`. */
export class PatchService {
  constructor(private readonly git: Git = new Git()) {}

  async canApply(patch: string, cwd: string): Promise<boolean> {
    if (patch.trim() === '') {
      return true;
    }
    try {
      await this.git.run(['apply', '--check', '-'], cwd, { stdin: patch });
    } catch (error) {
      if (error instanceof WorkspaceError) {
        return false;
      }
      throw error;
    }
    return true;
  }

  async apply(patch: string, cwd: string): Promise<void> {
    if (patch.trim() === '') {
      return;
    }
    await this.git.run(['apply', '--check', '-'], cwd, { stdin: patch });
    await this.git.run(['apply', '-'], cwd, { stdin: patch });
  }
}
