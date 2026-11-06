import { describe, expect, it } from 'vitest';
import {
  defineStep,
  isStallCapable,
  MAX_STALL_RETRIES,
  MAX_STALL_SECONDS,
  MIN_STALL_SECONDS,
  type Runner,
  type RunRequest,
  RunResult,
  type StallCapable,
} from '../src/index.js';

const plain: Runner = { name: 'plain', run: async () => new RunResult({ exitCode: 0, output: '' }) };

function withCapability(canReportActivity: boolean): Runner & StallCapable {
  return { ...plain, name: 'capable', canReportActivity };
}

describe('the stall bounds (specs/step-stalls, AC-04, C-05)', () => {
  it('start at 60 seconds, because a healthy tool call was measured 30 seconds between events', () => {
    expect(MIN_STALL_SECONDS).toBe(60);
    expect(MAX_STALL_SECONDS).toBe(3600);
    expect(MAX_STALL_RETRIES).toBe(3);
  });
});

describe('a step with a stall policy', () => {
  it('keeps the policy', () => {
    const step = defineStep({ id: 's', stall: { afterSeconds: 300, retries: 1 } });
    expect(step.stall).toEqual({ afterSeconds: 300, retries: 1 });
  });

  it('has no stall property when none is given', () => {
    expect('stall' in defineStep({ id: 's' })).toBe(false);
  });
});

describe('RunResult.stalled', () => {
  it('is absent on an ordinary result, so a consumer that ignores it sees nothing new', () => {
    const result = new RunResult({ exitCode: 1, output: '' });
    expect(result.stalled).toBeUndefined();
    expect(result.succeeded()).toBe(false);
  });

  it('is true when the attempt was stopped for silence, and still a failure', () => {
    const result = new RunResult({ exitCode: 125, output: '', stalled: true });
    expect(result.stalled).toBe(true);
    expect(result.succeeded()).toBe(false);
  });
});

describe('RunRequest.stallSeconds', () => {
  it('is optional', () => {
    const request: RunRequest = { prompt: 'p', workdir: '.' };
    expect('stallSeconds' in request).toBe(false);
    const asked: RunRequest = { ...request, stallSeconds: 90 };
    expect(asked.stallSeconds).toBe(90);
  });
});

describe('isStallCapable', () => {
  it('is true for a runner that says it can report activity', () => {
    expect(isStallCapable(withCapability(true))).toBe(true);
  });

  it('is false for a runner that declines, as claude-code does in plain mode', () => {
    expect(isStallCapable(withCapability(false))).toBe(false);
  });

  it('is false for a runner written before the capability existed', () => {
    expect(isStallCapable(plain)).toBe(false);
  });

  it('is false for a value that is not the literal true', () => {
    const odd = { ...plain, canReportActivity: 'yes' } as unknown as Runner;
    expect(isStallCapable(odd)).toBe(false);
  });
});
