import { describe, expect, it } from 'vitest';
import {
  type AdmitInput,
  admit,
  defineStep,
  Isolation,
  parallelGroups,
  runsInProject,
  type StepDefinition,
  StepStatus,
} from '../src/index.js';

const step = (
  id: string,
  dependsOn: string[] = [],
  isolation: Isolation = Isolation.GitWorktree,
): StepDefinition => defineStep({ id, dependsOn, isolation });

function input(over: Partial<AdmitInput> & { readonly order: readonly StepDefinition[] }): AdmitInput {
  return {
    states: new Map(over.order.map((s) => [s.id, StepStatus.Pending])),
    running: new Set(),
    waiting: new Map(),
    limit: 1,
    maxWaits: 3,
    ownerQueue: [],
    runsInProject: () => false,
    halted: false,
    ...over,
  };
}

const ids = (admissions: ReturnType<typeof admit>): string[] =>
  admissions.map((a) => (a.kind === 'step' ? a.stepId : `owner:${a.role}`));

describe('admit (specs/parallel-steps, AC-06 to AC-08a)', () => {
  const a = step('a');
  const b = step('b');
  const c = step('c', ['a']);

  it('with a limit of 1 admits the first ready step in order, as the sequential loop did (AC-05, AC-06)', () => {
    expect(ids(admit(input({ order: [a, b, c] })))).toEqual(['a']);
  });

  it('admits ready steps in topological position order up to the limit (AC-06)', () => {
    expect(ids(admit(input({ order: [a, b, c], limit: 2 })))).toEqual(['a', 'b']);
    expect(ids(admit(input({ order: [a, b, c], limit: 5 })))).toEqual(['a', 'b']);
  });

  it('does not admit a step whose dependency is not completed', () => {
    const states = new Map<string, StepStatus>([
      ['a', StepStatus.Running],
      ['b', StepStatus.Completed],
      ['c', StepStatus.Pending],
    ]);
    expect(ids(admit(input({ order: [a, b, c], states, running: new Set(['a']), limit: 3 })))).toEqual([]);
  });

  it('admits a step once its dependency is completed, and not a running or completed one', () => {
    const states = new Map<string, StepStatus>([
      ['a', StepStatus.Completed],
      ['b', StepStatus.Running],
      ['c', StepStatus.Pending],
    ]);
    expect(ids(admit(input({ order: [a, b, c], states, running: new Set(['b']), limit: 2 })))).toEqual(['c']);
  });

  it('counts running steps against the limit', () => {
    const states = new Map<string, StepStatus>([
      ['a', StepStatus.Running],
      ['b', StepStatus.Pending],
      ['c', StepStatus.Pending],
    ]);
    expect(ids(admit(input({ order: [a, b, c], states, running: new Set(['a']), limit: 1 })))).toEqual([]);
    expect(ids(admit(input({ order: [a, b, c], states, running: new Set(['a']), limit: 2 })))).toEqual(['b']);
  });

  it('admits nothing once the run is halted (AC-27)', () => {
    expect(ids(admit(input({ order: [a, b], limit: 3, halted: true })))).toEqual([]);
  });

  it('a project-directory step runs alone and nothing is admitted while it runs (AC-07)', () => {
    const p = step('p', [], Isolation.None);
    const inProject = (s: StepDefinition): boolean => s.id === 'p';
    expect(ids(admit(input({ order: [p, b], limit: 3, runsInProject: inProject })))).toEqual(['p']);

    const states = new Map<string, StepStatus>([
      ['p', StepStatus.Running],
      ['b', StepStatus.Pending],
    ]);
    expect(
      ids(
        admit(input({ order: [p, b], states, running: new Set(['p']), limit: 3, runsInProject: inProject })),
      ),
    ).toEqual([]);
  });

  it('a project-directory step waits for running work to settle and blocks the steps after it (AC-08a)', () => {
    const p = step('p', [], Isolation.None);
    const inProject = (s: StepDefinition): boolean => s.id === 'p';
    const states = new Map<string, StepStatus>([
      ['a', StepStatus.Running],
      ['p', StepStatus.Pending],
      ['b', StepStatus.Pending],
    ]);
    // `a` runs, `p` must run alone, `b` is behind it: nothing is admitted now.
    expect(
      ids(
        admit(
          input({ order: [a, p, b], states, running: new Set(['a']), limit: 3, runsInProject: inProject }),
        ),
      ),
    ).toEqual([]);
  });

  it('a step put back maxWaits times is admitted alone, before a project-directory step (AC-08a, AC-13)', () => {
    const p = step('p', [], Isolation.None);
    const inProject = (s: StepDefinition): boolean => s.id === 'p';
    const result = admit(
      input({
        order: [p, a, b],
        limit: 3,
        runsInProject: inProject,
        waiting: new Map([['b', 3]]),
        maxWaits: 3,
      }),
    );
    expect(ids(result)).toEqual(['b']);
  });

  it('a step below maxWaits is an ordinary ready step', () => {
    expect(ids(admit(input({ order: [a, b], limit: 3, waiting: new Map([['b', 2]]), maxWaits: 3 })))).toEqual(
      ['a', 'b'],
    );
  });

  it('owner calls come after the alone kinds and before other steps (AC-08a)', () => {
    const result = admit(input({ order: [a, b], limit: 2, ownerQueue: ['db'] }));
    expect(ids(result)).toEqual(['owner:db', 'a']);
  });

  it('is deterministic: the same input gives the same answer', () => {
    const i = input({ order: [a, b, c], limit: 2 });
    expect(admit(i)).toEqual(admit(i));
  });
});

describe("runsInProject (today's rule, AC-07)", () => {
  it('is true for a step with no isolation and no isolated dependency', () => {
    expect(runsInProject(step('a', [], Isolation.None), new Set())).toBe(true);
  });

  it('is false for a worktree step', () => {
    expect(runsInProject(step('a', [], Isolation.GitWorktree), new Set())).toBe(false);
  });

  it('is false when a dependency runs in the worktree', () => {
    expect(runsInProject(step('b', ['a'], Isolation.None), new Set(['a']))).toBe(false);
  });
});

describe('parallelGroups (AC-32)', () => {
  const a = step('a');
  const b = step('b');
  const c = step('c', ['a', 'b']);
  const d = step('d', ['c']);

  it('with a limit of 1 gives one step per group, in order', () => {
    expect(parallelGroups([a, b, c, d], 1, () => false)).toEqual([['a'], ['b'], ['c'], ['d']]);
  });

  it('groups the steps that may start together if every step took the same time', () => {
    expect(parallelGroups([a, b, c, d], 2, () => false)).toEqual([['a', 'b'], ['c'], ['d']]);
  });

  it('caps a group at the limit', () => {
    const e = step('e');
    expect(parallelGroups([a, b, e, c, d], 2, () => false)).toEqual([['a', 'b'], ['e', 'c'], ['d']]);
  });

  it('puts a project-directory step in a group of its own', () => {
    const p = step('p', [], Isolation.None);
    expect(parallelGroups([a, p, b], 3, (s) => s.id === 'p')).toEqual([['p'], ['a', 'b']]);
  });

  it('returns no group for no step', () => {
    expect(parallelGroups([], 3, () => false)).toEqual([]);
  });
});
