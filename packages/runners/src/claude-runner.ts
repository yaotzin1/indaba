import type { RunRequest } from '@indaba/core';
import { McpCapability, type McpCapable, type PermissionCapability, PermissionLevel } from '@indaba/core';
import { AbstractCliRunner, type CliRunnerOptions, PreparedCommand } from './abstract-cli-runner.js';
import { parseClaudeStream } from './claude-stream.js';
import { McpConfigWriter } from './mcp.js';
import { fullAccess, nativeWithGuard, withoutPermissionFlags } from './permissions.js';
import { executeProcess, ProcessRunResult, stripAnsi } from './process-runner.js';

export interface ClaudeRunnerOptions extends CliRunnerOptions {
  readonly binary?: string;
  readonly extraArgs?: readonly string[];
  /**
   * Ask Claude Code for `--output-format stream-json --verbose` and report the tokens and the cost it prints
   * (default true). `false`, or an `extraArgs` that already holds `--output-format`, keeps the plain-text call
   * and reports nothing, as before (specs/claude-code-usage).
   */
  readonly reportUsage?: boolean;
}

function choosesOutputFormat(args: readonly string[]): boolean {
  return args.some((arg) => arg === '--output-format' || arg.startsWith('--output-format='));
}

/**
 * Claude Code in print mode. Edits are auto-accepted by default because an implementer step has
 * to write files; narrow `extraArgs` if a step should be read-only.
 *
 * By default the CLI is asked for `stream-json`: its last event carries the answer, the tokens and the cost, which
 * the result then reports. That path runs on pipes (a terminal could wrap a long JSON line) and hands the answer to
 * `onOutput` once, when it is known.
 *
 * MCP servers are injected: written to a private temporary file passed with `--mcp-config`, with
 * `--strict-mcp-config` so the agent sees exactly the servers the workflow declared.
 */
export class ClaudeRunner extends AbstractCliRunner implements McpCapable {
  readonly name = 'claude-code';
  readonly description =
    'The Claude Code command line, one run per step; reads its answer, tokens and cost from the stream-json output.';
  private readonly binary: string;
  private readonly extraArgs: readonly string[] | undefined;
  private readonly reportsUsage: boolean;

  constructor(options: ClaudeRunnerOptions = {}) {
    super(options);
    this.binary = options.binary ?? 'claude';
    this.extraArgs = options.extraArgs;
    this.reportsUsage = options.reportUsage !== false && !choosesOutputFormat(options.extraArgs ?? []);
  }

  override async run(request: RunRequest, signal?: AbortSignal): Promise<ProcessRunResult> {
    if (!this.reportsUsage) {
      return await super.run(request, signal);
    }
    const prepared = await this.prepare(request);
    try {
      // The JSON lines are not the answer: hold the stream back and give the consumer the answer once.
      const { onOutput: consumer, ...quiet } = request;
      const raw = await executeProcess({
        spawner: this.spawner,
        command: prepared.command,
        request: quiet,
        usePty: false,
        clean: stripAnsi,
        signal,
      });
      const parsed = parseClaudeStream(raw.output);
      // Output that is no JSON at all (an older CLI's plain error) is shown as it came, never swallowed.
      const text = parsed.recognised ? parsed.text : raw.output;
      if (consumer !== undefined && text !== '') {
        consumer(text);
      }
      const model = parsed.model ?? request.model;
      return new ProcessRunResult(
        {
          exitCode: raw.exitCode,
          output: text,
          errorOutput: raw.errorOutput,
          durationMs: raw.durationMs,
          ...(parsed.usage !== undefined ? { usage: parsed.usage } : {}),
          ...(parsed.costUsd !== undefined ? { reportedCostUsd: parsed.costUsd } : {}),
          ...(model !== undefined ? { model } : {}),
        },
        raw.mode,
      );
    } finally {
      await prepared.cleanup();
    }
  }

  override permissionCapabilities(): readonly PermissionCapability[] {
    return [
      nativeWithGuard(PermissionLevel.Read, 'plan_mode'),
      nativeWithGuard(PermissionLevel.Edit, 'accept_edits'),
      fullAccess('bypass_permissions'),
    ];
  }

  protected override levelArguments(level: PermissionLevel): readonly string[] {
    const mode = { read: 'plan', edit: 'acceptEdits', full: 'bypassPermissions' }[level];
    return ['--permission-mode', mode];
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

  /** The flags that make the CLI print the usage; a `--verbose` the embedder already passed is not repeated. */
  private usageArguments(): readonly string[] {
    const verbose = (this.extraArgs ?? []).includes('--verbose') ? [] : ['--verbose'];
    return ['--output-format', 'stream-json', ...verbose];
  }

  private build(request: RunRequest, mcpConfigFile: string | undefined): string[] {
    // A written level comes last, so an embedder's extraArgs can never widen it (AC-07); with no level the legacy default stays.
    const permission =
      request.permissionLevel === undefined
        ? (this.extraArgs ?? ['--permission-mode', 'acceptEdits'])
        : [
            ...withoutPermissionFlags(this.extraArgs ?? [], {
              valued: ['--permission-mode'],
              bare: ['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions'],
            }),
            ...this.levelArguments(request.permissionLevel),
          ];
    const command = [
      this.binary,
      '-p',
      request.prompt,
      ...(this.reportsUsage ? this.usageArguments() : []),
      ...permission,
    ];
    if (mcpConfigFile !== undefined) {
      command.push('--mcp-config', mcpConfigFile, '--strict-mcp-config');
    }
    if (request.model !== undefined) {
      command.push('--model', request.model);
    }
    return command;
  }
}
