import type { RunRequest } from '@indaba/core';
import { McpCapability, type McpCapable, type PermissionCapability, PermissionLevel } from '@indaba/core';
import { AbstractCliRunner, type CliRunnerOptions } from './abstract-cli-runner.js';
import { afterOnly, unsupported } from './permissions.js';

export interface CursorRunnerOptions extends CliRunnerOptions {
  readonly binary?: string;
}

export class CursorRunner extends AbstractCliRunner implements McpCapable {
  readonly name = 'cursor';
  readonly description = 'The Cursor agent command line, one run per step; reads its terminal output.';
  private readonly binary: string;

  constructor(options: CursorRunnerOptions = {}) {
    super(options);
    this.binary = options.binary ?? 'cursor-agent';
  }

  mcpCapability(): McpCapability {
    return McpCapability.AgentManaged;
  }

  // The CLI is not installed where this was written: no argument is confirmed, so `read` and `full` are unsupported.
  override permissionCapabilities(): readonly PermissionCapability[] {
    return [
      unsupported(PermissionLevel.Read, 'no_read_only_argument'),
      afterOnly(PermissionLevel.Edit, 'commands_not_limited'),
      unsupported(PermissionLevel.Full, 'argument_unconfirmed'),
    ];
  }

  protected command(request: RunRequest): readonly string[] {
    const command = [this.binary, '-p', request.prompt];
    if (request.model !== undefined) {
      command.push('--model', request.model);
    }
    return command;
  }
}
