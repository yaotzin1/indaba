import type { SkippedRunner } from '../runner/index.js';

export class IndabaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IndabaError';
  }
}

export class InvalidTransitionError extends IndabaError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvalidTransitionError';
  }
}

export class RunnerError extends IndabaError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RunnerError';
  }
}

/**
 * A runner could not run at all: nothing was sent to the agent, so the next runner of a chain may be
 * tried safely. A runner that has already been given the prompt must never throw this.
 */
export class RunnerUnavailableError extends RunnerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RunnerUnavailableError';
  }
}

/** Every runner of a chain was unavailable. The step fails; it is not a reason to try anything else. */
export class RunnerChainExhaustedError extends RunnerError {
  readonly skipped: readonly SkippedRunner[];

  constructor(skipped: readonly SkippedRunner[], options?: ErrorOptions) {
    super(
      `No runner could run:\n - ${skipped.map((s) => `${s.runner}: ${s.reason}`).join('\n - ')}`,
      options,
    );
    this.name = 'RunnerChainExhaustedError';
    this.skipped = [...skipped];
  }
}

export class WorkspaceError extends IndabaError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WorkspaceError';
  }
}

export class WorkflowValidationError extends IndabaError {
  readonly problems: readonly string[];

  constructor(problems: readonly string[], options?: ErrorOptions) {
    super(`Invalid workflow:\n - ${problems.join('\n - ')}`, options);
    this.name = 'WorkflowValidationError';
    this.problems = [...problems];
  }
}

export class McpUnavailableError extends IndabaError {
  /** One line per step/server that cannot be provided. */
  readonly problems: readonly string[];

  constructor(problems: readonly string[], options?: ErrorOptions) {
    super(`Required MCP servers cannot be provided:\n - ${problems.join('\n - ')}`, options);
    this.name = 'McpUnavailableError';
    this.problems = [...problems];
  }
}
