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
