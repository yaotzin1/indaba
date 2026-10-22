import { chmod, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  type Logger,
  noopLogger,
  type SaveWorkflowSourceRequest,
  type SaveWorkflowSourceResponse,
  type WorkflowCheckResponse,
  type WorkflowDefinition,
  type WorkflowProblem,
  type WorkflowSourceResponse,
  WorkflowValidationError,
} from '@indaba/core';
import { sanitize } from '@indaba/engine';
import type { UiWorkflowStore } from '../server-loader.js';
import { contentHash } from './confirm.js';
import {
  type FoundWorkflow,
  MAX_WORKFLOW_BYTES,
  readWorkflow,
  scanRoots,
  UnreadableWorkflow,
} from './scan.js';

/**
 * A refusal of the workflow store. The server recognises it by `name` and `code`, as it does `RunControlError`, because
 * the command line does not import the optional `@indaba/server`.
 */
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

export interface WorkflowStoreOptions {
  readonly roots: readonly string[];
  /** Parses a workflow as `indaba validate` does; throws `WorkflowValidationError` with its problems. */
  readonly parse: (source: string) => WorkflowDefinition;
  /** This process's id, for the name of the temporary file of a save. */
  readonly pid: number;
  readonly logger?: Logger;
}

/** The suffix of the temporary file a save writes beside its target; never the name of a workflow the scan lists. */
export const SAVE_SUFFIX = '.indaba-save';

/** `yaml` words the position of a syntax error this way; nothing else in a problem is read as a position. */
const POSITION = /at line (\d+), column (\d+)/;

/** UTF-8 that fails on a byte sequence it cannot decode, and keeps a byte-order mark so the bytes round-trip. */
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function textOf(buffer: Buffer): string | undefined {
  try {
    return decoder.decode(buffer);
  } catch {
    return undefined;
  }
}

function problemOf(message: string): WorkflowProblem {
  const clean = sanitize(message);
  const at = POSITION.exec(clean);
  const line = at === null ? Number.NaN : Number(at[1]);
  const column = at === null ? Number.NaN : Number(at[2]);
  return Number.isSafeInteger(line) && Number.isSafeInteger(column) && line > 0 && column > 0
    ? { message: clean, line, column }
    : { message: clean };
}

const nameOf = (path: string): string => basename(path).replace(/\.workflow\.ai\.ya?ml$|\.ya?ml$/, '');

/**
 * Reads, checks and saves the text of the workflows the step 2 scan lists (specs/web-app-editing-core). It never creates,
 * renames or deletes a workflow: a save replaces the file the scan returned, through a temporary file and a rename, and
 * only when the file still holds the bytes the page started from.
 */
export function createWorkflowStore(options: WorkflowStoreOptions): UiWorkflowStore {
  const log = options.logger ?? noopLogger;
  let saves = 0;

  const problemsOf = (text: string): { problems: WorkflowProblem[]; name: string | undefined } => {
    try {
      const workflow = options.parse(text);
      return { problems: [], name: sanitize(workflow.name) };
    } catch (error) {
      if (error instanceof WorkflowValidationError) {
        return { problems: error.problems.map(problemOf), name: undefined };
      }
      return {
        problems: [problemOf(error instanceof Error ? error.message : String(error))],
        name: undefined,
      };
    }
  };

  const refuse = (code: string, message: string, detail?: Readonly<Record<string, unknown>>): never => {
    throw new WorkflowStoreError(code, message, detail);
  };

  const find = async (id: string): Promise<FoundWorkflow> => {
    const found = (await scanRoots(options.roots)).found.find((f) => f.id === id);
    return found ?? refuse('workflow_not_found', 'no workflow has this id');
  };

  /** The bytes on disk, through the same confined read as a run. */
  const bytesOf = async (found: FoundWorkflow): Promise<Buffer> => {
    try {
      return await readWorkflow(found);
    } catch (error) {
      if (error instanceof UnreadableWorkflow && error.reason === 'too_large') {
        return refuse('too_large', error.message);
      }
      return refuse('workflow_not_found', 'the workflow could not be read');
    }
  };

  const changed = (buffer: Buffer): never => {
    const text = textOf(buffer);
    if (text === undefined) {
      return refuse('not_text', 'the file on disk is not UTF-8');
    }
    return refuse('changed_on_disk', 'the file changed on disk', {
      current: { text, contentHash: contentHash(buffer) },
    });
  };

  return {
    read: async (id: string): Promise<WorkflowSourceResponse> => {
      const found = await find(id);
      const buffer = await bytesOf(found);
      const text = textOf(buffer) ?? refuse('not_text', 'the file is not UTF-8');
      const { problems, name } = problemsOf(text);
      return {
        workflow: {
          id: found.id,
          name: name ?? sanitize(nameOf(found.path)),
          path: found.path,
          project: basename(found.root),
          valid: problems.length === 0,
          problems: problems.map((p) => p.message),
        },
        text,
        contentHash: contentHash(buffer),
        problems,
      };
    },

    save: async (id: string, request: SaveWorkflowSourceRequest): Promise<SaveWorkflowSourceResponse> => {
      const bytes = Buffer.from(request.text, 'utf8');
      if (bytes.length > MAX_WORKFLOW_BYTES) {
        refuse('too_large', 'the text is larger than the limit');
      }
      const found = await find(id);
      const before = await bytesOf(found);
      if (contentHash(before) !== request.baseHash) {
        changed(before);
      }
      const hash = contentHash(bytes);
      const { problems } = problemsOf(request.text);
      if (hash === request.baseHash) {
        // The same bytes: nothing to write, and the confirmation still holds (AC-07).
        return { contentHash: hash, problems };
      }

      saves += 1;
      const temporary = `${found.file}.${options.pid}.${saves}${SAVE_SUFFIX}`;
      try {
        const mode = (await stat(found.file)).mode & 0o7777;
        // `wx`: a file or link planted at this name fails the save instead of being followed (AC-05).
        await writeFile(temporary, bytes, { flag: 'wx', mode });
        // The process's umask may have narrowed the mode given at creation.
        await chmod(temporary, mode);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        log.info('cli.ui', 'a workflow could not be saved', {
          workflow: found.path,
          reason: error instanceof Error ? error.message : String(error),
        });
        return refuse('not_saved', 'the temporary file could not be written');
      }
      // Once more just before the rename: still a regular file inside its root, still the bytes the page started from.
      let now: Buffer;
      try {
        now = await bytesOf(found);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
      if (contentHash(now) !== request.baseHash) {
        await rm(temporary, { force: true }).catch(() => undefined);
        changed(now);
      }
      try {
        await rename(temporary, found.file);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        log.info('cli.ui', 'a workflow could not be saved', {
          workflow: found.path,
          reason: error instanceof Error ? error.message : String(error),
        });
        return refuse('not_saved', 'the file could not be replaced');
      }
      log.info('cli.ui', 'workflow saved', {
        workflow: found.path,
        contentHash: hash,
        problems: problems.length,
      });
      return { contentHash: hash, problems };
    },

    check: (text: string): WorkflowCheckResponse => ({ problems: problemsOf(text).problems }),
  };
}
