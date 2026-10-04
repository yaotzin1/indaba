import type { RunRequest } from '@indaba/core';
import { AbstractCliRunner, type CliRunnerOptions } from './abstract-cli-runner.js';
import { McpCapability, type McpCapable } from './mcp.js';

export interface CursorRunnerOptions extends CliRunnerOptions {
  readonly binary?: string;
}

export class CursorRunner extends AbstractCliRunner implements McpCapable {
  readonly name = 'cursor';
  private readonly binary: string;

  constructor(options: CursorRunnerOptions = {}) {
    super(options);
    this.binary = options.binary ?? 'cursor-agent';
  }

  mcpCapability(): McpCapability {
    return McpCapability.AgentManaged;
  }

  protected command(request: RunRequest): readonly string[] {
    const command = [this.binary, '-p', request.prompt];
    if (request.model !== undefined) {
      command.push('--model', request.model);
    }
    return command;
  }
}
