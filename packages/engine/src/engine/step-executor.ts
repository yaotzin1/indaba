import { lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type {
  AdjudicatorRegistry,
  Clock,
  EventDispatcher,
  RulingRequest,
  RunBoard,
  Runner,
  RunRequest,
  RunResult,
  SkippedRunner,
  Span,
  StepDefinition,
  WorkflowDefinition,
} from '@indaba/core';
import {
  BoardKind,
  buildDigest,
  ConsensusArbiter,
  DagBuilder,
  DEFAULT_READ_KINDS,
  DEFAULT_TIMEOUT_SECONDS,
  DecisionType,
  EnforcementMode,
  EnforcementScope,
  GuardType,
  IndabaError,
  isConsensusStep,
  isPermissionCapable,
  isShellStep,
  McpUnavailableError,
  MessageType,
  PermissionLevel,
  parseBoardLines,
  permissionCapabilitiesOf,
  Ruling,
  RulingSource,
  RunnerChainExhaustedError,
  RunnerError,
  RunnerParticipant,
  RunnerUnavailableError,
  SHELL_RUNNER,
  SpanStatus,
  StepOutput,
  Tracer,
} from '@indaba/core';
import { type DiscussionStore, discussionOf } from '../arbiter/discussions.js';
import type { DecisionLedger, MemoKey } from '../arbiter/ledger.js';
import { rulingMarkdown, transcriptMarkdown, writeDebateArtifact } from '../arbiter/records.js';
import type { GuardRegistry } from '../guard/registry.js';
import { SystemClock } from '../observability/system.js';
import { sanitize } from '../trace/sanitize.js';
import type { RunnerPlan } from './chain.js';
import { effectiveGuards, planForRole, planForStep } from './chain.js';
import type { McpIssue, McpResolution, RunnerLookup } from './mcp.js';
import { McpPlanner } from './mcp.js';
import { StepOutcome } from './outcome.js';
import { checkPermissions, type PermissionFinding } from './permissions.js';
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
  /** Who can settle a debate that fails, by the name a step's `arbiter` uses. */
  readonly adjudicators?: AdjudicatorRegistry;
  /** Where rulings are kept and looked up. Without it nothing is remembered. */
  readonly ledger?: DecisionLedger;
  /** Times a ruling. */
  readonly clock?: Clock;
  /** Applied to a debate's text before it is written to a file. */
  readonly redact?: (text: string) => string;
  /** Keeps the messages of each debate under its run, for a viewer. Without one, only the transcript artifact is written. */
  readonly discussions?: DiscussionStore;
}

export interface StepRunOptions {
  /** The run's board and this attempt's number (1 for the first). Absent: no digest, no scan, no entries. */
  readonly board?: RunBoard | undefined;
  readonly attempt?: number | undefined;
  readonly feedback?: string | undefined;
  readonly onOutput?: ((chunk: string) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}

const BOARD_KIND_OF: Record<MessageType, BoardKind> = {
  [MessageType.Proposal]: BoardKind.Proposal,
  [MessageType.Critique]: BoardKind.Critique,
  [MessageType.Agreement]: BoardKind.Agreement,
  [MessageType.Question]: BoardKind.Question,
  [MessageType.ToolIntent]: BoardKind.ToolIntent,
};

function rulingLine(ruling: Ruling): string {
  return ruling.note === '' ? ruling.verdict : `${ruling.verdict}: ${ruling.note}`;
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
  private readonly adjudicators: AdjudicatorRegistry | undefined;
  private readonly ledger: DecisionLedger | undefined;
  private readonly discussions: DiscussionStore | undefined;
  private readonly clock: Clock;
  private readonly redact: (text: string) => string;
  private readonly dag = new DagBuilder();

  constructor(options: StepExecutorOptions) {
    this.runners = options.runners;
    this.guards = options.guards;
    this.tracer = options.tracer;
    this.prompts = options.prompts ?? new PromptBuilder();
    this.arbiter = options.arbiter ?? new ConsensusArbiter();
    this.adjudicators = options.adjudicators;
    this.ledger = options.ledger;
    this.discussions = options.discussions;
    this.clock = options.clock ?? new SystemClock();
    this.redact = options.redact ?? ((text) => text);
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
      return !outcome.ok && options.signal?.aborted === true
        ? StepOutcome.cancelled()
        : this.redacted(outcome);
    } catch (error) {
      if (options.signal?.aborted === true) {
        return StepOutcome.cancelled();
      }
      if (error instanceof IndabaError) {
        return StepOutcome.failed(this.redact(error.message));
      }
      throw error;
    }
  }

