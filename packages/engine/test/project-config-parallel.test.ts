import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_PARALLEL_STEPS,
  DEFAULT_MAX_WAITS,
  PROJECT_CONFIG_SECTIONS,
  parseProjectConfig,
  resolveParallel,
} from '../src/index.js';

// specs/parallel-steps, slice 1: the parallel: section of indaba.config (AC-01, AC-13).

describe('the parallel section of indaba.config', () => {
  it('is a section the file may hold', () => {
    expect(PROJECT_CONFIG_SECTIONS).toContain('parallel');
  });

  it('defaults to one step at a time and three waits when the file says nothing', () => {
    const config = parseProjectConfig('');
    expect(config.parallel).toEqual({ maxSteps: DEFAULT_MAX_PARALLEL_STEPS, maxWaits: DEFAULT_MAX_WAITS });
    expect(DEFAULT_MAX_PARALLEL_STEPS).toBe(1);
    expect(DEFAULT_MAX_WAITS).toBe(3);
    expect(config.problems).toEqual([]);
  });

  it('reads max_steps and max_waits', () => {
    const config = parseProjectConfig('parallel:\n  max_steps: 4\n  max_waits: 2\n');
    expect(config.parallel).toEqual({ maxSteps: 4, maxWaits: 2 });
    expect(config.problems).toEqual([]);
  });

  it('keeps the other defaults when only one key is given', () => {
    expect(parseProjectConfig('parallel:\n  max_steps: 2\n').parallel).toEqual({ maxSteps: 2, maxWaits: 3 });
  });

  it('treats an empty section and null values as the defaults', () => {
    expect(parseProjectConfig('parallel:\n').parallel).toEqual({ maxSteps: 1, maxWaits: 3 });
    expect(parseProjectConfig('parallel:\n  max_steps:\n').parallel).toEqual({ maxSteps: 1, maxWaits: 3 });
  });

  it.each(['0', '-2', '1.5', '"3"', 'true', '[1]'])(
    'refuses max_steps: %s, naming the key, and keeps the default',
    (value) => {
      const config = parseProjectConfig(`parallel:\n  max_steps: ${value}\n`);
      expect(config.problems).toContain('parallel.max_steps must be a whole number of at least 1');
      expect(config.parallel.maxSteps).toBe(1);
    },
  );

  it('refuses max_waits below 1, naming the key', () => {
    const config = parseProjectConfig('parallel:\n  max_waits: 0\n');
    expect(config.problems).toContain('parallel.max_waits must be a whole number of at least 1');
    expect(config.parallel.maxWaits).toBe(3);
  });

  it('names a key the section does not hold', () => {
    const config = parseProjectConfig('parallel:\n  max_step: 3\n');
    expect(config.problems).toEqual([
      'parallel.max_step is not a key of parallel (allowed: max_steps, max_waits)',
    ]);
  });

  it('refuses a section that is not a mapping', () => {
    expect(parseProjectConfig('parallel: 3\n').problems).toContain(
      'parallel must be a mapping (max_steps, max_waits)',
    );
    expect(resolveParallel([1]).problems).toEqual(['parallel must be a mapping (max_steps, max_waits)']);
  });

  it('still names an unknown section, with parallel among the allowed ones', () => {
    expect(parseProjectConfig('paralel:\n  max_steps: 2\n').problems).toEqual([
      'paralel is not a section of indaba.config (allowed: logging, parallel)',
    ]);
  });

  it('is independent of the logging section', () => {
    const config = parseProjectConfig('logging:\n  level: debug\nparallel:\n  max_steps: 3\n');
    expect(config.parallel.maxSteps).toBe(3);
    expect(config.problems).toEqual([]);
  });
});
