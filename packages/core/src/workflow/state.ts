import { InvalidTransitionError } from '../errors/index.js';

export const StepStatus = {
  Pending: 'PENDING',
  Running: 'RUNNING',
  Validating: 'VALIDATING',
  Failed: 'FAILED',
  Escalated: 'ESCALATED',
  Completed: 'COMPLETED',
} as const;
export type StepStatus = (typeof StepStatus)[keyof typeof StepStatus];

const TRANSITIONS: Readonly<Record<StepStatus, readonly StepStatus[]>> = {
  [StepStatus.Pending]: [StepStatus.Running],
  [StepStatus.Running]: [StepStatus.Validating, StepStatus.Failed, StepStatus.Escalated],
  [StepStatus.Validating]: [StepStatus.Completed, StepStatus.Failed, StepStatus.Escalated],
  // A failed or completed step may be re-armed when an upstream retry re-runs it.
  [StepStatus.Failed]: [StepStatus.Pending, StepStatus.Escalated],
  [StepStatus.Completed]: [StepStatus.Pending],
  [StepStatus.Escalated]: [],
};

export function canTransition(from: StepStatus, to: StepStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalStatus(status: StepStatus): boolean {
  return status === StepStatus.Escalated || status === StepStatus.Completed;
}

export class StepState {
  private currentStatus: StepStatus = StepStatus.Pending;
  private attemptCount = 0;
  private currentReason: string | undefined;

  constructor(readonly stepId: string) {}

  status(): StepStatus {
    return this.currentStatus;
  }

  attempts(): number {
    return this.attemptCount;
  }

  reason(): string | undefined {
    return this.currentReason;
  }

  transitionTo(to: StepStatus, reason?: string): void {
    if (!canTransition(this.currentStatus, to)) {
      throw new InvalidTransitionError(
        `Step "${this.stepId}" cannot move from ${this.currentStatus} to ${to}.`,
      );
    }
    this.currentStatus = to;
    this.currentReason = reason;
    if (to === StepStatus.Running) {
      this.attemptCount += 1;
    }
  }
}

export class StepStatusChanged {
  constructor(
    readonly taskId: string,
    readonly stepId: string,
    readonly from: StepStatus,
    readonly to: StepStatus,
    readonly reason?: string,
  ) {}
}
