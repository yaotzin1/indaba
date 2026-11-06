import type { StepStatus } from '@indaba/core';

export class StepOutcome {
  private constructor(
    readonly ok: boolean,
    readonly escalate: boolean,
    readonly feedback: string,
    readonly cancelled: boolean = false,
    /** Set only when the attempt was stopped for silence: the limit that elapsed (specs/step-stalls). */
    readonly stalledSeconds?: number,
  ) {}

  static ok(): StepOutcome {
    return new StepOutcome(true, false, '');
  }

  /** A failure the retry policy may act on. */
  static failed(feedback: string): StepOutcome {
    return new StepOutcome(false, false, feedback);
  }

  /**
   * An attempt a runner stopped because it showed no activity for `seconds`. A failure for everything that does not look at
   * `stalledSeconds`; the reason is fixed text and a number, never anything the agent printed (AC-06, AC-19).
   */
  static stalledFor(seconds: number): StepOutcome {
    return new StepOutcome(false, false, `Stalled: no activity for ${seconds} seconds.`, false, seconds);
  }

  /** A failure only a human can resolve; retrying is pointless. */
  static escalated(feedback: string): StepOutcome {
    return new StepOutcome(false, true, feedback);
  }

  /** The run was aborted; nothing may retry or continue. */
  static cancelled(): StepOutcome {
    return new StepOutcome(false, false, 'The run was cancelled.', true);
  }
}

export const WorkflowStatus = {
  Completed: 'COMPLETED',
  Failed: 'FAILED',
  Escalated: 'ESCALATED',
  /** The caller aborted the run through its AbortSignal. */
  Cancelled: 'CANCELLED',
} as const;
export type WorkflowStatus = (typeof WorkflowStatus)[keyof typeof WorkflowStatus];

export class WorkflowResult {
  /** @param steps final status per step id */
  constructor(
    readonly taskId: string,
    readonly traceId: string,
    readonly status: WorkflowStatus,
    readonly steps: Readonly<Record<string, StepStatus>>,
    readonly failureReason?: string,
  ) {}
}
