import type { Guard, GuardDefinition } from '@indaba/core';
import { GuardResult, GuardType, WorkspaceError } from '@indaba/core';
import { Git } from '../workspace/git.js';

/**
 * Filesystem boundary: the step may not have modified, added or deleted anything under the guarded
 * paths (e.g. no changes to `src/` during an RFC phase). Fails closed when git state cannot be inspected.
 */
export class GitDiffEmptyGuard implements Guard {
  readonly type: string = GuardType.GitDiffEmpty;

  constructor(private readonly git: Git = new Git()) {}

  async check(guard: GuardDefinition, workdir: string): Promise<GuardResult> {
    const paths = guard.paths.length === 0 ? ['.'] : guard.paths;

    let status: string;
    try {
      status = await this.git.run(
        ['status', '--porcelain', '--untracked-files=all', '--', ...paths],
        workdir,
      );
    } catch (error) {
      if (error instanceof WorkspaceError) {
        return GuardResult.fail(`Cannot inspect git state: ${error.message}`);
      }
      throw error;
    }

    const changes = status.split('\n').filter((line) => line.trim() !== '');
    if (changes.length === 0) {
      return GuardResult.pass();
    }
    return GuardResult.fail(`Changes are not allowed under ${paths.join(', ')}:\n${changes.join('\n')}`);
  }
}
