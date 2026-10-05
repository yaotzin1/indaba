import type { Guard, GuardDefinition } from '@indaba/core';
import { GuardResult, GuardType, matchesAny, WorkspaceError } from '@indaba/core';
import { Git } from '../workspace/git.js';

/** Indaba's own state inside a worktree; never part of what a step "changed". */
const RUNTIME_DIRECTORY = '.indaba';

/**
 * Filesystem boundary for every runner: the step may only have changed paths matching the allowed
 * globs (`paths`). An empty list means nothing may change. Fails closed when git state cannot be read.
 */
export class DiffWithinScopeGuard implements Guard {
  readonly type: string = GuardType.DiffWithinScope;

  constructor(private readonly git: Git = new Git()) {}

  async check(guard: GuardDefinition, workdir: string): Promise<GuardResult> {
    let status: string;
    let prefix: string;
    try {
      prefix = (await this.git.run(['rev-parse', '--show-prefix'], workdir)).trim();
      status = await this.git.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], workdir);
    } catch (error) {
      if (error instanceof WorkspaceError) {
        return GuardResult.fail(`Cannot inspect git state: ${error.message}`);
      }
      throw error;
    }

    const outside = changedPaths(status)
      .map((path) => (prefix === '' ? path : path.startsWith(prefix) ? path.slice(prefix.length) : undefined))
      .filter((path) => path === undefined || !isRuntime(path))
      .filter((path) => path === undefined || !matchesAny(guard.paths, path));

    if (outside.length === 0) {
      return GuardResult.pass();
    }
    const shown = outside.map((path) => path ?? '(outside the working directory)');
    const allowed = guard.paths.length === 0 ? 'nothing' : guard.paths.join(', ');
    return GuardResult.fail(`Changes outside the allowed scope (${allowed}):\n${shown.join('\n')}`);
  }
}

function isRuntime(path: string): boolean {
  return path === RUNTIME_DIRECTORY || path.startsWith(`${RUNTIME_DIRECTORY}/`);
}

/** Paths in `git status --porcelain=v1 -z`: `XY path`, and a rename or copy is followed by its source. */
function changedPaths(status: string): string[] {
  const entries = status.split('\0').filter((entry) => entry !== '');
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? '';
    paths.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C' || entry[1] === 'R' || entry[1] === 'C') {
      i++;
      paths.push(entries[i] ?? '');
    }
  }
  return paths;
}
