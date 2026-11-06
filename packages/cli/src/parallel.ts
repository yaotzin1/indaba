import { parallelGroups, runsInProject, type StepDefinition } from '@indaba/core';
import { DEFAULT_MAX_PARALLEL_STEPS, PARALLEL_STEP_CAP, type ParallelSource } from '@indaba/engine';

/**
 * What a person agrees to when steps run at the same time (specs/parallel-steps, AC-04a). One text, shown wherever the limit
 * is set above 1 and at the start of such a run, and the same sentence is in `docs/workflow-format.md` (a test keeps them
 * equal).
 */
export const PARALLEL_CONSEQUENCES = [
  'Steps run at the same time. What that costs:',
  '- each agent step makes an extra call first, to say what it intends to change;',
  '- steps whose intentions meet hold a negotiation and may resolve conflicts, which means more calls and more spend;',
  '- each running step works in a worktree of its own on disk;',
  '- a negotiation or a conflict nobody can settle comes to the decider.',
].join('\n');

/** Where the limit came from on the command line side; the workflow's own `max_parallel` is added by the engine. */
export type CliParallelSource = Exclude<ParallelSource, 'workflow'>;

export interface ResolvedLimit {
  readonly limit: number;
  readonly source: CliParallelSource;
  /** One line for each value that was ignored, to print on stderr. */
  readonly warnings: readonly string[];
}

function wholeAtLeastOne(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 1 ? value : undefined;
}

/**
 * The limit of steps that may run at once, strongest first: `--parallel`, the variable `INDABA_PARALLEL`, `parallel.max_steps`
 * of `indaba.config`, then the default (AC-01). The flag is validated by the argument parser (a usage error); a variable that
 * is not a whole number of at least 1 is ignored with a warning and the next source decides; the file was validated when it
 * was read, so a value that differs from the default is the file's.
 */
export function resolveLimit(input: {
  readonly flag: number | undefined;
  readonly variable: string | undefined;
  readonly configured: number;
}): ResolvedLimit {
  if (input.flag !== undefined) {
    return { limit: input.flag, source: 'flag', warnings: [] };
  }
  const warnings: string[] = [];
  if (input.variable !== undefined && input.variable !== '') {
    const value = wholeAtLeastOne(input.variable);
    if (value !== undefined) {
      return { limit: value, source: 'env', warnings };
    }
    warnings.push('INDABA_PARALLEL must be a whole number of at least 1; it is ignored.');
  }
  if (input.configured !== DEFAULT_MAX_PARALLEL_STEPS) {
    return { limit: input.configured, source: 'config', warnings };
  }
  return { limit: DEFAULT_MAX_PARALLEL_STEPS, source: 'default', warnings };
}

/** The value of `--parallel`, or undefined when it was not given. Anything but a whole number of at least 1 is refused. */
export function parseParallelFlag(text: string | undefined): number | undefined {
  if (text === undefined) {
    return undefined;
  }
  const value = wholeAtLeastOne(text);
  if (value === undefined) {
    throw new RangeError(`--parallel must be a whole number of at least 1, got "${text}"`);
  }
  return value;
}

/**
 * What to say at the start of a run for the limit that was asked. Above the cap the steps still run one at a time, and a
 * person who asked for more is told so instead of being promised a parallelism that does not happen. Absent at 1.
 */
export function parallelNotice(asked: number, cap: number = PARALLEL_STEP_CAP): string | undefined {
  if (asked <= 1) {
    return undefined;
  }
  if (asked > cap) {
    return `Steps run one at a time in this version: a limit of ${asked} is recorded, and the limit that runs is ${cap}.`;
  }
  return PARALLEL_CONSEQUENCES;
}

/**
 * The lines `indaba plan` prints for a limit above 1 (AC-32): the groups of steps that may be admitted together if every step
 * took the same time, with the steps that run alone marked. Intents are not known before a run, so the last line says that
 * a group may be narrowed. Empty at a limit of 1.
 */
export function planGroupLines(order: readonly StepDefinition[], limit: number): readonly string[] {
  if (limit <= 1) {
    return [];
  }
  const isolated = new Set<string>();
  const inProject = new Set<string>();
  for (const step of order) {
    if (runsInProject(step, isolated)) {
      inProject.add(step.id);
    } else {
      isolated.add(step.id);
    }
  }
  const groups = parallelGroups(order, limit, (step) => inProject.has(step.id));
  return [
    `Parallel groups (limit ${limit}):`,
    ...groups.map((group, n) => {
      const alone =
        group.length === 1 && inProject.has(group[0] ?? '')
          ? ' (alone: it works in the project directory)'
          : '';
      return `  ${n + 1}. ${group.join(', ')}${alone}`;
    }),
    'A group may be narrowed when the steps in it intend to change the same things (found out at run time).',
  ];
}
