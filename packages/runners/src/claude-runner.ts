import type { RunRequest } from '@indaba/core';
import { McpCapability, type McpCapable } from '@indaba/core';
import { AbstractCliRunner, type CliRunnerOptions, PreparedCommand } from './abstract-cli-runner.js';
import { McpConfigWriter } from './mcp.js';

export interface ClaudeRunnerOptions extends CliRunnerOptions {
  readonly binary?: string;
  readonly extraArgs?: readonly string[];
}

/**
 * Claude Code in print mode. Edits are auto-accepted by default because an implementer step has
 * to write files; narrow `extraArgs` if a step should be read-only.
 *
 * MCP servers are injected: written to a private temporary file passed with `--mcp-config`, with
 * `--strict-mcp-config` so the agent sees exactly the servers the workflow declared.
 */
export class ClaudeRunner extends AbstractCliRunner implements McpCapable {
  readonly name = 'claude-code';
  private readonly binary: string;
  private readonly extraArgs: readonly string[];

  constructor(options: ClaudeRunnerOptions = {}) {
    super(options);
    this.binary = options.binary ?? 'claude';
    this.extraArgs = options.extraArgs ?? ['--permission-mode', 'acceptEdits'];
  }

  mcpCapability(): McpCapability {
    return McpCapability.Injected;
  }

  protected command(request: RunRequest): readonly string[] {
    return this.build(request, undefined);
  }

  protected override async prepare(request: RunRequest): Promise<PreparedCommand> {
    if (request.mcpServers === undefined || request.mcpServers.length === 0) {
      return new PreparedCommand(this.build(request, undefined));
    }
    const config = await McpConfigWriter.writeClaudeFile(request.mcpServers);
    return new PreparedCommand(this.build(request, config.file), [config.file], [config.directory]);
  }

  private build(request: RunRequest, mcpConfigFile: string | undefined): string[] {
    const command = [this.binary, '-p', request.prompt, ...this.extraArgs];
    if (mcpConfigFile !== undefined) {
      command.push('--mcp-config', mcpConfigFile, '--strict-mcp-config');
    }
    if (request.model !== undefined) {
      command.push('--model', request.model);
    }
    return command;
  }
}
