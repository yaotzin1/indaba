import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

/**
 * The bounded scan of a served root for workflow files (specs/web-app-actions, AC-01). A stopgap until the workflow
 * registry exists: it keeps no list and reads the disk at every call. Every limit is a starting value, not a measurement.
 */

/** How many folders below a root the scan looks into. */
export const SCAN_MAX_DEPTH = 4;
/** How many workflow files one scan lists, over all roots. */
export const SCAN_MAX_FILES = 200;
/** How many folders one scan opens, over all roots, so a huge tree cannot hold a request up. */
export const SCAN_MAX_DIRECTORIES = 2000;
/** A workflow file larger than this is listed as invalid and never read. */
export const MAX_WORKFLOW_BYTES = 1024 * 1024;

/** The project's default workflow, the one file under `.indaba/` the scan lists. */
export const DEFAULT_WORKFLOW = '.indaba/workflow.ai.yml';

const WORKFLOW_FILE = /\.workflow\.ai\.ya?ml$/;
/** Folders the scan never enters: dependencies and history, both large, neither a place for a workflow. */
const SKIPPED = new Set(['node_modules', '.git']);

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

const posix = (path: string): string => path.split(sep).join('/');

async function entriesOf(dir: string): Promise<Dirent[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    // A folder that cannot be read is one with nothing to list.
    return [];
  }
}

async function regularFileSize(file: string): Promise<number | undefined> {
  try {
    const info = await lstat(file);
    return info.isFile() ? info.size : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Lists the workflow files of each root: `*.workflow.ai.yml` and `*.workflow.ai.yaml` up to {@link SCAN_MAX_DEPTH}
 * folders down, and the default `.indaba/workflow.ai.yml`. No `node_modules`, no `.git`, no other `.indaba/` content
 * (worktrees and run copies live there), and no link is followed, to a folder or to a file.
 */
export async function scanRoots(roots: readonly string[]): Promise<ScanResult> {
  const found: FoundWorkflow[] = [];
  let directories = 0;
  let truncated = false;

  const add = (rootIndex: number, root: string, file: string, size: number): boolean => {
    if (found.length >= SCAN_MAX_FILES) {
      truncated = true;
      return false;
    }
    const path = posix(relative(root, file));
    found.push({ id: workflowId(rootIndex, path), root, rootIndex, path, file, size });
    return true;
  };

  for (const [rootIndex, root] of roots.entries()) {
    const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
    while (queue.length > 0 && !truncated) {
      const next = queue.shift();
      if (next === undefined) {
        break;
      }
      directories += 1;
      if (directories > SCAN_MAX_DIRECTORIES) {
        truncated = true;
        break;
      }
      for (const entry of await entriesOf(next.dir)) {
        const path = join(next.dir, entry.name);
        if (entry.isSymbolicLink()) {
          continue;
        }
        if (entry.isDirectory()) {
          if (entry.name === '.indaba') {
            if (next.depth === 0) {
              const file = join(root, ...DEFAULT_WORKFLOW.split('/'));
              const size = await regularFileSize(file);
              if (size !== undefined && !add(rootIndex, root, file, size)) {
                break;
              }
            }
            continue;
          }
          if (!SKIPPED.has(entry.name) && next.depth < SCAN_MAX_DEPTH) {
            queue.push({ dir: path, depth: next.depth + 1 });
          }
          continue;
        }
        if (entry.isFile() && WORKFLOW_FILE.test(entry.name)) {
          const size = await regularFileSize(path);
          if (size !== undefined && !add(rootIndex, root, path, size)) {
            break;
          }
        }
      }
    }
    if (truncated) {
      break;
    }
  }
  return { found, truncated };
}

/** Why a workflow file cannot be read for a run; the words are a person's, the code the run control's. */
export class UnreadableWorkflow extends Error {
  constructor(
    readonly reason: 'missing' | 'too_large',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Reads one found workflow into a single buffer, the one that is hashed, parsed and run. The file must still be a
 * regular file (not a link) inside its root, also once links in the folders above it are resolved, and no larger
 * than {@link MAX_WORKFLOW_BYTES}.
 */
export async function readWorkflow(found: FoundWorkflow): Promise<Buffer> {
  const size = await regularFileSize(found.file);
  if (size === undefined) {
    throw new UnreadableWorkflow('missing', 'the file is no longer there');
  }
  if (size > MAX_WORKFLOW_BYTES) {
    throw new UnreadableWorkflow('too_large', tooLarge());
  }
  let inside: string;
  try {
    inside = relative(await realpath(found.root), await realpath(found.file));
  } catch {
    throw new UnreadableWorkflow('missing', 'the file is no longer there');
  }
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new UnreadableWorkflow('missing', 'the file is not inside its project');
  }
  const buffer = await readFile(found.file).catch(() => {
    throw new UnreadableWorkflow('missing', 'the file could not be read');
  });
  if (buffer.length > MAX_WORKFLOW_BYTES) {
    throw new UnreadableWorkflow('too_large', tooLarge());
  }
  return buffer;
}

export const tooLarge = (): string =>
  `the file is larger than ${MAX_WORKFLOW_BYTES / (1024 * 1024)} MiB, so it is not read`;
