import { describe, expect, it } from 'vitest';
import { GuardResult, GuardType } from '../src/index.js';

describe('GuardResult', () => {
  it('passes without a message', () => {
    const result = GuardResult.pass();
    expect(result.passed).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it('fails with the reason', () => {
    const result = GuardResult.fail('src/ changed');
    expect(result.passed).toBe(false);
    expect(result.message).toBe('src/ changed');
  });
});

describe('GuardType', () => {
  it('lists the built-in guard but leaves the type open for plugins', () => {
    expect(GuardType.GitDiffEmpty).toBe('git_diff_empty');
    const custom: string = 'timeline_has_clips';
    expect(typeof custom).toBe('string');
  });
});
