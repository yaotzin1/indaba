import type { RunRequest } from '@indaba/core';
import { McpCapability, type McpCapable, type PermissionCapability, PermissionLevel } from '@indaba/core';
import { AbstractCliRunner, type CliRunnerOptions } from './abstract-cli-runner.js';
import { denialWindows, fullAccess, nativeWithGuard } from './permissions.js';

/** The message `agy -p` prints, and exits 0, when a tool needed a permission that headless mode cannot ask for (observed 2026-10-23). */
const REFUSED = /required the \S+ permission that headless mode cannot prompt for/;

export interface AntigravityRunnerOptions extends CliRunnerOptions {
  readonly binary?: string;
  readonly extraArgs?: readonly string[];
}

/**
 * Google Antigravity CLI (`agy`) in headless print mode. Headless, it refuses a tool that needs a permission and still exits 0
 * (observed once for `write_file`, 2026-10-23), so a step must write a `permissions.level` for Indaba to pass `--mode`; with no
 * level it adds nothing, as before. Shell commands need a grant in its settings.json.
 * Authenticate once interactively first: headless runs use the cached credentials.
 */
export class AntigravityRunner extends AbstractCliRunner implements McpCapable {
  readonly name = 'antigravity';
  readonly description = 'The Antigravity command line, one run per step; reads its terminal output.';
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

  override permissionCapabilities(): readonly PermissionCapability[] {
    return [
      nativeWithGuard(PermissionLevel.Read, 'plan_mode'),
      nativeWithGuard(PermissionLevel.Edit, 'accept_edits'),
      fullAccess('skip_permissions'),
    ];
  }

  override permissionDenied(output: string): boolean {
    return denialWindows(output).some((window) => REFUSED.test(window));
  }

  override get canRecogniseDenial(): boolean {
    return true;
  }

  protected override levelArguments(level: PermissionLevel): readonly string[] {
    switch (level) {
      case PermissionLevel.Read:
        return ['--mode', 'plan'];
      case PermissionLevel.Edit:
        return ['--mode', 'accept-edits'];
      case PermissionLevel.Full:
        return ['--dangerously-skip-permissions'];
    }
  }

  protected command(request: RunRequest): readonly string[] {
    const command = [
      this.binary,
      ...this.extraArgs,
      ...(request.permissionLevel === undefined ? [] : this.levelArguments(request.permissionLevel)),
    ];
    if (request.model !== undefined) {
      command.push('--model', request.model);
    }
    command.push('-p', request.prompt);
    return command;
  }
}
