import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  BoardLimits,
  EventDispatcher,
  IdGenerator,
  Span,
  StepDefinition,
  Tracer,
  WorkflowDefinition,
} from '@indaba/core';
import {
  admit,
  BoardRecorded,
  DagBuilder,
  FailureAction,
  IndabaError,
  McpUnavailableError,
  RunBoard,
  runsInProject,
  SpanStatus,
  StepState,
  StepStatus,
  StepStatusChanged,
} from '@indaba/core';
import { describeStructure, WORKFLOW_STRUCTURE_ATTRIBUTE } from '../trace/structure.js';
import {
  isRestorable,
  type Workspace,
  type WorkspaceCheckpoint,
  type WorkspaceManager,
} from '../workspace/workspace.js';
import { StepOutcome, WorkflowResult, WorkflowStatus } from './outcome.js';
import { describeStallFinding } from './stall.js';
import type { StepExecutor } from './step-executor.js';
import { StepPool } from './step-pool.js';

/**
 * The most steps that run at once until forks (specs/parallel-steps, T-08) and the release (T-15) land. A limit above it is
 * accepted, recorded as asked, and the run still takes one step at a time, so a person who asks for more is told so by the
 * command line instead of being promised a parallelism that does not happen. It goes with the cap.
 */
export const PARALLEL_STEP_CAP = 1;

/** Where the resolved limit of steps came from, written on the root span (specs/parallel-steps, AC-31). */
export type ParallelSource = 'flag' | 'env' | 'config' | 'workflow' | 'default';

export interface WorkflowEngineOptions {
  readonly executor: StepExecutor;
  readonly tracer: Tracer;
  readonly events: EventDispatcher;
  readonly workspaces: WorkspaceManager;
  /** The checkout the workflow works on; isolated steps get a worktree of it. */
  readonly projectDir: string;
  /** Names the task when `run` is not given a `taskId`. */
  readonly ids: IdGenerator;
  readonly dag?: DagBuilder;
  /** How many steps may run at once (specs/parallel-steps, AC-02). A workflow's `max_parallel` can lower it. Default 1. */
  readonly maxParallelSteps?: number;
  /** Where `maxParallelSteps` came from, for the root span. Absent means the default. */
  readonly maxParallelSource?: Exclude<ParallelSource, 'workflow'>;
  /** How often a step is put back to wait before it is admitted alone (AC-13). A workflow's `max_waits` can lower it. Default 3. */
  readonly maxWaits?: number;
  /** How the run's board limits and redacts the notes steps post (specs/run-blackboard). */
  readonly board?: {
    readonly limits?: Partial<BoardLimits>;
    readonly redact?: (text: string) => string;
  };
}

export interface RunOptions {
  readonly signal?: AbortSignal;
  readonly taskId?: string;
  /** Live output of the running step; of every running step, interleaved, when several run. */
  readonly onOutput?: (chunk: string) => void;
  /** Live output of every running step, told apart (specs/parallel-steps). */
  readonly onStepOutput?: (stepId: string, chunk: string) => void;
  /** How the person acknowledged the steps at the level `full`, recorded on the task span (specs/agent-permissions, AC-05). */
  readonly fullAccessAcknowledged?: 'terminal' | 'run_option' | 'page';
}

/**
 * Executes a workflow in dependency order, drives each step's state machine, applies the retry
 * policy and tears the isolated workspace down however the run ends.
 */
export class WorkflowEngine {
  /** Artifact key that receives the diff of an isolated workspace after each isolated step. */
  static readonly PATCH_ARTIFACT = 'patch';

  private readonly executor: StepExecutor;
  private readonly tracer: Tracer;
  private readonly events: EventDispatcher;
  private readonly workspaces: WorkspaceManager;
  private readonly projectDir: string;
  private readonly ids: IdGenerator;
  private readonly dag: DagBuilder;
  private readonly boardOptions: NonNullable<WorkflowEngineOptions['board']>;
  private readonly maxParallelSteps: number;
  private readonly maxParallelSource: ParallelSource;
  private readonly maxWaits: number;

