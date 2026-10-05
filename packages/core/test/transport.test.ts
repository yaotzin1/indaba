import { describe, expect, it } from 'vitest';
import {
  matchesAny,
  matchesGlob,
  RunnerChainExhaustedError,
  RunnerError,
  RunnerUnavailableError,
  RunResult,
  runnerChain,
  Span,
} from '../src/index.js';

describe('runnerChain', () => {
  it('is the primary followed by its fallbacks, in order', () => {
    expect(runnerChain({ runner: 'openai', fallbackRunners: ['acp', 'claude-code'] })).toEqual([
      'openai',
      'acp',
      'claude-code',
    ]);
  });

  it('is just the primary when there are no fallbacks', () => {
    expect(runnerChain({ runner: 'shell' })).toEqual(['shell']);
    expect(runnerChain({ runner: 'shell', fallbackRunners: [] })).toEqual(['shell']);
  });

  it('lists a runner once', () => {
    expect(runnerChain({ runner: 'a', fallbackRunners: ['b', 'a', 'b'] })).toEqual(['a', 'b']);
  });
});

describe('runner errors', () => {
  it('an unavailable runner is still a RunnerError', () => {
    const error = new RunnerUnavailableError('no binary');
    expect(error).toBeInstanceOf(RunnerError);
    expect(error.name).toBe('RunnerUnavailableError');
  });

  it('a plain RunnerError is not an unavailable runner', () => {
    expect(new RunnerError('mid-stream')).not.toBeInstanceOf(RunnerUnavailableError);
  });

  it('an exhausted chain names every runner and why it was skipped', () => {
    const error = new RunnerChainExhaustedError([
      { runner: 'openai', reason: 'OPENAI_API_KEY is not set' },
      { runner: 'acp', reason: 'cannot start npx' },
    ]);
    expect(error).toBeInstanceOf(RunnerError);
    expect(error).not.toBeInstanceOf(RunnerUnavailableError);
    expect(error.message).toContain('openai: OPENAI_API_KEY is not set');
    expect(error.message).toContain('acp: cannot start npx');
    expect(error.skipped).toHaveLength(2);
  });
});

describe('RunResult.reportedCostUsd', () => {
  it('is absent unless the runner reported it', () => {
    expect(new RunResult({ exitCode: 0, output: '' }).reportedCostUsd).toBeUndefined();
    expect(new RunResult({ exitCode: 0, output: '', reportedCostUsd: 0.25 }).reportedCostUsd).toBe(0.25);
  });
});

describe('Span events', () => {
  it('records events in order and copies their attributes', () => {
    const span = new Span('t', 's', undefined, 'step', new Date(0));
    const attributes = { 'indaba.runner': 'acp' };
    span.addEvent('indaba.runner.skipped', attributes);
    span.addEvent('plain');
    attributes['indaba.runner'] = 'changed';

    expect(span.events.map((e) => e.name)).toEqual(['indaba.runner.skipped', 'plain']);
    expect(span.events[0]?.attributes).toEqual({ 'indaba.runner': 'acp' });
    expect(span.events[1]?.attributes).toEqual({});
  });
});

describe('matchesGlob', () => {
  it.each([
    ['src/**', 'src/a.ts', true],
    ['src/**', 'src/deep/er/a.ts', true],
    ['src/**', 'src', true],
    ['src/**', 'srcs/a.ts', false],
    ['src/**', 'tests/a.ts', false],
    ['**/*.ts', 'a.ts', true],
    ['**/*.ts', 'x/y/a.ts', true],
    ['**/*.ts', 'x/y/a.js', false],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/sub/a.ts', false],
    ['a?c', 'abc', true],
    ['a?c', 'ac', false],
    ['*.md', 'README.md', true],
    ['*.md', 'docs/README.md', false],
    ['docs/**/index.md', 'docs/index.md', true],
    ['docs/**/index.md', 'docs/a/b/index.md', true],
    ['file*', 'file', true],
    ['*a*b*', 'xxaxxbxx', true],
    ['*a*b*', 'xxbxxaxx', false],
  ])('%s against %s is %s', (pattern, path, expected) => {
    expect(matchesGlob(pattern, path)).toBe(expected);
  });

  it('treats backslashes and a leading ./ as separators and noise', () => {
    expect(matchesGlob('src/**', 'src\\a\\b.ts')).toBe(true);
    expect(matchesGlob('./src/**', './src/a.ts')).toBe(true);
    expect(matchesGlob('src\\**', 'src/a.ts')).toBe(true);
  });

  it('is case sensitive', () => {
    expect(matchesGlob('src/**', 'SRC/a.ts')).toBe(false);
  });

  it('never matches a path that climbs out with ..', () => {
    expect(matchesGlob('src/**', 'src/../secrets.txt')).toBe(false);
    expect(matchesGlob('**', '../x')).toBe(false);
  });

  it('fails closed on an over-long pattern or path', () => {
    expect(matchesGlob('a'.repeat(2000), 'a'.repeat(2000))).toBe(false);
    expect(matchesGlob('**', 'a/'.repeat(600))).toBe(false);
  });

  it('does not blow up on a pattern built to backtrack', () => {
    const pattern = `${'*a'.repeat(40)}b`;
    const started = Date.now();
    expect(matchesGlob(pattern, 'a'.repeat(200))).toBe(false);
    expect(matchesGlob('**/**/**/**/**/x', 'a/'.repeat(100))).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('matches nothing against an empty list', () => {
    expect(matchesAny([], 'src/a.ts')).toBe(false);
    expect(matchesAny(['docs/**', 'src/**'], 'src/a.ts')).toBe(true);
  });
});
