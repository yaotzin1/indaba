import { lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type {
  EventDispatcher,
  Runner,
  RunRequest,
  RunResult,
  SkippedRunner,
  Span,
  StepDefinition,
  WorkflowDefinition,
} from '@indaba/core';
import {
  ConsensusArbiter,
  DEFAULT_TIMEOUT_SECONDS,
  DecisionType,
  IndabaError,
  isConsensusStep,
  isShellStep,
  McpUnavailableError,
  RunnerChainExhaustedError,
  RunnerError,
  RunnerParticipant,
  RunnerUnavailableError,
  SHELL_RUNNER,
  SpanStatus,
  StepOutput,
  Tracer,
} from '@indaba/core';
import type { GuardRegistry } from '../guard/registry.js';
import type { RunnerPlan } from './chain.js';
import { effectiveGuards, planForRole, planForStep } from './chain.js';
import type { McpIssue, McpResolution, RunnerLookup } from './mcp.js';
import { McpPlanner } from './mcp.js';
import { StepOutcome } from './outcome.js';
import { PromptBuilder } from './prompt-builder.js';

export interface StepExecutorOptions {
  /** When given, each chunk a runner streams is also dispatched as a `StepOutput` event. */
  readonly events?: EventDispatcher;
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
  private readonly events: EventDispatcher | undefined;

  constructor(options: StepExecutorOptions) {
    this.runners = options.runners;
    this.guards = options.guards;
    this.tracer = options.tracer;
    this.prompts = options.prompts ?? new PromptBuilder();
    this.arbiter = options.arbiter ?? new ConsensusArbiter();
    this.timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
    this.mcp = new McpPlanner(options.runners);
    this.events = options.events;
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
      const outcome = isShellStep(step)
        ? await this.runShell(step, workdir, span, options)
        : isConsensusStep(step)
          ? await this.runConsensus(step, workflow, workdir, span, options)
          : await this.runAgent(step, workflow, workdir, span, options);
      // The process runners report an abort as a failed result (exit 130), not as an exception.
      return !outcome.ok && options.signal?.aborted === true ? StepOutcome.cancelled() : outcome;
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

    for (const guard of effectiveGuards(step)) {
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
    const plan = planForStep(step, workflow);
    const chain = this.chainRunner(
      plan,
      workflow,
      step,
      step.role,
      span,
      plan.names[0] ?? '',
      options.signal,
    );
    const request: RunRequest = {
      prompt: this.prompts.build(step, options.feedback),
      workdir,
      ...(plan.model !== undefined ? { model: plan.model } : {}),
      timeoutSeconds: this.timeoutSeconds,
      ...(options.onOutput !== undefined ? { onOutput: options.onOutput } : {}),
      ...(step.permissions !== undefined ? { permissions: step.permissions } : {}),
      ...(plan.agent !== undefined ? { agent: plan.agent } : {}),
    };
    const result = await chain.run(request, options.signal);

    return result.succeeded()
      ? StepOutcome.ok()
      : StepOutcome.failed(
          `Runner ${chain.name} exited with code ${result.exitCode}.
${this.prompts.tail(result.failureText())}`,
        );
  }

  /**
   * Tries each runner of the plan in order. Only a runner that could not run at all (it threw
   * RunnerUnavailableError, or is unknown, or cannot provide a required MCP server) is passed over;
   * a runner that ran, successfully or not, ends the walk, so a failed task is never replayed. Every
   * attempt gets the original request, never anything an earlier runner produced.
   */
  private chainRunner(
    plan: RunnerPlan,
    workflow: WorkflowDefinition,
    step: StepDefinition,
    roleName: string | undefined,
    span: Span,
    label: string,
    signal: AbortSignal | undefined,
  ): Runner {
    return {
      name: plan.names[0] ?? '',
      run: async (request) => {
        const skipped: SkippedRunner[] = [];
        const skip = (runner: string, reason: string): void => {
          const bounded = reason.length > 300 ? `${reason.slice(0, 300)}...` : reason;
          skipped.push({ runner, reason: bounded });
          span.addEvent('indaba.runner.skipped', {
            'indaba.runner': runner,
            'indaba.runner.skip_reason': bounded,
          });
        };

        for (const name of plan.names) {
          signal?.throwIfAborted();
          let runner: Runner;
          try {
            runner = this.runners.get(name);
          } catch (error) {
            if (error instanceof RunnerError) {
              skip(name, error.message);
              continue;
            }
            throw error;
          }
          const mcp = this.mcp.resolve(workflow, step, roleName, runner);
          if (mcp.missing.length > 0) {
            skip(name, `Required MCP server(s) unavailable: ${mcp.missing.join(', ')}`);
            continue;
          }
          this.recordMcp(span, mcp);
          try {
            return await this.invoke(
              runner,
              { ...request, mcpServers: mcp.injected },
              span,
              'invoke_agent',
              label,
              signal,
            );
          } catch (error) {
            if (error instanceof RunnerUnavailableError) {
              skip(name, error.message);
              continue;
            }
            throw error;
          }
        }
        throw new RunnerChainExhaustedError(skipped);
      },
    };
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
      const plan = planForRole(workflow, roleName);
      if (plan.names.length === 1) {
        // One runner and no way round it: refuse before the debate starts, as always.
        const only = this.runners.get(plan.names[0] ?? '');
        const mcp = this.mcp.resolve(workflow, step, roleName, only);
        if (mcp.missing.length > 0) {
          throw new McpUnavailableError([`step "${step.id}", role "${roleName}": ${mcp.missing.join(', ')}`]);
        }
      }
      return new RunnerParticipant({
        role: roleName,
        runner: this.chainRunner(plan, workflow, step, roleName, span, roleName, options.signal),
        workdir,
        ...(plan.model !== undefined ? { model: plan.model } : {}),
        invoke: (chain, request) => chain.run(request, options.signal),
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

  /**
   * What a runner is given to stream into: the caller's own sink, and, when there is a dispatcher, a
   * `StepOutput` event for each chunk. Nothing is added when neither is wanted.
   */
  private outputSink(request: RunRequest, span: Span): Pick<RunRequest, 'onOutput'> {
    const events = this.events;
    const sink = request.onOutput;
    if (events === undefined) {
      return sink === undefined ? {} : { onOutput: sink };
    }
    let seq = 0;
    return {
      onOutput: (chunk) => {
        sink?.(chunk);
        void events.dispatch(new StepOutput(span.traceId, span.spanId, seq++, chunk));
      },
    };
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
      result = await runner.run(
        {
          ...request,
          onEvent: (name, attributes) => span.addEvent(name, attributes),
          ...this.outputSink(request, span),
        },
        signal,
      );
    } catch (error) {
      await this.tracer.endSpan(span, SpanStatus.Error, error instanceof Error ? error.message : 'failed');
      throw error;
    }

    const model = result.model ?? request.model;
    if (result.usage !== undefined && model !== undefined) {
      this.tracer.recordUsage(span, runner.name, model, result.usage);
    }
    // A cost the runner itself reported (an ACP agent may) is used when none was worked out from the pricing
    // table; a computed cost is never overwritten, and nothing is invented when neither exists.
    if (result.reportedCostUsd !== undefined && span.attributes[Tracer.ATTR_COST_USD] === undefined) {
      span.setAttribute(Tracer.ATTR_COST_USD, result.reportedCostUsd);
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