  constructor(options: WorkflowEngineOptions) {
    this.executor = options.executor;
    this.tracer = options.tracer;
    this.events = options.events;
    this.workspaces = options.workspaces;
    this.projectDir = options.projectDir;
    this.ids = options.ids;
    this.dag = options.dag ?? new DagBuilder();
    this.boardOptions = options.board ?? {};
    this.maxParallelSteps = options.maxParallelSteps ?? 1;
    this.maxParallelSource = options.maxParallelSource ?? 'default';
    this.maxWaits = options.maxWaits ?? 3;
  }

  async run(workflow: WorkflowDefinition, options: RunOptions = {}): Promise<WorkflowResult> {
    const { signal, onOutput, onStepOutput } = options;
    const taskId = options.taskId ?? `task-${this.ids.next(8)}`;
    const projectDir = this.projectDir;

    const blocking = this.executor
      .mcpIssues(workflow)
      .filter((issue) => issue.isError)
      .map((issue) => issue.describe());
    if (blocking.length > 0) {
      throw new McpUnavailableError(blocking);
    }

    // The engine, not only the command line, refuses a level a runner cannot hold and a `full` step nobody acknowledged
    // (specs/agent-permissions, AC-05, AC-07).
    const findings = this.executor.permissionFindings(workflow);
    const refused = findings.filter((finding) => finding.severity === 'error');
    if (refused.length > 0) {
      throw new IndabaError(
        `The permissions cannot be honoured: ${refused
          .map((f) =>
            f.code === 'unsupported'
              ? `step "${f.stepId}" level "${f.level}" on ${f.runner}`
              : `step "${f.stepId}" ${f.code}`,
          )
          .join('; ')}`,
      );
    }
    // The same for a stall limit on a runner that cannot report activity (specs/step-stalls, AC-12, AC-21).
    const stallRefused = this.executor.stallFindings(workflow);
    if (stallRefused.length > 0) {
      throw new IndabaError(
        `The stall limits cannot be honoured: ${stallRefused.map(describeStallFinding).join('; ')}`,
      );
    }
    const full = findings.filter((finding) => finding.code === 'full');
    if (full.length > 0 && options.fullAccessAcknowledged === undefined) {
      throw new IndabaError(
        `Steps at the level "full" need an acknowledgement before the run starts: ${[...new Set(full.map((f) => f.stepId))].join(', ')}`,
      );
    }

    const order = this.dag.build(workflow);
    const states = new Map<string, StepState>();
    order.forEach((step) => {
      states.set(step.id, new StepState(step.id));
    });

    // The limit is the smaller of the run's and the workflow's, never raised by the workflow (AC-03), and never above the cap.
    const asked = this.maxParallelSteps;
    const wanted =
      workflow.maxParallel !== undefined && workflow.maxParallel < asked ? workflow.maxParallel : asked;
    const limit = Math.min(wanted, PARALLEL_STEP_CAP);
    const limitSource: ParallelSource = wanted !== asked ? 'workflow' : this.maxParallelSource;
    const maxWaits = Math.min(this.maxWaits, workflow.maxWaits ?? this.maxWaits);

    const root = await this.tracer.startTrace(`indaba.task ${workflow.name}`, {
      'indaba.task.id': taskId,
      'indaba.workflow.name': workflow.name,
      'indaba.workflow.max_parallel': limit,
      'indaba.workflow.max_parallel.source': limitSource,
      [WORKFLOW_STRUCTURE_ATTRIBUTE]: describeStructure(order),
      ...(options.fullAccessAcknowledged !== undefined
        ? { 'indaba.permissions.full_acknowledged': options.fullAccessAcknowledged }
        : {}),
    });

    // Every record of the board reaches the listeners in order; `delivered` is awaited before the run ends.
    let delivered: Promise<void> = Promise.resolve();
    const board = new RunBoard({
      traceId: root.traceId,
      workflow: workflow.name,
      clock: this.tracer,
      ...(this.boardOptions.limits !== undefined ? { limits: this.boardOptions.limits } : {}),
      ...(this.boardOptions.redact !== undefined ? { redact: this.boardOptions.redact } : {}),
      sink: (record) => {
        delivered = delivered.then(() => this.events.dispatch(new BoardRecorded(root.traceId, record)));
      },
    });

    let workspace: Workspace | undefined;
    /** steps whose working directory is the worktree */
    const isolated = new Set<string>();
    const retries = new Map<string, number>();
    const feedback = new Map<string, string>();
    let status: WorkflowStatus = WorkflowStatus.Completed;
    let reason: string | undefined;
    let failure: { readonly error: unknown } | undefined;

    interface Finished {
      readonly outcome: StepOutcome;
      readonly attempt: number;
      /** The step's worktree, when it had one. */
      readonly workspace: Workspace | undefined;
    }
    const pool = new StepPool<Finished>(signal);
    const byId = new Map(order.map((step) => [step.id, step]));
    /** No new step is admitted once a run is cancelled or a step failed for good; the steps running finish (AC-27). */
    let halted = false;
    const halt = (next: WorkflowStatus, why: string): void => {
      if (!halted) {
        halted = true;
        status = next;
        reason = why;
      }
    };
    const output = (id: string): ((chunk: string) => void) | undefined =>
      onOutput === undefined && onStepOutput === undefined
        ? undefined
        : (chunk) => {
            onOutput?.(chunk);
            onStepOutput?.(id, chunk);
          };

    /** Starts one step in the pool: its workspace, its staged artifacts, then the attempt. */
    const startStep = (step: StepDefinition, state: StepState): void => {
      pool.start(step.id, async (stepSignal) => {
        let current: Workspace | undefined;
        if (!runsInProject(step, isolated)) {
          workspace ??= await this.workspaces.create(taskId);
          isolated.add(step.id);
          current = workspace;
        }
        const workdir = current === undefined ? projectDir : current.path();
        if (workdir !== projectDir) {
          await this.stageArtifacts(step, projectDir, workdir);
        }
        const attempt = state.attempts() + 1;
        const outcome = await this.execute(step, workflow, state, taskId, root, workdir, {
          feedback: feedback.get(step.id),
          onOutput: output(step.id),
          signal: stepSignal,
          board,
          attempt,
          workspace: current,
        });
        return { outcome, attempt, workspace: current };
      });
    };

    try {
      for (;;) {
        const unfinished = order.some((step) => states.get(step.id)?.status() !== StepStatus.Completed);
        if (!halted && signal?.aborted === true && unfinished) {
          halt(WorkflowStatus.Cancelled, 'The run was cancelled.');
        }
        if (!halted) {
          const admitted = admit({
            order,
            states: new Map([...states].map(([id, state]) => [id, state.status()])),
            running: new Set(pool.ids()),
            waiting: new Map(),
            limit,
            maxWaits,
            ownerQueue: [],
            runsInProject: (step) => runsInProject(step, isolated),
            halted,
          });
          for (const admission of admitted) {
            const step = admission.kind === 'step' ? byId.get(admission.stepId) : undefined;
            const state = step === undefined ? undefined : states.get(step.id);
            if (step !== undefined && state !== undefined) {
              startStep(step, state);
            }
          }
        }
        if (pool.size === 0) {
          break;
        }

        const settled = await pool.next();
        if (!settled.result.ok) {
          throw settled.result.error;
        }
        const step = byId.get(settled.id);
        const state = states.get(settled.id);
        if (step === undefined || state === undefined) {
          continue;
        }
        const { outcome, attempt, workspace: current } = settled.result.value;
        feedback.delete(step.id);

        // A cancelled attempt settles nothing: its notes stay pending. Otherwise the step's own result decides.
        if (!outcome.cancelled) {
          board.settle({ stepId: step.id, attempt, outcome: outcome.ok ? 'accepted' : 'discarded' });
        }

        if (outcome.cancelled) {
          halt(WorkflowStatus.Cancelled, `Step "${step.id}": ${outcome.feedback}`);
          continue;
        }

        if (outcome.ok) {
          if (current !== undefined) {
            await this.exportPatch(workflow, current, projectDir);
          }
          continue;
        }

        const policy = step.onFailure;
        const used = retries.get(step.id) ?? 0;
        const target =
          policy !== undefined &&
          !outcome.escalate &&
          policy.action === FailureAction.RetryStep &&
          used < policy.maxRetries
            ? policy.target
            : undefined;

        if (target !== undefined) {
          retries.set(step.id, used + 1);
          feedback.set(target, outcome.feedback);

          // The target and its descendants go back to PENDING and are admitted again in order. Steps that do not depend on
          // the target are COMPLETED and are not touched. A descendant that is still running is aborted from slice 2 on
          // (specs/parallel-steps, AC-28); with the cap at one step nothing else is running here.
          const reset = [target, ...this.dag.descendantsOf(workflow, target)];
          board.supersede(reset);
          for (const id of reset) {
            const other = states.get(id);
            if (other !== undefined && other.status() !== StepStatus.Pending) {
              await this.move(other, taskId, StepStatus.Pending, `retry of ${step.id}`);
            }
          }
          continue;
        }

        const escalate =
          outcome.escalate ||
          policy?.action === FailureAction.Escalate ||
          policy?.action === FailureAction.RetryStep;
        if (escalate && state.status() === StepStatus.Failed) {
          await this.move(state, taskId, StepStatus.Escalated, outcome.feedback);
        }
        halt(
          escalate ? WorkflowStatus.Escalated : WorkflowStatus.Failed,
          `Step "${step.id}": ${outcome.feedback}`,
        );
      }
    } catch (error) {
      failure = { error };
      status = status === WorkflowStatus.Completed ? WorkflowStatus.Failed : status;
      pool.abortAll();
      while (pool.size > 0) {
        await pool.next();
      }
    }

    // Teardown is never cancelled: the abort signal is deliberately not passed down here.
    let teardown: { readonly error: unknown } | undefined;
    try {
      await workspace?.destroy();
    } catch (error) {
      teardown = { error };
    }
    if (teardown !== undefined && failure === undefined) {
      status = WorkflowStatus.Failed;
      reason = 'The workspace could not be removed.';
    }
    await delivered;
    await this.closeTrace(root, status, reason ?? (failure === undefined ? undefined : 'The run failed.'));
    if (failure !== undefined) {
      throw failure.error;
    }
    if (teardown !== undefined) {
      throw teardown.error;
    }

    return new WorkflowResult(
      taskId,
      root.traceId,
      status,
      Object.fromEntries([...states].map(([id, s]) => [id, s.status()])),
      reason,
    );
  }

