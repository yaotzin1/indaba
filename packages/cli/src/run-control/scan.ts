import { createHash } from 'node:crypto';
import {
  DEFAULT_WORKFLOW,
  MAX_WORKFLOW_BYTES,
  readWorkflowFile,
  SCAN_MAX_DEPTH,
  SCAN_MAX_DIRECTORIES,
  SCAN_MAX_FILES,
  scanWorkflowFiles,
  tooLarge,
  UnreadableWorkflow,
} from '@indaba/engine';

/**
 * The scan of the served roots for the page (specs/web-app-actions, AC-01). The walk and the confined read are the
 * engine's (`scanWorkflowFiles`, `readWorkflowFile`, shared with the workflow registry); this adds step 2's ids, which
 * slice 2 of specs/workflow-registry replaces with the registry's.
 */
export {
  DEFAULT_WORKFLOW,
  MAX_WORKFLOW_BYTES,
  SCAN_MAX_DEPTH,
  SCAN_MAX_DIRECTORIES,
  SCAN_MAX_FILES,
  tooLarge,
  UnreadableWorkflow,
};

export interface FoundWorkflow {
  /** Opaque: a hash of the root's index and the relative path. Stable between scans; it says nothing about the disk. */
  readonly id: string;
  readonly root: string;
  readonly rootIndex: number;
  /** Relative to its root, forward slashes. */
  readonly path: string;
  /** The file itself. */
  readonly file: string;
  readonly size: number;
}

export interface ScanResult {
  readonly found: readonly FoundWorkflow[];
  /** True when a limit stopped the scan, so the list may be incomplete. */
  readonly truncated: boolean;
}

export function workflowId(rootIndex: number, path: string): string {
  return createHash('sha256').update(`${rootIndex}\u0000${path}`).digest('hex').slice(0, 32);
}

/** Lists the workflow files of each root, each with step 2's id. */
export async function scanRoots(roots: readonly string[]): Promise<ScanResult> {
  const { files, truncated } = await scanWorkflowFiles(roots);
  return { found: files.map((f) => ({ ...f, id: workflowId(f.rootIndex, f.path) })), truncated };
}

/** Reads one found workflow, confined to its root. */
export const readWorkflow = (found: FoundWorkflow): Promise<Buffer> =>
  readWorkflowFile(found.root, found.file);
