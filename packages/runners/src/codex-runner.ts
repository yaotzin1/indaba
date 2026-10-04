import type { RunRequest } from '@indaba/core';
import { McpCapability, type McpCapable } from '@indaba/core';
import { AbstractCliRunner, type CliRunnerOptions } from './abstract-cli-runner.js';
import { McpConfigWriter } from './mcp.js';

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
  private readonly binary: string;
  private readonly extraArgs: readonly string[];

  constructor(options: CodexRunnerOptions = {}) {
    super(options);
    this.binary = options.binary ?? 'codex';
    this.extraArgs = options.extraArgs ?? ['--sandbox', 'workspace-write'];
  }

  mcpCapability(): McpCapability {
    return McpCapability.Injected;
  }

  protected command(request: RunRequest): readonly string[] {
    const command = [
      this.binary,
      'exec',
      ...this.extraArgs,
      ...McpConfigWriter.codexArgs(request.mcpServers ?? []),
    ];
    if (request.model !== undefined) {
      command.push('--model', request.model);
    }
    command.push(request.prompt);
    return command;
  }
}
