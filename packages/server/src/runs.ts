import { join } from 'node:path';
import type { RunSnapshot, RunState, RunSummary, StepView } from '@indaba/core';
import { isRunId, reduceAll, sanitize, TraceReader, type TraceReaderOptions } from '@indaba/engine';

/** Where a run's files are written, under a project root. */
export const TRACE_DIRECTORY = join('.indaba', 'traces');

/** A step id as a workflow may name it; nothing else is looked up. */
export const STEP_ID = /^[A-Za-z0-9_.-]{1,128}$/;

/** The text a person sees from a run is untrusted: escape sequences and controls are dropped (AC-16). */
const clean = (text: string): string => sanitize(text);
const cleanOptional = (text: string | undefined): string | undefined =>
  text === undefined ? undefined : clean(text);

function cleanStep(step: StepView): StepView {
  return {
    ...step,
    reason: cleanOptional(step.reason),
    history: step.history.map((attempt) => ({ ...attempt, reason: cleanOptional(attempt.reason) })),
    skipped: step.skipped.map((skipped) => ({
      runner: clean(skipped.runner),
      reason: clean(skipped.reason),
    })),
    output: step.output.map(clean),
    partialLine: clean(step.partialLine),
  };
}

/** What the page receives of a run: the dashboard's state, without its bookkeeping, with every text cleaned. */
export function snapshotOf(state: RunState): RunSnapshot {
  const { owners: _owners, ...rest } = state;
  return { ...rest, steps: rest.steps.map(cleanStep), notes: rest.notes.map(clean) };
}

/** The runs of the project roots, read from the trace files each one's engine writes. */
export class RunSource {
  private readonly readers: readonly TraceReader[];

  constructor(roots: readonly string[], options: TraceReaderOptions = {}) {
    this.readers = roots.map((root) => new TraceReader(join(root, TRACE_DIRECTORY), options));
  }

  /** Newest first within each root; the roots follow one another in the order they were given. */
  async list(): Promise<RunSummary[]> {
    const lists = await Promise.all(this.readers.map((reader) => reader.listRuns()));
    const seen = new Set<string>();
    const runs: RunSummary[] = [];
    for (const run of lists.flat()) {
      if (!seen.has(run.runId)) {
        seen.add(run.runId);
        runs.push(run);
      }
    }
    return runs;
  }

  /** The reader that holds this run, or undefined when no root has it or the id is not a run id. */
  async find(runId: string): Promise<TraceReader | undefined> {
    if (!isRunId(runId)) {
      return undefined;
    }
    for (const reader of this.readers) {
      if ((await reader.readAll(runId)).length > 0) {
        return reader;
      }
    }
    return undefined;
  }

  async read(runId: string): Promise<RunSnapshot | undefined> {
    const reader = await this.find(runId);
    return reader === undefined ? undefined : snapshotOf(reduceAll(await reader.readAll(runId)));
  }
}

/** One step of a run by id, as the log endpoint serves it. */
export function stepOf(run: RunSnapshot, stepId: string): StepView | undefined {
  return STEP_ID.test(stepId) ? run.steps.find((step) => step.id === stepId) : undefined;
}
