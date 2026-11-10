import {
  AdjudicatorRegistry,
  type NegotiationDecider,
  noopLogger,
  type PluginHost,
  SimpleEventDispatcher,
} from '@indaba/core';
import { GuardRegistry } from '@indaba/engine';
import { RunnerRegistry } from '@indaba/runners';
import { describe, expect, it } from 'vitest';
import { RegistryPluginHost } from '../src/index.js';

// specs/parallel-steps, T-11: a plugin registers who decides after a negotiation failed (AC-16) through the host, like an adjudicator.

const decider = (answer: 'sequence' | 'stop' | null): NegotiationDecider => ({
  decide: async () => answer,
});

function host(): RegistryPluginHost {
  return new RegistryPluginHost(
    new RunnerRegistry(),
    GuardRegistry.withDefaults(),
    new SimpleEventDispatcher(),
    new AdjudicatorRegistry(),
    noopLogger,
  );
}

describe('registerNegotiationDecider', () => {
  it('has none until a plugin registers one', () => {
    expect(host().registeredNegotiationDecider()).toBeUndefined();
  });

  it('keeps the last one registered', async () => {
    const h = host();
    h.registerNegotiationDecider(decider('sequence'));
    h.registerNegotiationDecider(decider('stop'));
    const chosen = h.registeredNegotiationDecider();
    expect(await chosen?.decide({ steps: ['a', 'b'], transcript: [] })).toBe('stop');
  });

  it('is on the PluginHost a plugin receives, so a built-in has no door an extension lacks', () => {
    const h: PluginHost = host();
    h.registerNegotiationDecider(decider(null));
    expect(typeof h.registerNegotiationDecider).toBe('function');
  });
});
