import type { RunRequest } from '@indaba/core';
import { McpCapability, type McpCapable, type PermissionCapability, PermissionLevel } from '@indaba/core';
import { AbstractCliRunner, type CliRunnerOptions } from './abstract-cli-runner.js';
import { McpConfigWriter } from './mcp.js';
import { nativeWithGuard, unsupported, withoutPermissionFlags } from './permissions.js';

export interface CodexRunnerOptions extends CliRunnerOptions {
  readonly binary?: string;
  readonly extraArgs?: readonly string[];
}

/**
 * OpenAI Codex CLI in non-interactive mode (`codex exec`). Codex is read-only by default, so the
 * workspace-write sandbox is requested: an implementer step has to edit files, and the sandbox
 * still confines the edits to the working directory. Authenticate beforehand (`codex login`, or
 * CODEX_API_KEY in the environment).
 *
 * MCP servers are injected as `-c mcp_servers.<name>.*` configuration overrides.
 */
export class CodexRunner extends AbstractCliRunner implements McpCapable {
  readonly name = 'codex';
  readonly description = 'The Codex command line, one run per step; reads its terminal output.';
  private readonly binary: string;
  private readonly extraArgs: readonly string[] | undefined;

  constructor(options: CodexRunnerOptions = {}) {
    super(options);
    this.binary = options.binary ?? 'codex';
    this.extraArgs = options.extraArgs;
  }

  // `read-only` and `danger-full-access` are not offered: the CLI is not installed where this was written, and a level whose
  // argument cannot be confirmed is unsupported, never a guess (specs/agent-permissions, C-03).
  override permissionCapabilities(): readonly PermissionCapability[] {
    return [
      unsupported(PermissionLevel.Read, 'argument_unconfirmed'),
      nativeWithGuard(PermissionLevel.Edit, 'commands_not_limited'),
      unsupported(PermissionLevel.Full, 'argument_unconfirmed'),
    ];
  }

  protected override levelArguments(level: PermissionLevel): readonly string[] {
    return level === PermissionLevel.Edit ? ['--sandbox', 'workspace-write'] : [];
  }

  mcpCapability(): McpCapability {
    return McpCapability.Injected;
  }

  private permissionArguments(request: RunRequest): readonly string[] {
    return request.permissionLevel === undefined
      ? (this.extraArgs ?? ['--sandbox', 'workspace-write'])
      : [
          ...withoutPermissionFlags(this.extraArgs ?? [], {
            valued: ['--sandbox', '--ask-for-approval', '-s', '-a'],
            bare: ['--full-auto', '--dangerously-bypass-approvals-and-sandbox'],
          }),
          ...this.levelArguments(request.permissionLevel),
        ];
  }

  protected command(request: RunRequest): readonly string[] {
    const command = [
      this.binary,
      'exec',
      ...this.permissionArguments(request),
      ...McpConfigWriter.codexArgs(request.mcpServers ?? []),
    ];
    if (request.model !== undefined) {
      command.push('--model', request.model);
    }
    command.push(request.prompt);
    return command;
  }
}
