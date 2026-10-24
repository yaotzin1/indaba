import { mkdir, open, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  type Logger,
  noopLogger,
  type StartRunRequest,
  type StartRunResponse,
  type StartStatusResponse,
  type StopRunResponse,
  type WorkflowDefinition,
  type WorkflowListResponse,
  type WorkflowSummary,
  WorkflowValidationError,
} from '@indaba/core';
import { isRunId, parseRecord, sanitize } from '@indaba/engine';
import { redact } from '../redact.js';
import type { RunChild, RunStarter } from '../run-child.js';
import type { UiRunControl } from '../server-loader.js';
import { ConfirmationStore, contentHash, summaryOfUse } from './confirm.js';
import { type ListedWorkflow, scanFinder, type WorkflowFinder } from './finder.js';
import { type FoundWorkflow, readWorkflow, tooLarge, UnreadableWorkflow } from './scan.js';

/** How many runs started from the page may be alive at once. The server's `MAX_CONCURRENT_RUNS`, a starting value. */
export const MAX_CONCURRENT_RUNS = 4;
/** How long a cancelled run has to tear down before its tree is killed. A starting value, not a measurement. */
export const STOP_GRACE_MS = 5000;
/** Where the confirmed bytes of a run wait for the child, under a root. Swept when `indaba ui` starts. */
export const RUN_INPUTS = join('.indaba', 'run-inputs');
const TRACES = join('.indaba', 'traces');
const TRACE_SUFFIX = '.events.jsonl';
/** The first record of a trace is short; reading more than this to find its end means it is not the root's. */
const FIRST_LINE_BYTES = 64 * 1024;
const ROOT_TASK_ATTRIBUTE = 'indaba.task.id';

/**
 * A start the control refused. The server recognises it by `name` and `code`, not by class: `@indaba/server` is optional
 * and its types are not imported here, and two installed copies of a package would defeat `instanceof` anyway.
 */
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

export interface RunControlOptions {
  readonly roots: readonly string[];
  /** Where the workflows are found: the registry's finder in `indaba ui`; step 2's scan when absent (spec C-13). */
  readonly finder?: WorkflowFinder;
  readonly starter: RunStarter;
  /** The environment of every child: the one `indaba ui` started with, never anything the page sent (AC-18). */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** The file of confirmed workflows, in the user's configuration folder; a test passes a temporary one. */
  readonly confirmationFile: string;
  /** This process's id, for the name of the store's temporary file. */
  readonly pid: number;
  /** A fresh random part of a start id, from `[0-9a-f]`; injected so a test can name its starts. */
  readonly ids: () => string;
  /** Parses a workflow as `indaba validate` does; throws {@link WorkflowValidationError} with its problems. */
  readonly parse: (source: string) => WorkflowDefinition;
  readonly logger?: Logger;
  readonly graceMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxConcurrent?: number;
}

