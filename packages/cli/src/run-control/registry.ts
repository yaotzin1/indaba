import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  type Logger,
  noopLogger,
  type RegistryAddRootRequest,
  type RegistryAddRootResponse,
  type RegistryAnnotateRequest,
  type RegistryCopyRequest,
  type RegistryCopyResponse,
  type RegistryEntry,
  type RegistryEntryView,
  RegistryError,
  type RegistryListResponse,
  type RegistryResolveRootRequest,
  type RegistryResolveRootResponse,
  type RegistryRootView,
  type RegistryScanReport,
  type RegistryScanReportView,
  type RegistryScanResponse,
  type WorkflowRegistry,
} from '@indaba/core';
import { DEFAULT_WORKFLOW, isWorkflowFileName, sanitize, scanWorkflowFiles } from '@indaba/engine';
import type { UiRegistryControl } from '../server-loader.js';
import { createWorkflowFinder, type RegistryFinder, type WorkflowFinder } from './finder.js';
import { coveredRoots, isFolder, readRoots, writeRoots } from './roots.js';

/**
 * What the page of `indaba ui` may do with the workflow registry (specs/web-app-registry): list, annotate, copy and remove
 * entries and add a folder, over the registry the command line already holds. The server itself writes nothing.
 */

/** A refusal of the control; the server recognises it by name and `code`, as it does the run control's. */
export class RegistryControlRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RegistryControlError';
  }
}

export interface RegistryHubOptions {
  /** The folders to cover at the start: those `indaba ui` serves, then the per-user list. */
  readonly roots: readonly string[];
  /** The per-user list of added folders, where an import is kept. */
  readonly rootsFile: string;
  readonly pid: number;
  /** The registry over some roots: the built-in file store. */
  readonly createRegistry: (roots: readonly string[]) => WorkflowRegistry;
  readonly clock: () => Date;
  /** Where relative paths typed in the page are resolved from. */
  readonly cwd: string;
  readonly logger?: Logger;
  readonly intervalMs?: number;
}

/** A registry over the folders now covered, and the finder over it. */
interface Covering {
  readonly registry: WorkflowRegistry;
  readonly finder: RegistryFinder;
}

export interface RegistryHub {
  /** The finder the run control and the workflow store use: it follows a folder added at run time. */
  readonly finder: WorkflowFinder;
  readonly control: UiRegistryControl;
}

/** The id of a folder: the first 16 hexadecimal characters of the SHA-256 of its path (spec C-04). */
export const rootIdOf = (folder: string): string =>
  createHash('sha256').update(folder).digest('hex').slice(0, 16);

const isRegistryError = (error: unknown): error is Error & { readonly code: string } =>
  error instanceof RegistryError ||
  (error instanceof Error &&
    error.name === 'RegistryError' &&
    typeof (error as { code?: unknown }).code === 'string');

/** A refusal of the registry as a refusal of the control, with text cleaned for the page. */
const translated = (error: unknown): unknown =>
  isRegistryError(error) ? new RegistryControlRefusal(error.code, sanitize(error.message)) : error;

/** Whether a scan lists this path again, so that Remove would not last (`workflow-registry` C-08). */
const scanFinds = (path: string): boolean => path === DEFAULT_WORKFLOW || isWorkflowFileName(basename(path));

function viewOf(entry: RegistryEntry): RegistryEntryView {
  const missing = entry.validation.state === 'missing';
  return {
    id: entry.id,
    name: sanitize(entry.name),
    project: sanitize(entry.project),
    tags: entry.tags.map((tag) => sanitize(tag)),
    hidden: entry.hidden,
    path: sanitize(entry.path),
    rootId: rootIdOf(entry.root),
    origin: entry.origin,
    ...(entry.copiedFrom === undefined ? {} : { copiedFrom: entry.copiedFrom }),
    validation:
      entry.validation.state === 'valid'
        ? { state: 'valid' }
        : entry.validation.state === 'invalid'
          ? { state: 'invalid', message: sanitize(entry.validation.message) }
          : { state: 'missing', reason: sanitize(entry.validation.reason) },
    ...(entry.lastRun === undefined ? {} : { lastRun: entry.lastRun }),
    removable: missing || !scanFinds(entry.path),
  };
}

const reportView = (report: RegistryScanReport): RegistryScanReportView => ({
  rootId: rootIdOf(report.root),
  found: report.found,
  added: report.added,
  changed: report.changed,
  moved: report.moved,
  missing: report.missing,
  invalid: report.invalid,
  truncated: report.truncated,
  recovered: report.recovered,
});

