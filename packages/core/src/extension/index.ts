import type { Runner } from '../runner/index.js';
import type { GuardDefinition } from '../workflow/model.js';

/** The verdict of a guard. Built with `pass()` or `fail(message)`. */
export class GuardResult {
  private constructor(
    readonly passed: boolean,
    readonly message: string | undefined,
  ) {}

  static pass(): GuardResult {
    return new GuardResult(true, undefined);
  }

  static fail(message: string): GuardResult {
    return new GuardResult(false, message);
  }
}

/** A quality gate a workflow step can declare. Add one by registering it from a plugin. */
export interface Guard {
  /** The `type` a workflow file uses to select this guard. */
  readonly type: string;
  check(guard: GuardDefinition, workdir: string): Promise<GuardResult>;
}

/**
 * What a plugin may extend. The host is the only thing a plugin receives: it has no access a
 * third-party runner or guard could not have, so a built-in is never privileged over an extension.
 */
export interface PluginHost {
  registerRunner(runner: Runner): void;
  registerGuard(guard: Guard): void;
  /** Listen to an engine event class (`StepStatusChanged`, `SpanStarted`, `SpanEnded`, ...). */
  addListener<E extends object>(
    type: abstract new (...args: never[]) => E,
    listener: (event: E) => unknown,
  ): void;
}

/** An extension package default-exports one of these. Core never learns what plugins exist. */
export interface Plugin {
  readonly name: string;
  register(host: PluginHost): void | Promise<void>;
}
