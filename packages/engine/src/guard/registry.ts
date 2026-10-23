import type { Described, Guard, GuardDefinition } from '@indaba/core';
import { GuardResult } from '@indaba/core';
import { DiffWithinScopeGuard } from './diff-within-scope-guard.js';
import { GitDiffEmptyGuard } from './git-diff-empty-guard.js';

export class GuardRegistry {
  private readonly guards = new Map<string, Guard>();

  constructor(guards: readonly Guard[] = []) {
    for (const guard of guards) {
      this.register(guard);
    }
  }

  static withDefaults(): GuardRegistry {
    return new GuardRegistry([new GitDiffEmptyGuard(), new DiffWithinScopeGuard()]);
  }

  /** A later registration of the same type replaces the earlier one. */
  register(guard: Guard): this {
    this.guards.set(guard.type, guard);
    return this;
  }

  has(type: string): boolean {
    return this.guards.has(type);
  }

  types(): readonly string[] {
    return [...this.guards.keys()];
  }

  /** Each guard type with its description, `""` when it has none, in the order they were registered. */
  describe(): readonly Described[] {
    return [...this.guards.values()].map((guard) => ({
      name: guard.type,
      description: guard.description ?? '',
    }));
  }

  async check(definition: GuardDefinition, workdir: string): Promise<GuardResult> {
    const guard = this.guards.get(definition.type);
    return guard === undefined
      ? GuardResult.fail(`No implementation registered for guard "${definition.type}".`)
      : await guard.check(definition, workdir);
  }
}