interface Started {
  readonly startId: string;
  readonly root: string;
  readonly child: RunChild;
  readonly copy: string;
  runId: string | undefined;
  exited: boolean;
  /** The lookup of the trace after exit is done: a start with no trace by then has failed. */
  settled: boolean;
  lookup: Promise<void> | undefined;
  /** Resolves once the exit has been handled: the copy removed, the trace looked for, the end logged. */
  finished: Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The id a start gets: the task id of the run, from the fixed alphabet, never taken from the request (AC-08). */
const START_ID = /^web-[0-9a-f]{8,48}$/;

/** The task id written by the root span, the first record of a trace; undefined for anything else. */
async function taskOfTrace(file: string): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(file, 'r');
    const buffer = Buffer.alloc(FIRST_LINE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, FIRST_LINE_BYTES, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const end = text.indexOf('\n');
    if (end < 0) {
      return undefined;
    }
    const record = parseRecord(text.slice(0, end));
    if (record.type !== 'span_started' || record.parentSpanId !== undefined) {
      return undefined;
    }
    const task = record.attributes[ROOT_TASK_ATTRIBUTE];
    return typeof task === 'string' ? task : undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Runs workflows of the served roots for the page (specs/web-app-actions): one `indaba run` child per run, started
 * from the confirmed bytes, stopped as Ctrl+C stops it, killed with its tree only when it does not stop in time.
 */
export function createRunControl(options: RunControlOptions): UiRunControl {
  const log = options.logger ?? noopLogger;
  const sleep = options.sleep ?? defaultSleep;
  const graceMs = options.graceMs ?? STOP_GRACE_MS;
  const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT_RUNS;
  const store = new ConfirmationStore(options.confirmationFile, options.pid);
  const starts = new Map<string, Started>();
  /** Trace file name to the task id of its root span; a first line never changes once written. */
  const traceTasks = new Map<string, string | undefined>();
  let reserved = 0;

  // A crashed `indaba ui` leaves its copies behind; they go before anything new is written (AC-05).
  const swept = Promise.all(
    options.roots.map(async (root) => {
      const folder = join(root, RUN_INPUTS);
      let names: string[];
      try {
        names = await readdir(folder);
      } catch {
        return;
      }
      for (const name of names.filter((n) => n.endsWith('.yml'))) {
        await rm(join(folder, name), { force: true }).catch(() => undefined);
      }
    }),
  );

  const alive = (): number => [...starts.values()].filter((s) => !s.exited).length;

  /** Finds the trace this start's engine opened, by the task id of its root span (AC-08). */
  const findTrace = async (started: Started): Promise<void> => {
    const folder = join(started.root, TRACES);
    let names: string[];
    try {
      names = await readdir(folder);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.endsWith(TRACE_SUFFIX)) {
        continue;
      }
      const traceId = name.slice(0, -TRACE_SUFFIX.length);
      if (!isRunId(traceId)) {
        continue;
      }
      const key = join(folder, name);
      let task = traceTasks.get(key);
      if (!traceTasks.has(key)) {
        task = await taskOfTrace(key);
        // Only a complete first line is final: a file being written may not have one yet.
        if (task !== undefined) {
          traceTasks.set(key, task);
        }
      }
      if (task === started.startId) {
        started.runId = traceId;
        return;
      }
    }
  };

  const lookUp = (started: Started): Promise<void> => {
    started.lookup ??= findTrace(started).finally(() => {
      started.lookup = undefined;
    });
    return started.lookup;
  };

  const refuse = (code: string, message: string, detail?: Readonly<Record<string, unknown>>): never => {
    throw new RunControlError(code, message, detail);
  };

  const finder = options.finder ?? scanFinder(options.roots);

  /** The summary of a workflow, with the person's name for it when the registry has one. */
  const describe = async (found: ListedWorkflow): Promise<WorkflowSummary> => {
    const summary = await read(found);
    return found.entry === undefined ? summary : { ...summary, name: sanitize(found.entry.name) };
  };

  const read = async (found: ListedWorkflow): Promise<WorkflowSummary> => {
    const entry = found.entry;
    const summary = {
      id: found.id,
      path: found.path,
      project: entry?.project ?? basename(found.root),
      ...(entry === undefined
        ? {}
        : {
            tags: entry.tags,
            hidden: entry.hidden,
            ...(entry.lastRun === undefined ? {} : { lastRun: entry.lastRun }),
          }),
    };
    const fallbackName = basename(found.path).replace(/\.workflow\.ai\.ya?ml$|\.ya?ml$/, '');
    let buffer: Buffer;
    try {
      buffer = await readWorkflow(found);
    } catch (error) {
      const problem = error instanceof UnreadableWorkflow ? error.message : tooLarge();
      return { ...summary, name: sanitize(fallbackName), valid: false, problems: [problem] };
    }
    try {
      const workflow = options.parse(buffer.toString('utf8'));
      return { ...summary, name: sanitize(workflow.name), valid: true, problems: [] };
    } catch (error) {
      const problems =
        error instanceof WorkflowValidationError
          ? error.problems
          : [error instanceof Error ? error.message : String(error)];
      return {
        ...summary,
        name: sanitize(fallbackName),
        valid: false,
        problems: problems.map((p) => sanitize(p)),
      };
    }
  };

  const launch = async (
    found: FoundWorkflow,
    buffer: Buffer,
    fullAccessPage: boolean,
  ): Promise<StartRunResponse> => {
    const startId = `web-${options.ids()}`;
    if (!START_ID.test(startId)) {
      refuse('start_failed', 'the generated start id has the wrong shape');
    }
    const folder = join(found.root, RUN_INPUTS);
    const copy = join(folder, `${startId}.yml`);
    try {
      await mkdir(folder, { recursive: true });
      // `wx`: an existing file, or a link planted at this name, is an error, never followed (AC-05).
      await writeFile(copy, buffer, { flag: 'wx' });
    } catch (error) {
      log.info('cli.ui', 'the run copy could not be written', {
        startId,
        reason: error instanceof Error ? error.message : String(error),
      });
      return refuse('start_failed', 'the run copy could not be written');
    }
    let child: RunChild;
    try {
      // `--` before the file, so a name that starts with "-" is not an option; cwd is the root, as the file is
      // resolved against the working directory (AC-03).
      child = options.starter(
        [
          'run',
          '--workdir',
          found.root,
          '--task-id',
          startId,
          // Only after the person saw the `full` steps listed for this content (specs/agent-permissions, AC-05).
          ...(fullAccessPage ? ['--allow-full-access=page'] : []),
          '--',
          `${RUN_INPUTS.split('\\').join('/')}/${startId}.yml`,
        ],
        { cwd: found.root, environment: options.environment },
      );
    } catch (error) {
      await rm(copy, { force: true }).catch(() => undefined);
      log.info('cli.ui', 'the run could not be started', {
        startId,
        reason: error instanceof Error ? error.message : String(error),
      });
      return refuse('start_failed', 'the run could not be started');
    }
    const started: Started = {
      startId,
      root: found.root,
      child,
      copy,
      runId: undefined,
      exited: false,
      settled: false,
      lookup: undefined,
      finished: Promise.resolve(),
    };
    started.finished = child.exited.then(async (code) => {
      started.exited = true;
      await rm(copy, { force: true }).catch(() => undefined);
      if (started.runId === undefined) {
        await lookUp(started);
      }
      started.settled = true;
      log.info('cli.ui', 'run ended', { startId, exitCode: code });
    });
    starts.set(startId, started);
    log.info('cli.ui', 'run started', { startId, workflow: found.path });
    return { startId };
  };

  return {
    list: async (): Promise<WorkflowListResponse> => {
      const scan = await finder.list();
      return { workflows: await Promise.all(scan.found.map(describe)), truncated: scan.truncated };
    },

    start: async (request: StartRunRequest): Promise<StartRunResponse> => {
      await swept;
      if (alive() + reserved >= maxConcurrent) {
        refuse('too_many_runs', `${maxConcurrent} runs are alive`);
      }
      // The slot is held from here, so two starts at once cannot both pass the limit.
      reserved += 1;
      try {
        const found = await finder.find(request.workflowId);
        if (found === undefined) {
          return refuse('workflow_not_found', 'no workflow has this id');
        }
        let buffer: Buffer;
        try {
          buffer = await readWorkflow(found);
        } catch (error) {
          if (error instanceof UnreadableWorkflow && error.reason === 'too_large') {
            return refuse('workflow_invalid', error.message, { problems: [error.message] });
          }
          return refuse('workflow_not_found', 'the workflow could not be read');
        }
        let workflow: WorkflowDefinition;
        try {
          workflow = options.parse(buffer.toString('utf8'));
        } catch (error) {
          if (error instanceof WorkflowValidationError) {
            return refuse('workflow_invalid', 'the workflow is invalid', {
              problems: error.problems.map((p) => sanitize(p)),
            });
          }
          throw error;
        }
        const hash = contentHash(buffer);
        let rootKey: string;
        try {
          rootKey = await realpath(found.root);
        } catch {
          return refuse('workflow_not_found', 'the project is no longer there');
        }
        if (!(await store.has(rootKey, found.path, hash))) {
          if (request.confirmedHash !== hash) {
            // Nothing is written to the project for this answer (AC-05).
            return refuse('confirmation_required', 'confirm what this workflow uses', {
              contentHash: hash,
              use: summaryOfUse(workflow),
            });
          }
          try {
            await store.add(rootKey, found.path, hash);
          } catch (error) {
            log.info('cli.ui', 'a confirmation could not be saved', {
              reason: error instanceof Error ? error.message : String(error),
            });
            return refuse('not_saved', 'the confirmation could not be saved');
          }
        }
        // The `full` steps are listed every time a run starts, whether or not this file was confirmed before (AC-05).
        const fullSteps = summaryOfUse(workflow).fullAccessSteps;
        if (fullSteps.length > 0 && request.fullAccessConfirmedHash !== hash) {
          return refuse('full_access_required', 'confirm the steps that have full access', {
            contentHash: hash,
            steps: fullSteps,
          });
        }
        return await launch(found, buffer, fullSteps.length > 0);
      } finally {
        reserved -= 1;
      }
    },

    startStatus: (startId: string): StartStatusResponse | undefined => {
      const started = starts.get(startId);
      if (started === undefined) {
        return undefined;
      }
      if (started.runId !== undefined) {
        return { state: 'running', runId: started.runId };
      }
      if (started.settled) {
        const first =
          redact(started.child.stderr(), options.environment)
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line !== '') ?? 'The run ended before it started.';
        return { state: 'failed', failure: sanitize(first) };
      }
      // The next poll sees what this lookup finds; the answer itself never waits on the disk.
      void lookUp(started);
      return { state: 'starting' };
    },

    stop: (runId: string): StopRunResponse | undefined => {
      const started = [...starts.values()].find((s) => s.runId === runId);
      if (started === undefined) {
        return undefined;
      }
      if (started.exited) {
        return { state: 'ended' };
      }
      started.child.cancel();
      return { state: 'stopping' };
    },

    isAlive: (runId: string): boolean => [...starts.values()].some((s) => s.runId === runId && !s.exited),

    stopAll: async (): Promise<void> => {
      const running = [...starts.values()].filter((s) => !s.exited);
      if (running.length === 0) {
        return;
      }
      for (const started of running) {
        started.child.cancel();
      }
      const allExited = Promise.all(running.map((s) => s.child.exited));
      await Promise.race([allExited, sleep(graceMs)]);
      // Only a child still alive now is killed; one that has exited is never signalled (AC-11).
      const stubborn = running.filter((s) => !s.exited);
      for (const started of stubborn) {
        started.child.kill();
      }
      if (stubborn.length > 0) {
        await Promise.race([Promise.all(stubborn.map((s) => s.child.exited)), sleep(graceMs)]);
      }
      // Let each exit handler remove its copy before the command ends.
      await Promise.race([Promise.all(running.map((s) => s.finished)), sleep(graceMs)]);
      log.info('cli.ui', 'runs stopped at exit', {
        cancelled: running.length - stubborn.length,
        killed: stubborn.length,
      });
    },
  };
}
