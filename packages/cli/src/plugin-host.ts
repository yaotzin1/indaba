import type {
  Adjudicator,
  AdjudicatorRegistry,
  Guard,
  PluginHost,
  Runner,
  SimpleEventDispatcher,
} from '@indaba/core';
import type { GuardRegistry } from '@indaba/engine';
import type { RunnerRegistry } from '@indaba/runners';

/**
 * The only thing a plugin receives. It forwards to the same public registries the built-ins join,
 * so an extension has no less access than a built-in and no more.
 */
export class RegistryPluginHost implements PluginHost {
  constructor(
    private readonly runners: RunnerRegistry,
    private readonly guards: GuardRegistry,
    private readonly events: SimpleEventDispatcher,
    private readonly adjudicators: AdjudicatorRegistry,
  ) {}

  registerRunner(runner: Runner): void {
    this.runners.register(runner);
  }

  registerGuard(guard: Guard): void {
    this.guards.register(guard);
  }

  registerAdjudicator(name: string, adjudicator: Adjudicator): void {
    this.adjudicators.register(name, adjudicator);
  }

  addListener<E extends object>(
    type: abstract new (...args: never[]) => E,
    listener: (event: E) => unknown,
  ): void {
    this.events.addListener(type, listener);
  }
}
