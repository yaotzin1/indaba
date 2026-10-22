import type {
  StartRunRequest,
  StartRunResponse,
  StartStatusResponse,
  StopRunResponse,
  WorkflowListResponse,
} from '@indaba/core';

/**
 * What the command line supplies so the server itself spawns and writes nothing (specs/web-app-actions, AC-17). It
 * mirrors {@link LoggingSettingsBackend}: without it the server is the read-only one of delivery step 1.
 */
export interface RunControl {
  /** The workflows of the served roots; a bounded scan, fresh at every call. */
  list(): Promise<WorkflowListResponse>;
  /**
   * Starts the workflow `workflowId` names. Resolves with the start id, or rejects with a {@link RunControlError} whose
   * `code` is `workflow_not_found`, `workflow_invalid` (detail: problems), `confirmation_required` (detail: contentHash,
   * use), `too_many_runs`, `not_saved` or `start_failed`.
   */
  start(request: StartRunRequest): Promise<StartRunResponse>;
  /** `undefined` for an id this control never issued. */
  startStatus(startId: string): StartStatusResponse | undefined;
  /** `undefined` when this server did not start the run `runId` (a trace id). Idempotent. */
  stop(runId: string): StopRunResponse | undefined;
  /** True while a run this server started is alive. Keyed by trace id. */
  isAlive(runId: string): boolean;
  /** Cancels every child, waits at most `STOP_GRACE_MS`, kills the tree of any still alive. */
  stopAll(): Promise<void>;
}

/** A start the control refused, by a `code` the server maps to a status and plain words. */
export class RunControlError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'RunControlError';
  }
}

/** How many runs started by one server may be alive at once. A starting value, not a measurement. */
export const MAX_CONCURRENT_RUNS = 4;