/** The resolved folder a typed path names, or undefined when it is not a folder that can be read. */
async function resolvedFolder(path: string, cwd: string): Promise<string | undefined> {
  try {
    const real = await realpath(resolve(cwd, path));
    return (await stat(real)).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The registry control of `indaba ui`, and the finder that follows it. The folders covered are the ones given, then the
 * per-user list (spec C-01). A folder added at run time makes a new registry over the longer list and swaps both behind
 * the hub, so a request in flight sees the old one or the new one whole.
 */
export function createRegistryHub(options: RegistryHubOptions): RegistryHub {
  const log = options.logger ?? noopLogger;
  const build = (roots: readonly string[]): Covering => {
    const registry = options.createRegistry(roots);
    const finder = createWorkflowFinder({
      registry,
      clock: options.clock,
      ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
    });
    return { registry, finder };
  };
  // The per-user list is read when the first request needs it, so building the hub does no I/O.
  let current: Promise<Covering> | undefined;
  const covering = (): Promise<Covering> => {
    current ??= coveredRoots(options.roots, options.rootsFile, (folder) => {
      log.info('cli.registry', 'a listed folder is not there any more', { name: basename(folder) });
    }).then(build);
    return current;
  };
  /** One import at a time: two would each write the list from the same start and lose one. */
  let adding: Promise<unknown> = Promise.resolve();

  const finder: WorkflowFinder = {
    list: async () => (await covering()).finder.list(),
    find: async (id) => (await covering()).finder.find(id),
  };

  const viewOfRoot = async (folder: string): Promise<RegistryRootView> => ({
    id: rootIdOf(folder),
    name: sanitize(basename(folder) || folder),
    folder: sanitize(folder),
    readable: await isFolder(folder),
  });

  const covered = async (folder: string): Promise<boolean> => {
    for (const root of (await covering()).registry.roots()) {
      if (root === folder) {
        return true;
      }
      const real = await realpath(root).catch(() => undefined);
      if (real === folder) {
        return true;
      }
    }
    return false;
  };

  const entryView = async (id: string): Promise<RegistryEntryView> => {
    const entry = await (await covering()).registry.get(id);
    if (entry === undefined) {
      throw new RegistryControlRefusal('not_found', 'no entry has this id');
    }
    return viewOf(entry);
  };

  const control: UiRegistryControl = {
    list: async (): Promise<RegistryListResponse> => {
      const now = await covering();
      const { entries, truncated } = await now.finder.entries();
      const roots = await Promise.all(now.registry.roots().map(viewOfRoot));
      return { entries: entries.map(viewOf), roots, truncated };
    },

    scan: async (): Promise<RegistryScanResponse> => {
      try {
        return { reports: (await (await covering()).finder.scanNow()).map(reportView) };
      } catch (error) {
        throw translated(error);
      }
    },

    annotate: async (id: string, request: RegistryAnnotateRequest): Promise<RegistryEntryView> => {
      try {
        await entryView(id);
        return viewOf(await (await covering()).registry.annotate(id, request));
      } catch (error) {
        throw translated(error);
      }
    },

    copy: async (id: string, request: RegistryCopyRequest): Promise<RegistryCopyResponse> => {
      try {
        await entryView(id);
        const { registry } = await covering();
        const folder = registry.roots().find((root) => rootIdOf(root) === request.rootId);
        if (folder === undefined) {
          throw new RegistryControlRefusal('outside_roots', 'the folder is not one the registry covers');
        }
        const copy = await registry.copy(id, {
          folder,
          ...(request.name === undefined ? {} : { name: request.name }),
        });
        return { entry: viewOf(copy.entry), toReview: copy.toReview.map((line) => sanitize(line)) };
      } catch (error) {
        throw translated(error);
      }
    },

    remove: async (id: string): Promise<void> => {
      try {
        await entryView(id);
        await (await covering()).registry.remove(id);
      } catch (error) {
        throw translated(error);
      }
    },

    resolveRoot: async (request: RegistryResolveRootRequest): Promise<RegistryResolveRootResponse> => {
      const folder = await resolvedFolder(request.path, options.cwd);
      if (folder === undefined) {
        throw new RegistryControlRefusal('not_a_folder', 'the path is not a folder that can be read');
      }
      // A bounded walk that reads no file and writes no index: a folder not yet added gets none.
      const { files, truncated } = await scanWorkflowFiles([folder]);
      return {
        folder: sanitize(folder),
        name: sanitize(basename(folder) || folder),
        alreadyCovered: await covered(folder),
        found: files.length,
        atLeast: truncated,
      };
    },

    addRoot: (request: RegistryAddRootRequest): Promise<RegistryAddRootResponse> => {
      const run = async (): Promise<RegistryAddRootResponse> => {
        // The person confirmed the folder as shown; a path that now resolves to something else is not that folder.
        const folder = await resolvedFolder(request.folder, options.cwd);
        if (folder === undefined || folder !== request.folder) {
          throw new RegistryControlRefusal('not_a_folder', 'the folder is not the one that was shown');
        }
        const now = await covering();
        if (await covered(folder)) {
          const reports = await now.finder.scanNow();
          const report = reports.find((r) => rootIdOf(r.root) === rootIdOf(folder));
          return {
            root: await viewOfRoot(folder),
            alreadyCovered: true,
            report: report === undefined ? emptyReport(folder) : reportView(report),
          };
        }
        const saved = await readRoots(options.rootsFile);
        try {
          if (!saved.includes(folder)) {
            await writeRoots(options.rootsFile, [...saved, folder], options.pid);
          }
        } catch (error) {
          log.warn('cli.registry', 'the list of folders could not be written', {
            reason: error instanceof Error ? error.message : String(error),
          });
          throw new RegistryControlRefusal('store_failed', 'the list of folders could not be written');
        }
        // A scan under way on the old registry finishes first, so two writers do not meet on one index.
        await now.finder.settled();
        const next = build([...now.registry.roots(), folder]);
        const reports = await next.finder.scanNow();
        current = Promise.resolve(next);
        log.info('cli.registry', 'folder added', { name: basename(folder) });
        const report = reports.find((r) => r.root === folder);
        return {
          root: await viewOfRoot(folder),
          alreadyCovered: false,
          report: report === undefined ? emptyReport(folder) : reportView(report),
        };
      };
      const result = adding.then(run, run);
      adding = result.catch(() => undefined);
      return result;
    },
  };

  return { finder, control };
}

const emptyReport = (folder: string): RegistryScanReportView => ({
  rootId: rootIdOf(folder),
  found: 0,
  added: 0,
  changed: 0,
  moved: 0,
  missing: 0,
  invalid: 0,
  truncated: false,
  recovered: false,
});
