import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  EventDispatcher,
  IdGenerator,
  Span,
  StepDefinition,
  Tracer,
  WorkflowDefinition,
} from '@indaba/core';
import {
  DagBuilder,
  FailureAction,
  Isolation,
  McpUnavailableError,
  SpanStatus,
  StepState,
  StepStatus,
  StepStatusChanged,
} from '@indaba/core';
import type { Workspace, WorkspaceManager } from '../workspace/workspace.js';
import { type StepOutcome, WorkflowResult, WorkflowStatus } from './outcome.js';
import type { StepExecutor } from './step-executor.js';

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
}

export interface RunOptions {
  readonly signal?: AbortSignal;
  readonly taskId?: string;
  /** Live output of the running step. */
  readonly onOutput?: (chunk: string) => void;
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

  constructor(options: WorkflowEngineOptions) {
    this.executor = options.executor;
    this.tracer = options.tracer;
    this.events = options.events;
    this.workspaces = options.workspaces;
    this.projectDir = options.projectDir;
    this.ids = options.ids;
    this.dag = options.dag ?? new DagBuilder();
  }

  async run(workflow: WorkflowDefinition, options: RunOptions = {}): Promise<WorkflowResult> {
    const { signal, onOutput } = options;
    const taskId = options.taskId ?? `task-${this.ids.next(8)}`;
    const projectDir = this.projectDir;

    const blocking = this.executor
      .mcpIssues(workflow)
      .filter((issue) => issue.isError)
      .map((issue) => issue.describe());
    if (blocking.length > 0) {
      throw new McpUnavailableError(blocking);
    }

    const order = this.dag.build(workflow);
    const position = new Map<string, number>();
    const states = new Map<string, StepState>();
    order.forEach((step, i) => {
      position.set(step.id, i);
      states.set(step.id, new StepState(step.id));
    });

    const root = await this.tracer.startTrace(`indaba.task ${workflow.name}`, {
      'indaba.task.id': taskId,
      'indaba.workflow.name': workflow.name,
    });

    let workspace: Workspace | undefined;
    /** steps whose working directory is the worktree */
    const isolated = new Set<string>();
    const retries = new Map<string, number>();
    const feedback = new Map<string, string>();
    let status: WorkflowStatus = WorkflowStatus.Completed;
    let reason: string | undefined;
    let failure: { readonly error: unknown } | undefined;

    try {
      let i = 0;
      while (i < order.length) {
        const step = order[i];
        const state = step === undefined ? undefined : states.get(step.id);
        if (step === undefined || state === undefined) {
          break;
        }
        if (signal?.aborted === true) {
          status = WorkflowStatus.Cancelled;
          reason = 'The run was cancelled.';
          break;
        }

        const useWorktree =
          step.isolation === Isolation.GitWorktree || step.dependsOn.some((d) => isolated.has(d));
        let current: Workspace | undefined;
        if (useWorktree) {
          workspace ??= await this.workspaces.create(taskId);
          isolated.add(step.id);
          current = workspace;
        }
        const workdir = current === undefined ? projectDir : current.path();

        if (workdir !== projectDir) {
          await this.stageArtifacts(step, projectDir, workdir);
        }

        const outcome = await this.execute(step, workflow, state, taskId, root, workdir, {
          feedback: feedback.get(step.id),
          onOutput,
          signal,
        });
        feedback.delete(step.id);

        if (outcome.cancelled) {
          status = WorkflowStatus.Cancelled;
          reason = `Step "${step.id}": ${outcome.feedback}`;
          break;
        }

        if (outcome.ok) {
          if (current !== undefined) {
            await this.exportPatch(workflow, current, projectDir);
          }
          i += 1;
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

          for (const id of [target, ...this.dag.descendantsOf(workflow, target)]) {
            const other = states.get(id);
            if (other !== undefined && other.status() !== StepStatus.Pending) {
              await this.move(other, taskId, StepStatus.Pending, `retry of ${step.id}`);
            }
          }
          i = position.get(target) ?? i;
          continue;
        }

        const escalate =
          outcome.escalate ||
          policy?.action === FailureAction.Escalate ||
          policy?.action === FailureAction.RetryStep;
        if (escalate && state.status() === StepStatus.Failed) {
          await this.move(state, taskId, StepStatus.Escalated, outcome.feedback);
        }
        status = escalate ? WorkflowStatus.Escalated : WorkflowStatus.Failed;
        reason = `Step "${step.id}": ${outcome.feedback}`;
        break;
      }
    } catch (error) {
      failure = { error };
      status = status === WorkflowStatus.Completed ? WorkflowStatus.Failed : status;
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
    },
  ): Promise<StepOutcome> {
    const span = await this.tracer.startSpan(`step ${step.id}`, root, {
      'indaba.step.id': step.id,
      'indaba.step.attempt': state.attempts() + 1,
    });

    await this.move(state, taskId, StepStatus.Running);
    let outcome = await this.executor.run(step, workflow, workdir, span, options);

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

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
