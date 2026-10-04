import type { Guard, GuardDefinition } from '@indaba/core';
import { GuardResult } from '@indaba/core';
import { GitDiffEmptyGuard } from './git-diff-empty-guard.js';

export class GuardRegistry {
  private readonly guards = new Map<string, Guard>();

  constructor(guards: readonly Guard[] = []) {
    for (const guard of guards) {
      this.register(guard);
    }
  }

  static withDefaults(): GuardRegistry {
    return new GuardRegistry([new GitDiffEmptyGuard()]);
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

  async check(definition: GuardDefinition, workdir: string): Promise<GuardResult> {
    const guard = this.guards.get(definition.type);
    return guard === undefined
      ? GuardResult.fail(`No implementation registered for guard "${definition.type}".`)
      : await guard.check(definition, workdir);
  }
}
