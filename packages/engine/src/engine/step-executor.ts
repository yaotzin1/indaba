import { lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Runner, RunRequest, RunResult, Span, StepDefinition, WorkflowDefinition } from '@indaba/core';
import {
  ConsensusArbiter,
  DEFAULT_TIMEOUT_SECONDS,
  DecisionType,
  IndabaError,
  isConsensusStep,
  isShellStep,
  McpUnavailableError,
  RunnerParticipant,
  roleOf,
  SHELL_RUNNER,
  SpanStatus,
  Tracer,
} from '@indaba/core';
import type { GuardRegistry } from '../guard/registry.js';
import type { McpIssue, McpResolution, RunnerLookup } from './mcp.js';
import { McpPlanner } from './mcp.js';
import { StepOutcome } from './outcome.js';
import { PromptBuilder } from './prompt-builder.js';

export interface StepExecutorOptions {
  readonly runners: RunnerLookup;
  readonly guards: GuardRegistry;
  readonly tracer: Tracer;
  readonly prompts?: PromptBuilder;
  readonly arbiter?: ConsensusArbiter;
  readonly timeoutSeconds?: number;
}

export interface StepRunOptions {
  readonly feedback?: string | undefined;
  readonly onOutput?: ((chunk: string) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Executes one step's work (run) and then checks its postconditions (validate).
 * Retry, ordering and state transitions belong to the engine.
 */
export class StepExecutor {
  private readonly runners: RunnerLookup;
  private readonly guards: GuardRegistry;
  private readonly tracer: Tracer;
  private readonly prompts: PromptBuilder;
  private readonly arbiter: ConsensusArbiter;
  private readonly timeoutSeconds: number;
  private readonly mcp: McpPlanner;

  constructor(options: StepExecutorOptions) {
    this.runners = options.runners;
    this.guards = options.guards;
    this.tracer = options.tracer;
    this.prompts = options.prompts ?? new PromptBuilder();
    this.arbiter = options.arbiter ?? new ConsensusArbiter();
    this.timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
    this.mcp = new McpPlanner(options.runners);
  }

  mcpIssues(workflow: WorkflowDefinition): McpIssue[] {
    return this.mcp.preflight(workflow);
  }

  async run(
    step: StepDefinition,
    workflow: WorkflowDefinition,
    workdir: string,
    span: Span,
    options: StepRunOptions = {},
  ): Promise<StepOutcome> {
    try {
      if (isShellStep(step)) {
        return await this.runShell(step, workdir, span, options);
      }
      if (isConsensusStep(step)) {
        return await this.runConsensus(step, workflow, workdir, span, options);
      }
      return await this.runAgent(step, workflow, workdir, span, options);
    } catch (error) {
      if (options.signal?.aborted === true) {
        return StepOutcome.cancelled();
      }
      if (error instanceof IndabaError) {
        return StepOutcome.failed(error.message);
      }
      throw error;
    }
  }

  async validate(step: StepDefinition, workdir: string): Promise<StepOutcome> {
    for (const output of step.outputs) {
      const path = await this.resolvePath(workdir, output);
      if (path === undefined || !(await isFile(path))) {
        return StepOutcome.failed(`Expected output "${output}" was not produced.`);
      }
    }

    for (const guard of step.guards) {
      const result = await this.guards.check(guard, workdir);
      if (!result.passed) {
        return StepOutcome.failed(`Guard ${guard.type} failed: ${result.message ?? ''}`);
      }
    }
    return StepOutcome.ok();
  }

  /**
   * Resolves a workflow-relative path, refusing anything that escapes the working directory, by
   * lexical form and, for something that exists, by where its symlinks lead.
   */
  async resolvePath(workdir: string, relativePath: string): Promise<string | undefined> {
    if (relativePath.includes('\0')) {
      return undefined;
    }
    let base: string;
    try {
      base = await realpath(workdir);
    } catch {
      return undefined;
    }
    const candidate = resolve(base, relativePath.replaceAll('\\', '/').replace(/^\/+/, ''));
    if (!isInside(base, candidate)) {
      return undefined;
    }
    try {
      await lstat(candidate);
    } catch {
      return candidate;
    }
    try {
      return isInside(base, await realpath(candidate)) ? candidate : undefined;
    } catch {
      return undefined;
    }
  }

  private async runShell(
    step: StepDefinition,
    workdir: string,
    span: Span,
    options: StepRunOptions,
  ): Promise<StepOutcome> {
    const shell = this.runners.get(SHELL_RUNNER);

    for (const command of step.commands) {
      const request: RunRequest = {
        prompt: command,
        workdir,
        timeoutSeconds: this.timeoutSeconds,
        ...(options.onOutput !== undefined ? { onOutput: options.onOutput } : {}),
      };
      const result = await this.invoke(shell, request, span, 'execute_tool', command, options.signal);
      if (!result.succeeded()) {
        return StepOutcome.failed(
          `Command \`${command}\` exited with code ${result.exitCode}.\n${this.prompts.tail(result.failureText())}`,
        );
      }
    }
    return StepOutcome.ok();
  }

  private async runAgent(
    step: StepDefinition,
    workflow: WorkflowDefinition,
    workdir: string,
    span: Span,
    options: StepRunOptions,
  ): Promise<StepOutcome> {
    const { runner, model } = this.resolveRunner(step, workflow);
    const mcp = this.mcp.resolve(workflow, step, step.role, runner);
    this.recordMcp(span, mcp);
    if (mcp.missing.length > 0) {
      return StepOutcome.failed(
        `Required MCP server(s) unavailable for runner ${runner.name}: ${mcp.missing.join(', ')}`,
      );
    }
    const request: RunRequest = {
      prompt: this.prompts.build(step, options.feedback),
      workdir,
      ...(model !== undefined ? { model } : {}),
      timeoutSeconds: this.timeoutSeconds,
      ...(options.onOutput !== undefined ? { onOutput: options.onOutput } : {}),
      mcpServers: mcp.injected,
    };
    const result = await this.invoke(runner, request, span, 'invoke_agent', runner.name, options.signal);

    return result.succeeded()
      ? StepOutcome.ok()
      : StepOutcome.failed(
          `Runner ${runner.name} exited with code ${result.exitCode}.\n${this.prompts.tail(result.failureText())}`,
        );
  }

  private async runConsensus(
    step: StepDefinition,
    workflow: WorkflowDefinition,
    workdir: string,
    span: Span,
    options: StepRunOptions,
  ): Promise<StepOutcome> {
    const roles = [...new Set([...(step.role === undefined ? [] : [step.role]), ...step.consensusWith])];

    const participants = roles.map((roleName) => {
      const role = roleOf(workflow, roleName);
      const runner = this.runners.get(role.runner);
      const mcp = this.mcp.resolve(workflow, step, roleName, runner);
      this.recordMcp(span, mcp);
      if (mcp.missing.length > 0) {
        throw new McpUnavailableError([`step "${step.id}", role "${roleName}": ${mcp.missing.join(', ')}`]);
      }
      return new RunnerParticipant({
        role: roleName,
        runner,
        workdir,
        ...(role.model !== undefined ? { model: role.model } : {}),
        invoke: (r, request) => this.invoke(r, request, span, 'invoke_agent', roleName, options.signal),
        mcpServers: mcp.injected,
      });
    });

    let topic =
      step.goal !== ''
        ? step.goal
        : 'Review the work produced so far and decide whether it should be accepted.';
    if (step.inputArtifacts.length > 0) {
      topic += `\n\nRelevant artifacts:\n- ${step.inputArtifacts.join('\n- ')}`;
    }

    const result = await this.arbiter.deliberate(
      topic,
      participants,
      step.decisionType ?? DecisionType.Consensus,
    );
    span.setAttribute('indaba.consensus.outcome', result.outcome);
    span.setAttribute('indaba.consensus.rounds', result.rounds);

    if (result.reached()) {
      return StepOutcome.ok();
    }

    // No quorum is a judgement call for a human, not something a retry can fix.
    return StepOutcome.escalated(
      `No consensus (${result.outcome} after ${result.rounds} round(s)). Open objections:\n${result.openObjections()}`,
    );
  }

  /** Names only: server definitions can carry secrets and never reach a span. */
  private recordMcp(span: Span, mcp: McpResolution): void {
    const groups: [string, readonly string[]][] = [
      ['servers', mcp.injected.map((d) => d.name)],
      ['assumed', mcp.assumed],
      ['skipped', mcp.skipped],
    ];
    for (const [key, names] of groups) {
      if (names.length === 0) {
        continue;
      }
      const attribute = `indaba.mcp.${key}`;
      const existing = span.attributes[attribute];
      const all = [typeof existing === 'string' ? existing : '', names.join(',')].filter((s) => s !== '');
      span.setAttribute(attribute, all.join(','));
    }
  }

  private resolveRunner(
    step: StepDefinition,
    workflow: WorkflowDefinition,
  ): { runner: Runner; model: string | undefined } {
    if (step.role !== undefined) {
      const role = roleOf(workflow, step.role);
      return { runner: this.runners.get(role.runner), model: role.model };
    }
    if (step.runner === undefined) {
      throw new IndabaError('Step has neither role nor runner.');
    }
    return { runner: this.runners.get(step.runner), model: undefined };
  }

  private async invoke(
    runner: Runner,
    request: RunRequest,
    parent: Span,
    operation: string,
    label: string,
    signal: AbortSignal | undefined,
  ): Promise<RunResult> {
    const span = await this.tracer.startSpan(`${operation} ${runner.name}`, parent, {
      [Tracer.ATTR_OPERATION]: operation,
      'indaba.runner': runner.name,
      'indaba.label': label,
    });

    let result: RunResult;
    try {
      signal?.throwIfAborted();
      result = await runner.run(request, signal);
    } catch (error) {
      await this.tracer.endSpan(span, SpanStatus.Error, error instanceof Error ? error.message : 'failed');
      throw error;
    }

    const model = result.model ?? request.model;
    if (result.usage !== undefined && model !== undefined) {
      this.tracer.recordUsage(span, runner.name, model, result.usage);
    }
    span.setAttribute('indaba.exit_code', result.exitCode);
    await this.tracer.endSpan(span, result.succeeded() ? SpanStatus.Ok : SpanStatus.Error);
    return result;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