  /**
   * What a step reports about its failure carries a command line, a runner's error text or a guard's message, and
   * any of them can hold a credential. It is redacted here, once, before the engine puts it in a state change, a
   * span or the stream.
   */
  private redacted(outcome: StepOutcome): StepOutcome {
    if (outcome.ok || outcome.cancelled || outcome.feedback === '') {
      return outcome;
    }
    const feedback = this.redact(outcome.feedback);
    return outcome.escalate ? StepOutcome.escalated(feedback) : StepOutcome.failed(feedback);
  }

  async validate(step: StepDefinition, workdir: string): Promise<StepOutcome> {
    for (const output of step.outputs) {
      const path = await this.resolvePath(workdir, output);
      if (path === undefined || !(await isFile(path))) {
        return StepOutcome.failed(this.redact(`Expected output "${output}" was not produced.`));
      }
    }

    for (const guard of effectiveGuards(step)) {
      const result = await this.guards.check(guard, workdir);
      if (!result.passed) {
        return StepOutcome.failed(this.redact(`Guard ${guard.type} failed: ${result.message ?? ''}`));
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

  /**
   * The board's notes for this step (specs/run-blackboard, AC-13 to AC-18), built when its call starts. Only a step with
   * `board.read` has one; the span gets counts, never text.
   */
  private digestFor(
    step: StepDefinition,
    workflow: WorkflowDefinition,
    span: Span,
    options: StepRunOptions,
  ): string | undefined {
    const board = step.board;
    const read = board?.read;
    if (board === undefined || read === undefined || options.board === undefined) {
      return undefined;
    }
    const digest = buildDigest(options.board, {
      forStep: step.id,
      steps: read.steps ?? this.dag.ancestorsOf(workflow, step.id),
      kinds: read.kinds ?? DEFAULT_READ_KINDS,
      maxChars: board.digestChars,
    });
    span.setAttribute('indaba.board.digest.entries', digest.entries);
    span.setAttribute('indaba.board.digest.chars', digest.chars);
    span.setAttribute('indaba.board.digest.omitted', digest.omitted);
    return digest.text;
  }

  private async runAgent(
    step: StepDefinition,
    workflow: WorkflowDefinition,
    workdir: string,
    span: Span,
    options: StepRunOptions,
  ): Promise<StepOutcome> {
    const plan = planForStep(step, workflow);
    let ran: Runner | undefined;
    const chain = this.chainRunner(
      plan,
      workflow,
      step,
      step.role,
      span,
      plan.names[0] ?? '',
      options.signal,
      (runner) => {
        ran = runner;
      },
    );
    const request: RunRequest = {
      prompt: this.prompts.build(step, options.feedback, this.digestFor(step, workflow, span, options)),
      workdir,
      ...(plan.model !== undefined ? { model: plan.model } : {}),
      timeoutSeconds: this.timeoutSeconds,
      ...(options.onOutput !== undefined ? { onOutput: options.onOutput } : {}),
      // At `full` the runner is sent no fs or terminal limits (specs/agent-permissions, AC-04); a block with no level is sent as before.
      ...(step.permissions !== undefined && step.permissions.level !== PermissionLevel.Full
        ? { permissions: step.permissions }
        : {}),
      ...(step.permissions?.level !== undefined ? { permissionLevel: step.permissions.level } : {}),
      ...(plan.agent !== undefined ? { agent: plan.agent } : {}),
    };
    const result = await chain.run(request, options.signal);

    if (
      result.succeeded() &&
      ran !== undefined &&
      (await this.refusedAndDidNothing(step, ran, result.output, workdir))
    ) {
      return StepOutcome.failed(
        `The agent was refused a permission it needed. It ran ${
          step.permissions?.level === undefined
            ? `under the built-in default of the ${ran.name} runner`
            : `at the level "${step.permissions.level}"`
        } and did nothing it was asked to. Change the step's permissions block (for example level: edit with fs.write).`,
      );
    }

    if (result.succeeded()) {
      this.postFromReply(step, result.output, span, options);
      return StepOutcome.ok();
    }
    return StepOutcome.failed(
      `Runner ${chain.name} exited with code ${result.exitCode}.
${this.prompts.tail(result.failureText())}`,
    );
  }

  /**
   * Takes the `BOARD` lines of a successful reply onto the run board (specs/run-blackboard, AC-04 to AC-08). Only a step
   * with `board.post` is scanned, and only the runner's own output; the entries stay pending until the step settles.
   * The span gets counts, never text.
   */
  private postFromReply(step: StepDefinition, output: string, span: Span, options: StepRunOptions): void {
    const post = step.board?.post;
    if (post === undefined || post.length === 0 || options.board === undefined) {
      return;
    }
    const parsed = parseBoardLines(output, post);
    let posted = 0;
    for (const line of parsed.posts) {
      const entry = options.board.post({
        stepId: step.id,
        attempt: options.attempt ?? 1,
        source: 'agent',
        sender: step.role ?? step.id,
        kind: line.kind,
        ...(line.key !== undefined ? { key: line.key } : {}),
        text: line.text,
      });
      if (entry !== undefined) {
        posted += 1;
      }
    }
    span.setAttribute('indaba.board.posted', posted);
    span.setAttribute('indaba.board.ignored', parsed.ignored + (parsed.posts.length - posted));
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
    onRan?: (runner: Runner) => void,
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
          this.recordPermissions(span, runner, step.permissions?.level);
          onRan?.(runner);
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

  /**
   * AC-11: a command-line agent refused a permission in headless mode can exit 0. Only when the runner recognises the
   * refusal (its text is never copied), and a declared output is missing or, with none declared, the working tree is
   * unchanged, is the step failed with a fixed reason. A reviewer that merely quotes the message, and did its work, passes.
   */
  private async refusedAndDidNothing(
    step: StepDefinition,
    runner: Runner,
    output: string,
    workdir: string,
  ): Promise<boolean> {
    if (step.permissions?.level === PermissionLevel.Full) {
      return false;
    }
    if (!isPermissionCapable(runner) || !runner.permissionDenied(output)) {
      return false;
    }
    if (step.outputs.length > 0) {
      for (const declared of step.outputs) {
        const path = await this.resolvePath(workdir, declared);
        if (path === undefined || !(await isFile(path))) {
          return true;
        }
      }
      return false;
    }
    const unchanged = await this.guards.check({ type: GuardType.GitDiffEmpty, paths: [] }, workdir);
    return unchanged.passed;
  }

  /**
   * What the permissions of this workflow mean for the runners registered here (specs/agent-permissions, AC-07): the
   * engine refuses to start on an error, whoever calls it.
   */
  permissionFindings(workflow: WorkflowDefinition): PermissionFinding[] {
    return checkPermissions(workflow, {
      has: (name) => {
        try {
          this.runners.get(name);
          return true;
        } catch {
          return false;
        }
      },
      get: (name) => this.runners.get(name),
    });
  }

  /** AC-15: the level, mode and scope that applied to this step on this runner. Words only: no path, command or message. */
  private recordPermissions(span: Span, runner: Runner, level: PermissionLevel | undefined): void {
    if (level === undefined) {
      span.setAttribute('indaba.permissions.level', 'default');
      return;
    }
    const capability = permissionCapabilitiesOf(runner).find((c) => c.level === level);
    span.setAttribute('indaba.permissions.level', level);
    span.setAttribute('indaba.permissions.mode', capability?.mode ?? EnforcementMode.Unsupported);
    span.setAttribute('indaba.permissions.scope', capability?.scope ?? EnforcementScope.None);
  }

  /**
   * A debate's messages, outcome and ruling go to the run board as they happen (specs/run-blackboard, AC-19), and are
   * `accepted` when it ends whatever the outcome: the transcript is a record, not a claim. A cancelled debate settles nothing.
   */
  private async runConsensus(
    step: StepDefinition,
    workflow: WorkflowDefinition,
    workdir: string,
    span: Span,
    options: StepRunOptions,
  ): Promise<StepOutcome> {
    const outcome = await this.deliberateStep(step, workflow, workdir, span, options);
    if (!outcome.cancelled && options.board !== undefined) {
      options.board.settle({ stepId: step.id, attempt: options.attempt ?? 1, outcome: 'accepted' });
    }
    return outcome;
  }

  private engineNote(
    step: StepDefinition,
    options: StepRunOptions,
    kind: BoardKind,
    sender: string,
    text: string,
    round?: number,
  ): void {
    options.board?.post({
      stepId: step.id,
      attempt: options.attempt ?? 1,
      source: 'engine',
      sender,
      kind,
      ...(round !== undefined ? { round } : {}),
      text,
    });
  }

  private async deliberateStep(
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

    const arbiterName = step.arbiter;
    let memo: MemoKey | undefined;
    if (arbiterName !== undefined && this.ledger !== undefined) {
      memo = await this.ledger.memoKey(workflow.name, step.id, topic);
      if ('skipped' in memo) {
        span.setAttribute('indaba.arbiter.memo', 'skipped');
      } else {
        const earlier = await this.ledger.lookup(workflow.name, memo.key);
        if (earlier !== undefined) {
          // The ledger is a committed file anyone can edit: what it says is cleaned like any other untrusted text.
          const kind = this.redact(sanitize(earlier.kind));
          const when = this.redact(sanitize(earlier.decidedAt));
          span.setAttribute('indaba.arbiter.kind', kind);
          span.setAttribute('indaba.arbiter.source', RulingSource.Memo);
          span.setAttribute('indaba.arbiter.verdict', earlier.verdict);
          const remembered = new Ruling(
            earlier.verdict,
            this.redact(sanitize(earlier.note)),
            RulingSource.Memo,
          );
          this.engineNote(step, options, BoardKind.Decision, kind, rulingLine(remembered));
          return this.afterRuling(
            remembered,
            kind,
            `Ruled earlier (${when}); the same question on the same files, so no new debate.`,
          );
        }
      }
    }

    // The notes go to the participants only: the memo key and a ruling are about the question, not about the board.
    const digest = this.digestFor(step, workflow, span, options);
    const result = await this.arbiter.deliberate(
      digest === undefined
        ? topic
        : `${topic}

${digest}`,
      participants,
      step.decisionType ?? DecisionType.Consensus,
      (message) =>
        this.engineNote(
          step,
          options,
          BOARD_KIND_OF[message.type],
          message.sender,
          message.content,
          message.round,
        ),
    );
    this.engineNote(
      step,
      options,
      BoardKind.Result,
      step.role ?? step.id,
      `${result.outcome} after ${result.rounds} round(s)${result.reached() ? '' : `. Open objections: ${result.openObjections()}`}`,
    );
    span.setAttribute('indaba.consensus.outcome', result.outcome);
    span.setAttribute('indaba.consensus.rounds', result.rounds);
    await writeDebateArtifact(
      workdir,
      step.id,
      'transcript',
      transcriptMarkdown(step.id, result, this.redact),
    );
    await this.discussions?.save(span.traceId, discussionOf(step.id, result, this.redact));

    if (result.reached()) {
      return StepOutcome.ok();
    }

    // No quorum is a judgement call for a person, not something a retry can fix.
    const unresolved = `No consensus (${result.outcome} after ${result.rounds} round(s)). Open objections:\n${result.openObjections()}`;
    if (arbiterName === undefined) {
      return StepOutcome.escalated(unresolved);
    }

    span.setAttribute('indaba.arbiter.kind', arbiterName);
    const adjudicator = this.adjudicators?.get(arbiterName);
    if (adjudicator === undefined) {
      span.setAttribute('indaba.arbiter.verdict', 'unavailable');
      return StepOutcome.escalated(
        `The arbiter "${arbiterName}" is not available: nothing is registered under that name.\n${unresolved}`,
      );
    }

    const request: RulingRequest = {
      stepId: step.id,
      topic,
      outcome: result.outcome,
      rounds: result.rounds,
      transcript: result.transcript,
    };
    let ruling: Ruling | null;
    try {
      ruling = await adjudicator.rule(request, options.signal);
    } catch (error) {
      if (options.signal?.aborted === true) {
        return StepOutcome.cancelled();
      }
      // A defect in an arbiter is a failure to report, not a judgement on the work.
      const reason = error instanceof Error ? error.message : String(error);
      return StepOutcome.failed(`The arbiter "${arbiterName}" failed: ${this.redact(sanitize(reason))}`);
    }
    if (options.signal?.aborted === true) {
      return StepOutcome.cancelled();
    }
    if (ruling === null) {
      span.setAttribute('indaba.arbiter.verdict', 'unavailable');
      return StepOutcome.escalated(
        `The arbiter "${arbiterName}" could not answer (for example, there is no terminal to ask on).\n${unresolved}`,
      );
    }

    const note = this.redact(sanitize(ruling.note));
    const ruled = new Ruling(ruling.verdict, note, RulingSource.Asked);
    this.engineNote(step, options, BoardKind.Decision, arbiterName, rulingLine(ruled));
    span.setAttribute('indaba.arbiter.source', RulingSource.Asked);
    span.setAttribute('indaba.arbiter.verdict', ruled.verdict);
    await this.discussions?.save(
      span.traceId,
      discussionOf(step.id, result, this.redact, {
        verdict: ruled.verdict,
        decidedBy: arbiterName,
        note: ruled.note,
      }),
    );
    await writeDebateArtifact(
      workdir,
      step.id,
      'ruling',
      rulingMarkdown(request, arbiterName, ruled, this.redact),
    );
    if (this.ledger !== undefined) {
      await this.ledger.append({
        ...(memo !== undefined && 'key' in memo ? { key: memo.key, commit: memo.commit } : {}),
        workflow: workflow.name,
        stepId: step.id,
        kind: arbiterName,
        verdict: ruled.verdict,
        note,
        outcome: result.outcome,
        rounds: result.rounds,
        decidedAt: this.clock.now().toISOString(),
      });
    }
    return this.afterRuling(ruled, arbiterName, unresolved);
  }

  /** `accept` completes the step; `reject` is the same escalation an unresolved debate always was. */
  private afterRuling(ruling: Ruling, kind: string, context: string): StepOutcome {
    if (ruling.accepted()) {
      return StepOutcome.ok();
    }
    const note = ruling.note === '' ? '(no note)' : ruling.note;
    return StepOutcome.escalated(`Rejected by the arbiter "${kind}": ${note}\n${context}`);
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
      'indaba.label': this.redact(label),
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
      await this.tracer.endSpan(
        span,
        SpanStatus.Error,
        error instanceof Error ? this.redact(error.message) : 'failed',
      );
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
