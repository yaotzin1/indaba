/**
 * The data shapes of a run as the local web view and the terminal dashboard read it. Declarations only: no value,
 * no import, so the page (which may import no `node:` module) and the server share one source. The functions that
 * build them from the trace files stay in `@indaba/engine`.
 */

export type RunStatus = 'running' | 'completed' | 'failed' | 'escalated' | 'cancelled' | 'unknown';

export interface RunSummary {
  readonly runId: string;
  readonly startedAt: string | undefined;
  readonly status: RunStatus;
  /** The workflow's name, as the run recorded it; undefined when the run does not say. */
  readonly workflow: string | undefined;
}

export interface RunnerView {
  readonly spanId: string;
  readonly name: string;
  /** `invoke_agent` for an agent, `execute_tool` for a shell command. */
  readonly operation: string;
  readonly status: 'running' | 'ok' | 'error';
  readonly startedAt: string;
  readonly endedAt: string | undefined;
  readonly exitCode: number | undefined;
  readonly model: string | undefined;
  /** What the runner or the pricing table gave. Undefined means unknown, never zero. */
  readonly costUsd: number | undefined;
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
}

export interface SkippedRunnerView {
  readonly runner: string;
  readonly reason: string;
}

/** One go at a step: it begins when the step enters `RUNNING` and ends at `FAILED`, `ESCALATED` or `COMPLETED`. */
export interface AttemptView {
  /** 1 for the first time the step ran. */
  readonly attempt: number;
  readonly startedAt: string;
  /** Undefined while the attempt has not ended. */
  readonly endedAt: string | undefined;
  /** The latest state the step reached in this attempt, as the engine names it. */
  readonly outcome: string;
  /** Why it failed or escalated, when the engine said. */
  readonly reason: string | undefined;
}

export interface StepView {
  readonly id: string;
  /** The state the step last moved to, as the engine names it (`PENDING`, `RUNNING`, ...). */
  readonly status: string;
  /** How many times it entered `RUNNING`. */
  readonly attempts: number;
  /** The attempts, oldest first, the current one last: a bounded number, the newest kept. */
  readonly history: readonly AttemptView[];
  /** Why it last moved, when the engine said (a failure, an escalation). Cleared when it runs again. */
  readonly reason: string | undefined;
  readonly startedAt: string | undefined;
  readonly endedAt: string | undefined;
  readonly runners: readonly RunnerView[];
  readonly skipped: readonly SkippedRunnerView[];
  /** Finished tool calls of an ACP agent, by kind. */
  readonly toolCalls: Readonly<Record<string, number>>;
  readonly permissions: { readonly allowed: number; readonly rejected: number };
  readonly consensus: { readonly outcome: string; readonly rounds: number } | undefined;
  /** Complete lines, oldest first, a bounded number. */
  readonly output: readonly string[];
  /** The line being written, with no newline yet. */
  readonly partialLine: string;
  /** Output stopped being stored for the run (the allowance ran out). */
  readonly outputTruncated: boolean;
}

/** Where a step's failure leads, as the workflow declared it (`on_failure`). */
export interface StepFailureRoute {
  /** `retry_step`, `escalate` or `fail`. */
  readonly action: string;
  /** The step that runs again, for `retry_step`. */
  readonly target: string | undefined;
  readonly maxRetries: number;
}

/**
 * One step of the workflow as the run recorded it when it started: what it waits for and where a failure leads. Known
 * for every step, including those that have not run, so a view can draw the whole graph from the first moment.
 */
export interface StepStructure {
  readonly id: string;
  /** The steps it waits for (`depends_on`), in the order the workflow lists them. */
  readonly dependsOn: readonly string[];
  /** Undefined when the step sets no `on_failure` (a failure then ends the run as failed). */
  readonly onFailure: StepFailureRoute | undefined;
}

/** What a span id belongs to; internal to the reducer that builds {@link RunState}. */
export interface SpanOwner {
  readonly kind: 'root' | 'step' | 'runner' | 'other';
  readonly stepId: string | undefined;
}

export interface RunState {
  readonly traceId: string | undefined;
  readonly taskId: string | undefined;
  readonly workflow: string | undefined;
  readonly status: RunStatus;
  readonly startedAt: string | undefined;
  readonly endedAt: string | undefined;
  /** The time of the latest record, for the elapsed time of a run that has not ended. */
  readonly lastAt: string | undefined;
  readonly steps: readonly StepView[];
  /**
   * The workflow's steps in the order the engine runs them, with their edges, as recorded when the run started.
   * Undefined for a run recorded before Indaba wrote it, or when the record could not be read: a view then shows the
   * steps in `steps` in order and says the structure is unknown.
   */
  readonly structure: readonly StepStructure[] | undefined;
  /** What the agent runs cost, where known. */
  readonly cost: { readonly usd: number; readonly unknown: number; readonly calls: number };
  /** Lines the view could not make sense of, newest last. */
  readonly notes: readonly string[];
  /** span id to what it belongs to; internal to the reducer. */
  readonly owners: Readonly<Record<string, SpanOwner>>;
}

/** What the web view receives of a run: {@link RunState} without the reducer's internal bookkeeping. */
export type RunSnapshot = Omit<RunState, 'owners'>;