  private async closeTrace(root: Span, status: WorkflowStatus, reason: string | undefined): Promise<void> {
    if (root.isEnded()) {
      return;
    }
    root.setAttribute('indaba.workflow.status', status);
    await this.tracer.endSpan(
      root,
      status === WorkflowStatus.Completed ? SpanStatus.Ok : SpanStatus.Error,
      reason,
    );
  }

  private async execute(
    step: StepDefinition,
    workflow: WorkflowDefinition,
    state: StepState,
    taskId: string,
    root: Span,
    workdir: string,
    options: {
      readonly feedback: string | undefined;
      readonly onOutput: ((chunk: string) => void) | undefined;
      readonly signal: AbortSignal | undefined;
      readonly board: RunBoard;
      readonly attempt: number;
      /** The step's worktree, when it has one: what a stall retry puts back. */
      readonly workspace: Workspace | undefined;
    },
  ): Promise<StepOutcome> {
    const policy = step.stall;
    const span = await this.tracer.startSpan(`step ${step.id}`, root, {
      'indaba.step.id': step.id,
      'indaba.step.attempt': state.attempts() + 1,
      ...(step.timeoutSeconds !== undefined ? { 'indaba.step.timeout_seconds': step.timeoutSeconds } : {}),
      ...(policy !== undefined
        ? { 'indaba.stall.after_seconds': policy.afterSeconds, 'indaba.stall.retries': policy.retries }
        : {}),
    });

    // What a stalled attempt is put back to, taken once, before the first attempt (specs/step-stalls, C-06). A workspace that
    // cannot be restored, or a checkpoint that cannot be taken, is found out only if an attempt stalls (restore_failed).
    const workspace = options.workspace;
    let checkpoint: WorkspaceCheckpoint | undefined;
    if (policy !== undefined && policy.retries > 0 && workspace !== undefined && isRestorable(workspace)) {
      try {
        checkpoint = await workspace.checkpoint();
      } catch {
        checkpoint = undefined;
      }
    }

    // Each pass is one attempt. The stall retries are counted here, so they begin again whenever the step is executed again,
    // for instance after an `on_failure` retry reset it (AC-09), and they use none of that budget (AC-08).
    let stalls = 0;
    let feedback = options.feedback;
    let outcome: StepOutcome;
    for (;;) {
      await this.move(state, taskId, StepStatus.Running);
      outcome = await this.executor.run(step, workflow, workdir, span, { ...options, feedback });
      const silent = outcome.stalledSeconds;
      if (silent === undefined || policy === undefined) {
        break;
      }
      stalls += 1;
      span.setAttribute('indaba.stall.count', stalls);
      if (stalls > policy.retries) {
        span.addEvent('indaba.step.stalled', stallEvent(stalls, silent, 'exhausted'));
        break;
      }
      let restored = false;
      if (workspace !== undefined && checkpoint !== undefined && isRestorable(workspace)) {
        try {
          await workspace.restore(checkpoint);
          restored = true;
        } catch {
          restored = false;
        }
      }
      if (!restored) {
        span.addEvent('indaba.step.stalled', stallEvent(stalls, silent, 'restore_failed'));
        outcome = StepOutcome.failed('The worktree could not be restored after a stall.');
        break;
      }
      span.addEvent('indaba.step.stalled', stallEvent(stalls, silent, 'restored'));
      await this.move(state, taskId, StepStatus.Failed, outcome.feedback);
      await this.move(
        state,
        taskId,
        StepStatus.Pending,
        `Stalled: no activity for ${silent} seconds (retry ${stalls} of ${policy.retries}).`,
      );
      feedback = `Your previous attempt stalled: no activity for ${silent} seconds. Nothing it did was kept.`;
    }

    if (outcome.ok) {
      await this.move(state, taskId, StepStatus.Validating);
      outcome = await this.executor.validate(step, workdir);
    }

    if (outcome.ok) {
      await this.move(state, taskId, StepStatus.Completed);
      await this.tracer.endSpan(span, SpanStatus.Ok);
      return outcome;
    }

    await this.move(state, taskId, StepStatus.Failed, outcome.feedback);
    await this.tracer.endSpan(span, SpanStatus.Error, outcome.feedback);
    return outcome;
  }

