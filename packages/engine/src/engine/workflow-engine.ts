import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  BoardLimits,
  EventDispatcher,
  IdGenerator,
  Intent,
  NegotiationDecider,
  Span,
  StepDefinition,
  Tracer,
  WorkflowDefinition,
} from '@indaba/core';
import {
  admit,
  BoardRecorded,
  contractSection,
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
  type ForkableWorkspace,
  isForkable,
  isRestorable,
  type LandResult,
  type Workspace,
  type WorkspaceCheckpoint,
  type WorkspaceManager,
} from '../workspace/workspace.js';
import { Coordination, type Decision } from './coordination.js';
import { StepOutcome, WorkflowResult, WorkflowStatus } from './outcome.js';
import { describeStallFinding } from './stall.js';
import type { StepExecutor } from './step-executor.js';
import { StepPool } from './step-pool.js';

/**
 * The most steps that run at once in a release, until negotiation and resolution (slices 3 and 4) and the release (T-15) land.
 * Forks and landing exist (T-08, T-09), but agents in parallel steps always talk (C-11), so a release without slices 3 and 4
 * would break that promise. A limit above it is accepted, recorded as asked, and the run still takes one step at a time, so a
 * person who asks for more is told so by the command line instead of being promised a parallelism that does not happen.
 * `WorkflowEngineOptions.maxParallelCap` lifts it for the engine's own tests. It goes with T-15.
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
  /**
   * The most steps that run at once whatever the limit says. Default `PARALLEL_STEP_CAP`; only the engine's tests raise it,
   * until the release cap goes (T-15). The composition root never passes it.
   */
  readonly maxParallelCap?: number;
  /** How often a step is put back to wait before it is admitted alone (AC-13). A workflow's `max_waits` can lower it. Default 3. */
  readonly maxWaits?: number;
  /**
   * Who decides when steps that run side by side could not agree on a split and the arbiter did not settle it (specs/parallel-steps,
   * AC-16). The composition root passes what a plugin registered; with none, those steps run one after another.
   */
  readonly negotiationDecider?: NegotiationDecider;
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
  private readonly parallelCap: number;
  private readonly negotiationDecider: NegotiationDecider | undefined;

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
    this.parallelCap = options.maxParallelCap ?? PARALLEL_STEP_CAP;
    this.negotiationDecider = options.negotiationDecider;
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
    const limit = Math.min(wanted, this.parallelCap);
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
      /** Set when the step was put back to wait for this step instead of running (AC-13, AC-16); `outcome` is then not read. */
      readonly putBack?: string;
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

    /** The run worktree, created by whichever step needs it first; steps starting together share the one creation. */
    let creating: Promise<Workspace> | undefined;
    const runWorkspace = (): Promise<Workspace> => {
      creating ??= this.workspaces.create(taskId).then(
        (created) => {
          workspace = created;
          return created;
        },
        (error: unknown) => {
          creating = undefined;
          throw error;
        },
      );
      return creating;
    };
    /**
     * Landings and forks take turns on the run worktree: a landing is one apply nobody may see half done, a fork stages the
     * run worktree's index, and landings go in the order steps ask for the lock, which is the order they finished (AC-22).
     */
    let landings: Promise<unknown> = Promise.resolve();
    const underWorkspaceLock = <T>(job: () => Promise<T>): Promise<T> => {
      const result = landings.then(job, job);
      landings = result.catch(() => undefined);
      return result;
    };
    /** A worktree that could not be removed: the run goes on and ends FAILED once everything has settled. */
    let removeFailed = false;
    const remove = async (target: Workspace): Promise<void> => {
      try {
        await target.destroy();
      } catch {
        removeFailed = true;
      }
    };
    /** Steps aborted because a retry reset them (AC-28): they go back to PENDING and nothing halts. */
    const retryAborted = new Map<string, string>();
    /** How often each step was put back to wait (AC-13), and the step it waits for until that one is COMPLETED. */
    const waits = new Map<string, number>();
    const blockedBy = new Map<string, string>();
    const isBlocked = (id: string): boolean => {
      const blocker = blockedBy.get(id);
      if (blocker !== undefined && states.get(blocker)?.status() === StepStatus.Completed) {
        blockedBy.delete(id);
        return false;
      }
      return blocker !== undefined;
    };
    /** The intents of the steps that passed the check and are not COMPLETED yet. */
    const working = new Map<string, Intent>();
    /** With the limit above 1 the steps that work in a worktree say what they will change before they start (AC-09). */
    const coordination =
      limit > 1
        ? new Coordination({
            executor: this.executor,
            tracer: this.tracer,
            board,
            root,
            workflow,
            signal,
            decider: this.negotiationDecider,
            workdir: async () => (await runWorkspace()).path(),
            working,
            attemptOf: (id) => (states.get(id)?.attempts() ?? 0) + 1,
          })
        : undefined;

    /** Starts one step in the pool: its workspace, its staged artifacts, then the attempt. */
    const startStep = (
      step: StepDefinition,
      state: StepState,
      decision?: Promise<Decision | undefined>,
    ): void => {
      const work = async (stepSignal: AbortSignal, contract: string | undefined): Promise<Finished> => {
        let current: Workspace | undefined;
        /** The run worktree and the step's fork of it: set only when the step runs in a worktree of its own (limit above 1). */
        let parent: ForkableWorkspace | undefined;
        let own: Workspace | undefined;
        const attempt = state.attempts() + 1;
        if (!runsInProject(step, isolated)) {
          const run = await runWorkspace();
          isolated.add(step.id);
          current = run;
          if (limit > 1 && isForkable(run)) {
            try {
              own = await underWorkspaceLock(() => run.fork(step.id));
              parent = run;
              current = own;
            } catch (error) {
              const why = error instanceof IndabaError ? error.message : 'The worktree could not be created.';
              await this.move(state, taskId, StepStatus.Running);
              await this.move(state, taskId, StepStatus.Failed, why);
              return { outcome: StepOutcome.failed(why), attempt, workspace: undefined };
            }
          }
        }
        const forked = own;
        const forkedFrom = parent;
        try {
          const workdir = current === undefined ? projectDir : current.path();
          if (workdir !== projectDir) {
            await this.stageArtifacts(step, projectDir, workdir);
          }
          const outcome = await this.execute(step, workflow, state, taskId, root, workdir, {
            feedback: feedback.get(step.id),
            onOutput: output(step.id),
            signal: stepSignal,
            board,
            attempt,
            workspace: current,
            contract,
            land:
              forked !== undefined && forkedFrom !== undefined
                ? () =>
                    this.land(step, forkedFrom, forked, stepSignal, underWorkspaceLock, remove, () =>
                      this.exportPatch(workflow, forkedFrom, projectDir),
                    )
                : undefined,
          });
          // A fork's change is in the run worktree and its patch is written by the landing: nothing is left to export.
          return { outcome, attempt, workspace: forked === undefined ? current : undefined };
        } finally {
          if (forked !== undefined) {
            await remove(forked);
          }
        }
      };
      pool.start(step.id, async (stepSignal) => {
        let contract: string | undefined;
        if (decision !== undefined) {
          const decided = await decision;
          if (stepSignal.aborted) {
            working.delete(step.id);
            return { outcome: StepOutcome.cancelled(), attempt: state.attempts() + 1, workspace: undefined };
          }
          if (decided?.kind === 'wait') {
            return {
              outcome: StepOutcome.ok(),
              attempt: state.attempts() + 1,
              workspace: undefined,
              putBack: decided.blocker,
            };
          }
          if (decided?.kind === 'end') {
            await this.move(state, taskId, StepStatus.Running);
            await this.move(state, taskId, StepStatus.Failed, decided.outcome.feedback);
            return { outcome: decided.outcome, attempt: state.attempts(), workspace: undefined };
          }
          waits.delete(step.id);
          contract = decided?.contract === undefined ? undefined : contractSection(decided.contract);
        }
        try {
          return await work(stepSignal, contract);
        } finally {
          working.delete(step.id);
        }
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
            // A step put back to wait is not offered until the step it waits for is COMPLETED (AC-13); it keeps its place.
            order: order.filter((step) => !isBlocked(step.id)),
            states: new Map([...states].map(([id, state]) => [id, state.status()])),
            running: new Set(pool.ids()),
            waiting: waits,
            limit,
            maxWaits,
            ownerQueue: [],
            runsInProject: (step) => runsInProject(step, isolated),
            halted,
          });
          const picked: { readonly step: StepDefinition; readonly state: StepState }[] = [];
          for (const admission of admitted) {
            const step = admission.kind === 'step' ? byId.get(admission.stepId) : undefined;
            const state = step === undefined ? undefined : states.get(step.id);
            if (step !== undefined && state !== undefined) {
              picked.push({ step, state });
            }
          }
          // The steps admitted together that work in a worktree say what they will change, and the engine decides what each does
          // next (AC-09 to AC-16). With the limit at 1 there is no one to meet and nothing is asked.
          const coordinated = picked
            .filter(({ step }) => !runsInProject(step, isolated))
            .map(({ step }) => step);
          const decisions =
            coordination !== undefined && coordinated.length > 0
              ? coordination.coordinate(coordinated)
              : undefined;
          for (const { step, state } of picked) {
            startStep(
              step,
              state,
              decisions !== undefined && coordinated.includes(step)
                ? decisions.then((all) => all.get(step.id))
                : undefined,
            );
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
        const { outcome, attempt, workspace: current, putBack } = settled.result.value;

        const abortedFor = retryAborted.get(step.id);
        if (abortedFor !== undefined) {
          // A retry reset it while it ran (AC-28): whatever it ended as, it goes back to PENDING and settles nothing.
          retryAborted.delete(step.id);
          feedback.delete(step.id);
          if (state.status() !== StepStatus.Pending) {
            await this.move(state, taskId, StepStatus.Pending, abortedFor);
          }
          continue;
        }
        if (putBack !== undefined) {
          // Put back before it began (AC-13, AC-16): still PENDING, its slot is free, and it waits for the step it met. The
          // feedback of a retry stays for the attempt that finally runs.
          waits.set(step.id, (waits.get(step.id) ?? 0) + 1);
          blockedBy.set(step.id, putBack);
          continue;
        }
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
          // the target are not touched. A descendant that is still running is aborted and goes back to PENDING when it
          // settles (specs/parallel-steps, AC-28); it is not admitted again before, because the pool still holds it.
          const reset = [target, ...this.dag.descendantsOf(workflow, target)];
          board.supersede(reset);
          for (const id of reset) {
            // Its waiting is over with its reset: a new attempt starts with no waits and no one to wait for (AC-28).
            waits.delete(id);
            blockedBy.delete(id);
            for (const [waiter, blocker] of blockedBy) {
              if (blocker === id) {
                blockedBy.delete(waiter);
              }
            }
            const other = states.get(id);
            if (pool.has(id)) {
              retryAborted.set(id, `retry of ${step.id}`);
              pool.abort(id);
            } else if (other !== undefined && other.status() !== StepStatus.Pending) {
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
    if ((teardown !== undefined || removeFailed) && failure === undefined) {
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
      /** The split the step's negotiation agreed, as the prompt section its work carries (AC-15). */
      readonly contract: string | undefined;
      /** Lands the step's change while it is VALIDATING; an outcome it returns ends the step. Only forked steps have one. */
      readonly land: (() => Promise<StepOutcome | undefined>) | undefined;
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

    if (outcome.ok && options.land !== undefined) {
      outcome = (await options.land()) ?? outcome;
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

  /**
   * Applies a forked step's change to the run worktree, one landing at a time (AC-22, AC-23). A conflict changes nothing and
   * fails the step with the files named; the resolution of slice 4 is not there yet. A landing is one apply: a step aborted
   * before it gets the lock does not land, one aborted during it lands whole.
   */
  private async land(
    step: StepDefinition,
    parent: ForkableWorkspace,
    child: Workspace,
    signal: AbortSignal,
    underLock: <T>(job: () => Promise<T>) => Promise<T>,
    remove: (target: Workspace) => Promise<void>,
    landed: () => Promise<void>,
  ): Promise<StepOutcome | undefined> {
    return await underLock(async () => {
      if (signal.aborted) {
        return StepOutcome.cancelled();
      }
      let result: LandResult;
      try {
        result = await parent.land(child);
      } catch {
        return StepOutcome.failed(`The change of step "${step.id}" could not be landed.`);
      }
      if (result.ok) {
        await landed();
        return undefined;
      }
      await remove(result.workspace);
      const files = [...new Set(result.conflicts.map((hunk) => hunk.path))];
      return StepOutcome.failed(
        `The change of step "${step.id}" conflicts with changes that landed before it${
          files.length === 0 ? '.' : `: ${files.join(', ')}.`
        } Nothing of it was applied.`,
      );
    });
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
