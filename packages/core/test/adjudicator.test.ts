import { describe, expect, it } from 'vitest';
import {
  type Adjudicator,
  AdjudicatorRegistry,
  defineStep,
  IndabaError,
  Ruling,
  RulingSource,
  Verdict,
} from '../src/index.js';

const never: Adjudicator = { rule: () => Promise.resolve(null) };

describe('Ruling', () => {
  it('accepts only on an accept verdict', () => {
    expect(new Ruling(Verdict.Accept, 'fine').accepted()).toBe(true);
    expect(new Ruling(Verdict.Reject, 'no').accepted()).toBe(false);
  });

  it('is asked unless a ledger supplied it', () => {
    expect(new Ruling(Verdict.Accept, '').source).toBe(RulingSource.Asked);
    expect(new Ruling(Verdict.Accept, '', RulingSource.Memo).source).toBe('memo');
  });
});

describe('AdjudicatorRegistry', () => {
  it('finds what was registered and lists the names', () => {
    const registry = new AdjudicatorRegistry();
    registry.register('human', never);
    expect(registry.get('human')).toBe(never);
    expect(registry.get('model')).toBeUndefined();
    expect(registry.names()).toEqual(['human']);
  });

  it('refuses a second adjudicator under the same name', () => {
    const registry = new AdjudicatorRegistry();
    registry.register('human', never);
    expect(() => registry.register('human', never)).toThrow(IndabaError);
  });

  it('refuses an empty name', () => {
    expect(() => new AdjudicatorRegistry().register('', never)).toThrow(/needs a name/);
  });
});

describe('step arbiter', () => {
  it('is absent unless the workflow names one', () => {
    expect(defineStep({ id: 'a' }).arbiter).toBeUndefined();
    expect(defineStep({ id: 'a', arbiter: 'human' }).arbiter).toBe('human');
  });
});
