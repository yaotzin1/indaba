import { join } from 'node:path';
import type { RegistryEntry, WorkflowRegistry } from '@indaba/core';
import { type FoundWorkflow, scanRoots } from './scan.js';

/**
 * Where `indaba ui` finds the workflows it lists, runs and opens (specs/workflow-registry, slice 2): the registry, by its
 * ids. Without a registry (an embedder, the tests of step 2 and 3a), step 2's scan and ids (spec C-13).
 */

/** A found workflow with what the registry knows of it. */
export interface ListedWorkflow extends FoundWorkflow {
  readonly entry?: RegistryEntry;
}

export interface WorkflowFinder {
  /** The workflows to offer, hidden ones included; never a missing file. */
  list(): Promise<{ readonly found: readonly ListedWorkflow[]; readonly truncated: boolean }>;
  /** The workflow with exactly this id, or undefined. */
  find(id: string): Promise<ListedWorkflow | undefined>;
}

/** How old the last scan may be before the list scans again: a starting value (spec AC-14). */
export const RESCAN_INTERVAL_MS = 30_000;
/** How old the last scan may be before an id that is not found scans once more, for a file just added. */
const FIND_RESCAN_MS = 1_000;

export interface RegistryFinderOptions {
  readonly registry: WorkflowRegistry;
  readonly clock: () => Date;
  readonly intervalMs?: number;
}

/** The finder over a registry: scan at most once per interval, list without missing files, look ids up exactly. */
export function createWorkflowFinder(options: RegistryFinderOptions): WorkflowFinder {
  const { registry, clock } = options;
  const interval = options.intervalMs ?? RESCAN_INTERVAL_MS;
  let lastScan: number | undefined;
  let truncated = false;
  // One scan at a time: a second caller waits for the one under way.
  let scanning: Promise<void> | undefined;

  const scan = (): Promise<void> => {
    scanning ??= registry
      .scan()
      .then((reports) => {
        truncated = reports.some((r) => r.truncated);
        lastScan = clock().getTime();
      })
      .finally(() => {
        scanning = undefined;
      });
    return scanning;
  };
  const olderThan = (ms: number): boolean => lastScan === undefined || clock().getTime() - lastScan >= ms;

  const roots = registry.roots();
  const listed = (entry: RegistryEntry): ListedWorkflow => ({
    id: entry.id,
    root: entry.root,
    rootIndex: Math.max(roots.indexOf(entry.root), 0),
    path: entry.path,
    file: join(entry.root, ...entry.path.split('/')),
    size: 0,
    entry,
  });
  const offered = (entry: RegistryEntry): boolean => entry.validation.state !== 'missing';

  return {
    list: async () => {
      if (olderThan(interval)) {
        await scan();
      }
      const entries = await registry.list({ includeHidden: true });
      return { found: entries.filter(offered).map(listed), truncated };
    },
    find: async (id) => {
      const lookUp = async (): Promise<ListedWorkflow | undefined> => {
        // The page sends a whole id: a prefix that names several entries is no entry, not a refusal to report.
        let entry: RegistryEntry | undefined;
        try {
          entry = await registry.get(id);
        } catch (error) {
          if (error instanceof Error && error.name === 'RegistryError') {
            return undefined;
          }
          throw error;
        }
        return entry !== undefined && entry.id === id && offered(entry) ? listed(entry) : undefined;
      };
      const found = await lookUp();
      if (found !== undefined || !olderThan(FIND_RESCAN_MS)) {
        return found;
      }
      await scan();
      return lookUp();
    },
  };
}

/** Step 2's scan and ids, for a run control or store built without a registry (spec C-13). */
export function scanFinder(roots: readonly string[]): WorkflowFinder {
  return {
    list: () => scanRoots(roots),
    find: async (id) => (await scanRoots(roots)).found.find((f) => f.id === id),
  };
}
