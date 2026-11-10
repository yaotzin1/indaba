import { type Intent, pathsMeet } from '../mesh/intent.js';
import { Isolation, type StepDefinition } from './model.js';
import { StepStatus } from './state.js';

/**
 * What the engine starts next (specs/parallel-steps, AC-06 to AC-08a). Pure: the same input gives the same answer, no clock,
 * no randomness, no I/O. A step is `kind: 'step'`; an owner call (specs/path-ownership) is `kind: 'owner'`.
 */
export type Admission =
  | { readonly kind: 'step'; readonly stepId: string }
  | { readonly kind: 'owner'; readonly role: string };

export interface AdmitInput {
  /** The steps in topological order, as `DagBuilder.build` returns them. */
  readonly order: readonly StepDefinition[];
  readonly states: ReadonlyMap<string, StepStatus>;
  /** Ids of the steps that are running now. */
  readonly running: ReadonlySet<string>;
  /** How many times each step was put back to wait for another (AC-13). */
  readonly waiting: ReadonlyMap<string, number>;
  /** The number of steps that may run at once. */
  readonly limit: number;
  /** A step put back this many times is admitted alone. */
  readonly maxWaits: number;
  /** Owner roles with a request waiting, in board order; empty without owners. */
  readonly ownerQueue: readonly string[];
  /** Whether a step runs in the project directory (AC-07). */
  readonly runsInProject: (step: StepDefinition) => boolean;
  /** After a failure that is not retried no new step is admitted (AC-27). */
  readonly halted: boolean;
}

/**
 * Today's rule for where a step works: in the project directory unless it asks for a worktree or depends on a step that
 * works in one (`isolated` holds the ids of the steps that do).
 */
export function runsInProject(step: StepDefinition, isolated: ReadonlySet<string>): boolean {
  return !(step.isolation === Isolation.GitWorktree || step.dependsOn.some((id) => isolated.has(id)));
}

/**
 * The work to start now, in the order of AC-08a: (1) a step put back `maxWaits` times, alone; (2) a project-directory step,
 * alone; (3) owner calls; (4) other ready steps, each kind in position order. A kind that must run alone waits for the
 * running work to settle and blocks everything after it meanwhile. With a limit of 1 the answer is the first ready step in
 * order, which is what the sequential loop did.
 */
export function admit(input: AdmitInput): readonly Admission[] {
  if (input.halted) {
    return [];
  }
  const slots = input.limit - input.running.size;
  if (slots <= 0) {
    return [];
  }

  // A project-directory step that is running admits nothing beside it (AC-07).
  for (const step of input.order) {
    if (input.running.has(step.id) && input.runsInProject(step)) {
      return [];
    }
  }

  const ready = input.order.filter((step) => isReady(step, input));
  const alone = (step: StepDefinition | undefined): readonly Admission[] | undefined => {
    if (step === undefined) {
      return undefined;
    }
    return input.running.size === 0 ? [{ kind: 'step', stepId: step.id }] : [];
  };

  const starved = alone(ready.find((step) => (input.waiting.get(step.id) ?? 0) >= input.maxWaits));
  if (starved !== undefined) {
    return starved;
  }
  const inProject = alone(ready.find((step) => input.runsInProject(step)));
  if (inProject !== undefined) {
    return inProject;
  }

  const admissions: Admission[] = [];
  for (const role of input.ownerQueue) {
    if (admissions.length >= slots) {
      return admissions;
    }
    admissions.push({ kind: 'owner', role });
  }
  for (const step of ready) {
    if (admissions.length >= slots) {
      break;
    }
    admissions.push({ kind: 'step', stepId: step.id });
  }
  return admissions;
}

function isReady(step: StepDefinition, input: AdmitInput): boolean {
  return (
    input.states.get(step.id) === StepStatus.Pending &&
    !input.running.has(step.id) &&
    step.dependsOn.every((id) => input.states.get(id) === StepStatus.Completed)
  );
}

/**
 * Whether two intents meet (AC-12): a path of one matches a path of the other (a glob against a glob by the literal prefix
 * before the first wildcard, C-07, so it errs towards "they meet"), or one needs a name the other provides.
 */
export function meets(a: Intent, b: Intent): boolean {
  return (
    pathsMeet(a.paths, b.paths) ||
    a.needs.some((name) => b.provides.some((p) => p.name === name)) ||
    b.needs.some((name) => a.provides.some((p) => p.name === name))
  );
}

/**
 * The id of the first working step, in the order given, whose intent this one meets (AC-13), or `undefined` when it may
 * start. A step's own intent is never compared with itself.
 */
export function mustWait(intent: Intent, working: readonly Intent[]): string | undefined {
  return working.find((other) => other.stepId !== intent.stepId && meets(intent, other))?.stepId;
}

/**
 * The groups of steps that may be admitted together if every step took the same time (AC-32): what `indaba plan` prints.
 * Intents are not known before a run, so a group may be narrowed at run time.
 */
export function parallelGroups(
  order: readonly StepDefinition[],
  limit: number,
  inProject: (step: StepDefinition) => boolean,
): readonly (readonly string[])[] {
  const states = new Map<string, StepStatus>(order.map((step) => [step.id, StepStatus.Pending]));
  const groups: string[][] = [];
  for (;;) {
    const admitted = admit({
      order,
      states,
      running: new Set(),
      waiting: new Map(),
      limit,
      maxWaits: Number.MAX_SAFE_INTEGER,
      ownerQueue: [],
      runsInProject: inProject,
      halted: false,
    });
    const group = admitted.flatMap((a) => (a.kind === 'step' ? [a.stepId] : []));
    if (group.length === 0) {
      return groups;
    }
    groups.push(group);
    for (const id of group) {
      states.set(id, StepStatus.Completed);
    }
  }
}