  private async move(state: StepState, taskId: string, to: StepStatus, reason?: string): Promise<void> {
    const from = state.status();
    state.transitionTo(to, reason);
    await this.events.dispatch(new StepStatusChanged(taskId, state.stepId, from, to, reason));
  }

  /** Copies input artifacts that live only in the project directory into the worktree. */
  private async stageArtifacts(step: StepDefinition, projectDir: string, workdir: string): Promise<void> {
    for (const artifact of step.inputArtifacts) {
      const source = await this.executor.resolvePath(projectDir, artifact);
      const target = await this.executor.resolvePath(workdir, artifact);
      if (source === undefined || target === undefined || !(await isFile(source)) || (await isFile(target))) {
        continue;
      }
      try {
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
      } catch {
        // An artifact that cannot be staged is reported by the step that needs it.
      }
    }
  }

  private async exportPatch(
    workflow: WorkflowDefinition,
    workspace: Workspace,
    projectDir: string,
  ): Promise<void> {
    const relative = Object.hasOwn(workflow.artifacts, WorkflowEngine.PATCH_ARTIFACT)
      ? workflow.artifacts[WorkflowEngine.PATCH_ARTIFACT]
      : undefined;
    const target = relative === undefined ? undefined : await this.executor.resolvePath(projectDir, relative);
    if (target === undefined) {
      return;
    }
    const diff = await workspace.diff();
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, diff);
    } catch {
      // The patch is a convenience copy; the worktree diff itself is not lost by this failure.
    }
  }
}

/** The attributes of one `indaba.step.stalled` event: numbers and a fixed word, never anything the agent printed (AC-19). */
function stallEvent(
  attempt: number,
  silentSeconds: number,
  retry: 'restored' | 'exhausted' | 'restore_failed',
) {
  return {
    'indaba.stall.attempt': attempt,
    'indaba.stall.silent_seconds': silentSeconds,
    'indaba.stall.retry': retry,
  };
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
