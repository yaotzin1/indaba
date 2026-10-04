import type { RunRequest } from '@indaba/core';
import { McpCapability, type McpCapable } from '@indaba/core';
import { AbstractCliRunner, type CliRunnerOptions } from './abstract-cli-runner.js';

export interface CommandRunnerOptions extends CliRunnerOptions {
  readonly mcp?: McpCapability;
}

/**
 * A CLI agent described by configuration: the literal `{prompt}` and `{model}` tokens in the
 * argument template are replaced, one whole argument at a time. Used for engines whose command
 * line is configurable rather than built in.
 */
export class CommandRunner extends AbstractCliRunner implements McpCapable {
  private readonly mcp: McpCapability;

  /** @param template e.g. ['codex', 'exec', '{prompt}'] */
  constructor(
    readonly name: string,
    private readonly template: readonly string[],
    options: CommandRunnerOptions = {},
  ) {
    super(options);
    this.mcp = options.mcp ?? McpCapability.None;
  }

  mcpCapability(): McpCapability {
    return this.mcp;
  }

  protected command(request: RunRequest): readonly string[] {
    return this.template.map((arg) => {
      if (arg === '{prompt}') {
        return request.prompt;
      }
      return arg === '{model}' ? (request.model ?? '') : arg;
    });
  }
}
