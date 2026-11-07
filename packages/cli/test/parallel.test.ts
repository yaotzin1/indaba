import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineStep, Isolation } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  PARALLEL_CONSEQUENCES,
  parallelNotice,
  parseParallelFlag,
  planGroupLines,
  resolveLimit,
} from '../src/parallel.js';

// specs/parallel-steps, slice 1 (T-06): resolving the limit, the words around it, and the groups of `indaba plan`.

describe('resolveLimit (AC-01)', () => {
  it('prefers the flag, then the variable, then the file, then the default', () => {
    expect(resolveLimit({ flag: 4, variable: '3', configured: 2 })).toEqual({
      limit: 4,
      source: 'flag',
      warnings: [],
    });
    expect(resolveLimit({ flag: undefined, variable: '3', configured: 2 })).toEqual({
      limit: 3,
      source: 'env',
      warnings: [],
    });
    expect(resolveLimit({ flag: undefined, variable: undefined, configured: 2 })).toEqual({
      limit: 2,
      source: 'config',
      warnings: [],
    });
    expect(resolveLimit({ flag: undefined, variable: undefined, configured: 1 })).toEqual({
      limit: 1,
      source: 'default',
      warnings: [],
    });
  });

  it('treats an empty variable as not set', () => {
    expect(resolveLimit({ flag: undefined, variable: '', configured: 1 }).source).toBe('default');
  });

  it.each(['0', '-1', '1.5', 'two', '3x', ' '])(
    'ignores the variable %j with a warning and uses the next source',
    (variable) => {
      const resolved = resolveLimit({ flag: undefined, variable, configured: 2 });
      expect(resolved.limit).toBe(2);
      expect(resolved.source).toBe('config');
      expect(resolved.warnings).toEqual([
        'INDABA_PARALLEL must be a whole number of at least 1; it is ignored.',
      ]);
    },
  );

  it('does not read the variable when the flag is given', () => {
    expect(resolveLimit({ flag: 2, variable: 'garbage', configured: 1 }).warnings).toEqual([]);
  });
});

describe('parseParallelFlag', () => {
  it('is undefined when the flag is absent and a number when it is valid', () => {
    expect(parseParallelFlag(undefined)).toBeUndefined();
    expect(parseParallelFlag('3')).toBe(3);
    expect(parseParallelFlag(' 12 ')).toBe(12);
  });

  it.each(['0', '-2', '1.5', 'x', '', '1e3'])('refuses %j', (text) => {
    expect(() => parseParallelFlag(text)).toThrow('--parallel must be a whole number of at least 1');
  });
});

describe('parallelNotice (AC-04a)', () => {
  it('says nothing at a limit of 1', () => {
    expect(parallelNotice(1)).toBeUndefined();
  });

  it('above the cap says that steps still run one at a time, and names both numbers', () => {
    expect(parallelNotice(3, 1)).toBe(
      'Steps run one at a time in this version: a limit of 3 is recorded, and the limit that runs is 1.',
    );
  });

  it('shows the consequences when the limit asked is allowed to run', () => {
    expect(parallelNotice(3, 5)).toBe(PARALLEL_CONSEQUENCES);
  });

  it('states the costs: extra calls, negotiation, a worktree each, the decider', () => {
    for (const word of ['extra call', 'negotiation', 'worktree', 'decider']) {
      expect(PARALLEL_CONSEQUENCES).toContain(word);
    }
  });
});

describe('the documentation (AC-04a)', () => {
  it('holds the consequences text the command prints, word for word', () => {
    const docs = readFileSync(
      fileURLToPath(new URL('../../../docs/workflow-format.md', import.meta.url)),
      'utf8',
    );
    expect(docs).toContain(PARALLEL_CONSEQUENCES);
  });
});

describe('planGroupLines (AC-32)', () => {
  const a = defineStep({ id: 'a', isolation: Isolation.GitWorktree });
  const b = defineStep({ id: 'b', isolation: Isolation.GitWorktree });
  const c = defineStep({ id: 'c', dependsOn: ['a', 'b'], isolation: Isolation.GitWorktree });

  it('prints nothing at a limit of 1', () => {
    expect(planGroupLines([a, b, c], 1)).toEqual([]);
  });

  it('prints the groups that may be admitted together, and that they may be narrowed', () => {
    const lines = planGroupLines([a, b, c], 2);
    expect(lines[0]).toBe('Parallel groups (limit 2):');
    expect(lines.slice(1, 3)).toEqual(['  1. a, b', '  2. c']);
    expect(lines.at(-1)).toContain('may be narrowed');
  });

  it('marks a step that works in the project directory as running alone', () => {
    const p = defineStep({ id: 'p' });
    const lines = planGroupLines([p, a, b], 3);
    expect(lines).toContain('  1. p (alone: it works in the project directory)');
    expect(lines).toContain('  2. a, b');
  });

  it('treats a step that depends on a worktree step as working in the worktree', () => {
    const after = defineStep({ id: 'after', dependsOn: ['a'] });
    const lines = planGroupLines([a, after], 3);
    expect(lines.filter((line) => line.includes('alone'))).toEqual([]);
  });
});
