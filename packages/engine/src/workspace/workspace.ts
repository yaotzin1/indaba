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

/** One place where a landing found both sides changed the same lines. Paths are project-relative and confined. */
export interface ConflictHunk {
  readonly path: string;
  /** The run workspace's side, bounded and cleaned of control characters. */
  readonly ours: string;
  /** The landing step's side, bounded and cleaned of control characters. */
  readonly theirs: string;
}

/**
 * The result of landing a fork. On a conflict the run workspace is unchanged and `workspace` holds both sides with the
 * conflict markers; the caller destroys it.
 */
export type LandResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly conflicts: readonly ConflictHunk[]; readonly workspace: Workspace };

/**
 * A workspace that parallel steps can fork and land (specs/parallel-steps, T-08). Optional on purpose, like
 * `RestorableWorkspace`: a `Workspace` written before it existed keeps working and stays a single-step workspace.
 */
export interface ForkableWorkspace extends Workspace {
  /** A worktree whose `HEAD` is a commit of this workspace's current state, so its `diff()` is its own change only. */
  fork(name: string): Promise<Workspace>;
  /** Three-way applies the child's change; on a conflict this workspace is left as it was. */
  land(child: Workspace): Promise<LandResult>;
}

export function isForkable(workspace: Workspace): workspace is ForkableWorkspace {
  return (
    'fork' in workspace &&
    typeof workspace.fork === 'function' &&
    'land' in workspace &&
    typeof workspace.land === 'function'
  );
}
