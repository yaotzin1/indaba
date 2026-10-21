import type { Logger, LogSink } from '../logging/logger.js';
import type { Adjudicator } from '../mesh/adjudicator.js';
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
  /** Make `name` usable as a step's `arbiter`. */
  registerAdjudicator(name: string, adjudicator: Adjudicator): void;
  /** Listen to an engine event class (`StepStatusChanged`, `SpanStarted`, `SpanEnded`, ...). */
  addListener<E extends object>(
    type: abstract new (...args: never[]) => E,
    listener: (event: E) => unknown,
  ): void;
  /**
   * The logger of the command, the same one the built-ins write through (specs/logging, US-03). Records go through
   * the same redaction and sinks. Optional only so a host written before it existed still type-checks; the `indaba`
   * command line always provides one.
   */
  readonly logger?: Logger;
  /**
   * Adds a place the command's records go (specs/logging, AC-10). The sink receives the same redacted records as the
   * built-in file and standard-error sinks, and is isolated the same way: one that throws is dropped after one warning.
   * Optional so a host written before it existed still type-checks; the `indaba` command line always provides it.
   */
  registerLogSink?(sink: LogSink): void;
}

/** An extension package default-exports one of these. Core never learns what plugins exist. */
export interface Plugin {
  readonly name: string;
  /**
   * Sinks this plugin adds, registered before `register` is called, so the plugin's own first records reach them.
   * The same as calling `host.registerLogSink` for each one.
   */
  readonly logSinks?: readonly LogSink[];
  register(host: PluginHost): void | Promise<void>;
}
