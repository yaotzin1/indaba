import type { RunRequest } from '@indaba/core';
import { McpCapability, type McpCapable } from '@indaba/core';
import { AbstractCliRunner, type CliRunnerOptions } from './abstract-cli-runner.js';

export interface OpenCodeRunnerOptions extends CliRunnerOptions {
  readonly binary?: string;
  readonly extraArgs?: readonly string[];
}

/**
 * OpenCode (`opencode run`) without its terminal interface. This is the last-resort transport: prefer
 * the `acp` runner with `agent: "opencode"`, which has a permission gate and structured events.
 * Indaba never adds `--auto` (auto-approving permissions that are not denied); pass it through
 * `extraArgs` when that is wanted. Credentials are OpenCode's own (`opencode auth login`, or the
 * provider key in the environment). MCP servers come from OpenCode's configuration.
 */
export class OpenCodeRunner extends AbstractCliRunner implements McpCapable {
  readonly name = 'opencode';
  private readonly binary: string;
  private readonly extraArgs: readonly string[];

  constructor(options: OpenCodeRunnerOptions = {}) {
    super(options);
    this.binary = options.binary ?? 'opencode';
    this.extraArgs = options.extraArgs ?? [];
  }

  mcpCapability(): McpCapability {
    return McpCapability.AgentManaged;
  }

  protected command(request: RunRequest): readonly string[] {
    const command = [this.binary, 'run', ...this.extraArgs];
    if (request.model !== undefined) {
      command.push('--model', request.model);
    }
    command.push(request.prompt);
    return command;
  }
}
