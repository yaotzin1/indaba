export interface Workspace {
  /** Absolute path of the isolated checkout. */
  path(): string;
  /** Unified diff of everything changed since the base commit, untracked files included. */
  diff(): Promise<string>;
  /** Idempotent teardown. */
  destroy(): Promise<void>;
}

export interface WorkspaceManager {
  create(taskId: string, variant?: string): Promise<Workspace>;
}
