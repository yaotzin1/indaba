import type {
  SaveWorkflowSourceRequest,
  SaveWorkflowSourceResponse,
  WorkflowCheckResponse,
  WorkflowSourceResponse,
} from '@indaba/core';

/**
 * What the command line supplies so the server reads, checks and writes no workflow file itself (specs/web-app-editing-core,
 * AC-14). Like {@link RunControl}: without it the source resources answer 404 and the page offers no Edit.
 */
export interface WorkflowStore {
  /** Rejects with a {@link WorkflowStoreError}: `workflow_not_found`, `too_large`, `not_text`. */
  read(id: string): Promise<WorkflowSourceResponse>;
  /** Rejects with `workflow_not_found`, `too_large`, `changed_on_disk` (detail: current), `not_saved`. */
  save(id: string, request: SaveWorkflowSourceRequest): Promise<SaveWorkflowSourceResponse>;
  /** What `indaba validate` would say of this text; reads no file. */
  check(text: string): WorkflowCheckResponse;
}

/** A refusal of a workflow store, by a `code` the server maps to a status and plain words. */
export class WorkflowStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'WorkflowStoreError';
  }
}

/** The largest workflow text, in UTF-8 bytes: the scan's limit. A starting value, not a measurement. */
export const MAX_SOURCE_BYTES = 1024 * 1024;

/** The largest body of a source `PUT` or a check `POST`: the text with room for JSON escaping. A starting value. */
export const MAX_SOURCE_BODY_BYTES = 2 * 1024 * 1024;
