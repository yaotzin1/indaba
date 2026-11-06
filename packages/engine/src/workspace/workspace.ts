export interface Workspace {
  /** Absolute path of the isolated checkout. */
  path(): string;
  /** Unified diff of everything changed since the base commit, untracked files included. */
  diff(): Promise<string>;
  /** Idempotent teardown. */
  destroy(): Promise<void>;
}

/**
 * What a workspace remembers about itself at one moment, to be given back to `restore`. The owner defines the keys; a caller
 * keeps it and passes it on without reading it (specs/step-stalls, C-06). Strings only, so it can be recorded and checked.
 */
export type WorkspaceCheckpoint = Readonly<Record<string, string>>;

/**
 * A workspace that can be put back as it was (specs/step-stalls, AC-07). Optional on purpose: a `Workspace` written before it
 * existed keeps working, and a step that asks for a stall retry on one of those fails with a fixed reason instead.
 */
export interface RestorableWorkspace extends Workspace {
  /** Records the state of the workspace now: everything the engine and the agent left in it, uncommitted and untracked included. */
  checkpoint(): Promise<WorkspaceCheckpoint>;
  /** Puts the workspace back to a checkpoint of its own, discarding what changed since. Ignored files are never touched. */
  restore(checkpoint: WorkspaceCheckpoint): Promise<void>;
}

export function isRestorable(workspace: Workspace): workspace is RestorableWorkspace {
  return (
    'checkpoint' in workspace &&
    typeof workspace.checkpoint === 'function' &&
    'restore' in workspace &&
    typeof workspace.restore === 'function'
  );
}

export interface WorkspaceManager {
  create(taskId: string, variant?: string): Promise<Workspace>;
}
