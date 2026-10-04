import type { RunRequest } from '@indaba/core';
import { AbstractCliRunner, type CliRunnerOptions } from './abstract-cli-runner.js';
import { McpCapability, type McpCapable } from './mcp.js';

export interface AntigravityRunnerOptions extends CliRunnerOptions {
  readonly binary?: string;
  readonly extraArgs?: readonly string[];
}

/**
 * Google Antigravity CLI (`agy`) in headless print mode. File edits in the workspace are
 * auto-approved by the CLI; shell commands need a grant in its settings.json, or an explicit
 * permission-skipping flag passed through `extraArgs`, which Indaba never adds on its own.
 * Authenticate once interactively first: headless runs use the cached credentials.
 */
export class AntigravityRunner extends AbstractCliRunner implements McpCapable {
  readonly name = 'antigravity';
  private readonly binary: string;
  private readonly extraArgs: readonly string[];

  constructor(options: AntigravityRunnerOptions = {}) {
    super(options);
    this.binary = options.binary ?? 'agy';
    this.extraArgs = options.extraArgs ?? [];
  }

  mcpCapability(): McpCapability {
    return McpCapability.AgentManaged;
  }

  protected command(request: RunRequest): readonly string[] {
    const command = [this.binary, ...this.extraArgs];
    if (request.model !== undefined) {
      command.push('--model', request.model);
    }
    command.push('-p', request.prompt);
    return command;
  }
}
